package sys

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"sync"
	"time"

	"magnemite/agent/internal/proto"
)

// Fake stands in for an Android box so the whole install pipeline — including
// the pm session dance and the uninstall fallback — can be exercised on a
// laptop. scripts/fake-fleet.sh runs a few hundred of these against the hub.
//
// Failure injection, all via environment variables:
//
//	MAGNEMITE_FAKE_COMMIT_ERROR       text install-commit fails with
//	MAGNEMITE_FAKE_COMMIT_ERROR_ONCE  only fail the first commit, so the
//	                                  uninstall fallback gets exercised
//	MAGNEMITE_FAKE_FREE_BYTES         override free space, to trip the gate
//	MAGNEMITE_FAKE_INSTALL_MS         how long a commit pretends to take
type Fake struct {
	mu         sync.Mutex
	serial     string
	statePath  string
	packages   map[string]proto.PackageInfo
	settings   map[string]string
	sessions   map[string]bool
	nextID     int
	pending    string
	commitFail int
	started    time.Time
}

type fakeState struct {
	Packages map[string]proto.PackageInfo `json:"packages"`
}

func NewFake(serial, statePath string) *Fake {
	f := &Fake{
		serial:    serial,
		statePath: statePath,
		packages:  map[string]proto.PackageInfo{},
		settings:  map[string]string{},
		sessions:  map[string]bool{},
		nextID:    100000,
		started:   time.Now(),
	}
	f.load()
	return f
}

// SetPendingVersion tells the fake what an install-commit should end up
// reporting. Only the fake needs this; on a real box the version comes out of
// the APKs themselves.
func (f *Fake) SetPendingVersion(v string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pending = v
}

func (f *Fake) load() {
	if f.statePath == "" {
		return
	}
	data, err := os.ReadFile(f.statePath)
	if err != nil {
		return
	}
	var st fakeState
	if json.Unmarshal(data, &st) == nil && st.Packages != nil {
		f.packages = st.Packages
	}
}

func (f *Fake) save() {
	if f.statePath == "" {
		return
	}
	data, err := json.MarshalIndent(fakeState{Packages: f.packages}, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(f.statePath, data, 0o644)
}

func (f *Fake) Prop(_ context.Context, name string) string {
	switch name {
	case "ro.serialno", "ro.boot.serialno":
		return f.serial
	case "ro.product.manufacturer":
		return "Magnemite"
	case "ro.product.model":
		return "FakeBox"
	case "ro.build.version.release":
		return "11"
	case "ro.build.version.sdk":
		return "30"
	case "ro.product.cpu.abi":
		return "arm64-v8a"
	case "ro.sf.lcd_density":
		return "320"
	case "net.dns1":
		return ""
	}
	return ""
}

func (f *Fake) Shell(ctx context.Context, script string) (string, error) {
	// Hooks are recorded, not run: the point of fake mode is to avoid touching
	// the host.
	return "", nil
}

func (f *Fake) Exec(ctx context.Context, name string, args ...string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	switch name {
	case "pm":
		return f.pm(ctx, args)
	case "dumpsys":
		if len(args) >= 2 && args[0] == "package" {
			return f.dumpsys(args[1]), nil
		}
	case "getprop":
		if len(args) == 1 {
			return f.Prop(ctx, args[0]), nil
		}
	case "settings":
		return f.settingsCmd(args)
	case "sh":
		return "", nil
	}
	return "", nil
}

func (f *Fake) pm(ctx context.Context, args []string) (string, error) {
	if len(args) == 0 {
		return "", nil
	}
	switch args[0] {
	case "install-create":
		f.nextID++
		id := strconv.Itoa(f.nextID)
		f.sessions[id] = true
		return fmt.Sprintf("Success: created install session [%s]", id), nil

	case "install-write":
		return "Success: streamed", nil

	case "install-commit":
		if delay := os.Getenv("MAGNEMITE_FAKE_INSTALL_MS"); delay != "" {
			if ms, err := strconv.Atoi(delay); err == nil {
				f.mu.Unlock()
				select {
				case <-time.After(time.Duration(ms) * time.Millisecond):
				case <-ctx.Done():
				}
				f.mu.Lock()
			}
		}

		if msg := os.Getenv("MAGNEMITE_FAKE_COMMIT_ERROR"); msg != "" {
			once := os.Getenv("MAGNEMITE_FAKE_COMMIT_ERROR_ONCE") != ""
			if !once || f.commitFail == 0 {
				f.commitFail++
				return "", fmt.Errorf("pm install-commit: Failure [%s]", msg)
			}
		}

		pkg := "com.nianticlabs.pokemongo"
		f.packages[pkg] = proto.PackageInfo{
			PackageName: pkg,
			VersionName: f.pending,
			VersionCode: strconv.FormatInt(time.Now().Unix(), 10),
			Installed:   true,
		}
		f.save()
		return "Success", nil

	case "uninstall":
		pkg := args[len(args)-1]
		delete(f.packages, pkg)
		f.save()
		return "Success", nil

	case "install-abandon":
		return "Success", nil
	}
	return "", nil
}

func (f *Fake) dumpsys(pkg string) string {
	info, ok := f.packages[pkg]
	if !ok {
		return ""
	}
	return fmt.Sprintf(
		"Packages:\n  Package [%s] (deadbeef):\n    versionCode=%s minSdk=30 targetSdk=33\n    versionName=%s\n",
		pkg, info.VersionCode, info.VersionName,
	)
}

func (f *Fake) settingsCmd(args []string) (string, error) {
	if len(args) >= 3 && args[0] == "get" {
		return f.settings[args[1]+"/"+args[2]], nil
	}
	if len(args) >= 4 && args[0] == "put" {
		f.settings[args[1]+"/"+args[2]] = args[3]
		return "", nil
	}
	return "", nil
}

func (f *Fake) Disk(string) (uint64, uint64, error) {
	if v := os.Getenv("MAGNEMITE_FAKE_FREE_BYTES"); v != "" {
		free, err := strconv.ParseUint(v, 10, 64)
		if err == nil {
			return free, 8 * 1024 * 1024 * 1024, nil
		}
	}
	return 6 * 1024 * 1024 * 1024, 8 * 1024 * 1024 * 1024, nil
}

func (f *Fake) UptimeSeconds() int64 {
	return int64(time.Since(f.started).Seconds())
}

func (f *Fake) PackageInfo(_ context.Context, pkg string) (proto.PackageInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if info, ok := f.packages[pkg]; ok {
		return info, nil
	}
	return proto.PackageInfo{PackageName: pkg, Installed: false}, nil
}

// The fake fleet is what the 200-device load test runs against, so these
// wobble a little rather than returning a constant: a dashboard that only
// ever shows 0.00 load hides the bugs this is meant to catch.
func (f *Fake) LoadAvg() (float64, float64, float64) {
	base := float64(time.Since(f.started).Seconds())
	one := 0.4 + math.Abs(math.Sin(base/60))*1.2
	return round2(one), round2(one * 0.9), round2(one * 0.8)
}

func (f *Fake) Memory() (uint64, uint64) {
	const total = 2 * 1024 * 1024 * 1024
	free := uint64(float64(total) * (0.25 + math.Abs(math.Cos(float64(time.Since(f.started).Seconds())/90))*0.2))
	return total, free
}

func (f *Fake) CPUCount() int { return 4 }

func (f *Fake) ThirdPartyPackages(_ context.Context) ([]proto.PackageInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	packages := make([]proto.PackageInfo, 0, len(f.packages)+2)
	for _, info := range f.packages {
		if info.Installed {
			packages = append(packages, proto.PackageInfo{
				PackageName: info.PackageName,
				VersionCode: info.VersionCode,
				Installed:   true,
			})
		}
	}
	// A couple of extras so the inventory is visibly more than the tracked app.
	packages = append(packages,
		proto.PackageInfo{PackageName: "com.unownhash.dragonite", VersionCode: "42", Installed: true},
		proto.PackageInfo{PackageName: "com.android.tv.launcher", VersionCode: "7", Installed: true},
	)
	return packages, nil
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func (f *Fake) DeviceInfo(ctx context.Context) proto.DeviceInfo {
	return proto.DeviceInfo{
		Serial:         f.serial,
		Manufacturer:   "Magnemite",
		Model:          "FakeBox",
		AndroidVersion: "11",
		SdkInt:         30,
		Abi:            "arm64-v8a",
		Density:        320,
	}
}

var _ System = (*Fake)(nil)
var _ System = (*Android)(nil)
