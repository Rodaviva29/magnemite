// Package apkm reads the APKMirror bundle format. An .apkm is a plain zip
// holding base.apk plus the split APKs for every ABI, screen density and
// language, which is why a 170 MB bundle installs as ~110 MB on any one box.
//
// Android rejects a session that mixes splits it did not ask for, so picking
// the right subset is the difference between a working install and
// INSTALL_FAILED_INVALID_APK.
package apkm

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type SplitKind int

const (
	KindBase SplitKind = iota
	KindAbi
	KindDensity
	KindLanguage
	// A feature module or anything else we cannot classify. Always installed:
	// leaving one out breaks the app, and they are small.
	KindOther
)

type Entry struct {
	Name      string
	Qualifier string
	Kind      SplitKind
	Size      int64
}

var abiQualifiers = map[string]string{
	"arm64_v8a":   "arm64-v8a",
	"arm64-v8a":   "arm64-v8a",
	"armeabi_v7a": "armeabi-v7a",
	"armeabi-v7a": "armeabi-v7a",
	"x86":         "x86",
	"x86_64":      "x86_64",
}

// Bucket cut-offs Android uses to choose a density split.
var densityBuckets = map[string]int{
	"ldpi":    120,
	"mdpi":    160,
	"tvdpi":   213,
	"hdpi":    240,
	"xhdpi":   320,
	"xxhdpi":  480,
	"xxxhdpi": 640,
	"nodpi":   0,
	"anydpi":  0,
}

// List reads the entries of an .apkm without extracting anything.
func List(path string) ([]Entry, error) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open apkm: %w", err)
	}
	defer r.Close()

	var entries []Entry
	for _, f := range r.File {
		name := filepath.Base(f.Name)
		if !strings.HasSuffix(strings.ToLower(name), ".apk") {
			continue // info.json, meta.sai_v2.json, icon.png
		}
		entries = append(entries, classify(name, int64(f.UncompressedSize64)))
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no apk entries in bundle")
	}
	return entries, nil
}

func classify(name string, size int64) Entry {
	e := Entry{Name: name, Size: size, Kind: KindOther}
	lower := strings.ToLower(name)

	if lower == "base.apk" || strings.HasSuffix(lower, "_base.apk") {
		e.Kind = KindBase
		return e
	}

	// Both "split_config.arm64_v8a.apk" and the longer
	// "split_<pkg>_<build>_config.arm64_v8a.apk" that the GitHub releases use.
	idx := strings.LastIndex(lower, "config.")
	if idx == -1 {
		// A split with no config qualifier is a feature module.
		if strings.HasPrefix(lower, "split_") {
			e.Kind = KindOther
			return e
		}
		// Anything else that is not obviously a split is the base.
		e.Kind = KindBase
		return e
	}

	qualifier := strings.TrimSuffix(lower[idx+len("config."):], ".apk")
	e.Qualifier = qualifier

	if _, ok := abiQualifiers[qualifier]; ok {
		e.Kind = KindAbi
		return e
	}
	if _, ok := densityBuckets[qualifier]; ok {
		e.Kind = KindDensity
		return e
	}
	// Everything left over with a short qualifier is a language split
	// ("en", "pt", "zh_hant", ...).
	if len(qualifier) <= 7 {
		e.Kind = KindLanguage
		return e
	}
	e.Kind = KindOther
	return e
}

type Selection struct {
	Abi      string
	Density  int
	Language string
	// Extra split names to force in, from the job.
	Extra []string
}

// Select picks the subset of a bundle that belongs on this specific box.
func Select(entries []Entry, sel Selection) ([]Entry, error) {
	var chosen []Entry
	var base *Entry

	extra := map[string]bool{}
	for _, name := range sel.Extra {
		extra[strings.ToLower(name)] = true
	}

	var abis, densities, languages []Entry
	for i := range entries {
		e := entries[i]
		switch e.Kind {
		case KindBase:
			if base == nil {
				base = &entries[i]
			}
		case KindAbi:
			abis = append(abis, e)
		case KindDensity:
			densities = append(densities, e)
		case KindLanguage:
			languages = append(languages, e)
		default:
			chosen = append(chosen, e)
		}
	}

	if base == nil {
		return nil, fmt.Errorf("bundle has no base apk")
	}
	chosen = append(chosen, *base)

	// --- ABI: an exact match or nothing. Installing the wrong native
	// libraries is worse than the app refusing to install.
	wantAbi := normalizeAbi(sel.Abi)
	abiMatched := false
	for _, e := range abis {
		if abiQualifiers[e.Qualifier] == wantAbi {
			chosen = append(chosen, e)
			abiMatched = true
		}
	}
	if len(abis) > 0 && !abiMatched {
		return nil, fmt.Errorf("bundle has no split for abi %q", sel.Abi)
	}

	// --- Density: the exact bucket, else the nearest one. Missing it only
	// costs image quality, so a near miss is fine.
	if len(densities) > 0 {
		if e := pickDensity(densities, sel.Density); e != nil {
			chosen = append(chosen, *e)
		}
	}

	// --- Language: the box's own locale plus English as the fallback the
	// app's UI can always fall back to.
	if len(languages) > 0 {
		want := map[string]bool{"en": true}
		if lang := primaryLanguage(sel.Language); lang != "" {
			want[lang] = true
		}
		matched := false
		for _, e := range languages {
			if want[primaryLanguage(e.Qualifier)] {
				chosen = append(chosen, e)
				matched = true
			}
		}
		// A bundle with only languages we don't want still needs one of them.
		if !matched {
			chosen = append(chosen, languages[0])
		}
	}

	for _, e := range entries {
		if extra[strings.ToLower(e.Name)] && !contains(chosen, e.Name) {
			chosen = append(chosen, e)
		}
	}

	sort.Slice(chosen, func(i, j int) bool { return chosen[i].Name < chosen[j].Name })
	return chosen, nil
}

func contains(entries []Entry, name string) bool {
	for _, e := range entries {
		if e.Name == name {
			return true
		}
	}
	return false
}

func normalizeAbi(abi string) string {
	if v, ok := abiQualifiers[strings.ToLower(abi)]; ok {
		return v
	}
	return strings.ToLower(abi)
}

func primaryLanguage(qualifier string) string {
	q := strings.ToLower(qualifier)
	for _, sep := range []string{"_", "-"} {
		if i := strings.Index(q, sep); i > 0 {
			return q[:i]
		}
	}
	return q
}

func pickDensity(entries []Entry, density int) *Entry {
	if density <= 0 {
		density = 320 // what most Android TV boxes report
	}
	var best *Entry
	bestDelta := 1 << 30
	for i := range entries {
		dpi, ok := densityBuckets[entries[i].Qualifier]
		if !ok {
			continue
		}
		if dpi == 0 {
			// nodpi/anydpi fit any screen; take them only if nothing else does.
			if best == nil {
				best = &entries[i]
			}
			continue
		}
		delta := dpi - density
		if delta < 0 {
			delta = -delta
		}
		if delta < bestDelta {
			bestDelta = delta
			best = &entries[i]
		}
	}
	return best
}

// Extract writes the chosen entries into destDir and returns their paths in
// the same order.
func Extract(path, destDir string, chosen []Entry) ([]string, error) {
	want := map[string]bool{}
	for _, e := range chosen {
		want[e.Name] = true
	}

	r, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open apkm: %w", err)
	}
	defer r.Close()

	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, err
	}

	var written []string
	for _, f := range r.File {
		name := filepath.Base(f.Name)
		if !want[name] {
			continue
		}

		out := filepath.Join(destDir, name)
		if err := extractOne(f, out); err != nil {
			return written, err
		}
		written = append(written, out)
	}

	if len(written) != len(chosen) {
		return written, fmt.Errorf("expected %d apks in bundle, extracted %d", len(chosen), len(written))
	}
	return written, nil
}

func extractOne(f *zip.File, dest string) error {
	rc, err := f.Open()
	if err != nil {
		return fmt.Errorf("read %s: %w", f.Name, err)
	}
	defer rc.Close()

	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, rc); err != nil {
		return fmt.Errorf("extract %s: %w", f.Name, err)
	}
	return out.Sync()
}
