// Package installer runs the update on the box: download, verify, extract,
// install through a pm session, verify again.
package installer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"magnemite/agent/internal/apkm"
	"magnemite/agent/internal/proto"
	"magnemite/agent/internal/sys"
)

// A box needs room for the bundle plus the splits it unpacks to, and the
// splits are bigger than the zip holding them: 0.425.1 is a 172 MB bundle
// that unpacks to 250 MB, so 2.5x is the floor. 3x leaves headroom for a
// bundle that compresses better than that, and failing this check is far
// better than dying half way through with a broken install.
const spaceFactor = 3.0

// Errors that mean the existing install cannot be upgraded in place. The only
// way forward is to uninstall first, which wipes the app's data.
var incompatibleErrors = []string{
	"INSTALL_FAILED_UPDATE_INCOMPATIBLE",
	"INSTALL_FAILED_VERSION_DOWNGRADE",
	"INCONSISTENT_CERTIFICATES",
	"INSTALL_FAILED_SHARED_USER_INCOMPATIBLE",
	"signatures do not match",
}

// Errors that mean a package verifier — Play Protect, normally — refused the
// session or never answered.
//
// Not expected on this fleet: a root `pm` session is flagged INSTALL_FROM_ADB
// exactly like `adb install-multiple`, and these boxes register no verifier at
// all (`pm query-receivers -a android.intent.action.PACKAGE_NEEDS_VERIFICATION`
// returns nothing), so nothing ever verifies an install. Detected anyway so a
// box that does have one fails with an answer instead of a mystery — the agent
// deliberately does not go turning device-wide security settings off to win.
var verificationErrors = []string{
	"INSTALL_FAILED_VERIFICATION_FAILURE",
	"INSTALL_FAILED_VERIFICATION_TIMEOUT",
}

var sessionIDRe = regexp.MustCompile(`\[(\d+)\]`)

// Reporter pushes progress back to the hub.
type Reporter interface {
	Progress(state string, percent int, message string)
	Log(level, message string)
}

type Installer struct {
	Sys     sys.System
	WorkDir string
	// Device token, sent as a bearer on artifact downloads so Caddy's
	// forward_auth lets them through.
	Token  string
	Client *http.Client
}

type Result struct {
	OK                   bool
	InstallMode          string
	DataWiped            bool
	InstalledVersion     string
	InstalledVersionCode string
	Err                  error
}

func (i *Installer) Run(ctx context.Context, job proto.InstallJob, rep Reporter) Result {
	jobDir := filepath.Join(i.WorkDir, job.JobID)
	bundlePath := filepath.Join(i.WorkDir, job.SHA256+".apkm")
	splitsDir := filepath.Join(jobDir, "splits")

	// Splits always go; the bundle is only kept when it may still be useful
	// for a resume.
	defer os.RemoveAll(jobDir)

	if err := os.MkdirAll(i.WorkDir, 0o755); err != nil {
		return fail(fmt.Errorf("create work dir: %w", err))
	}

	// --- 1. space --------------------------------------------------------
	need := uint64(float64(job.SizeBytes) * spaceFactor)
	free, _, err := i.Sys.Disk("/data")
	if err == nil && free > 0 && free < need {
		return fail(fmt.Errorf(
			"not enough space on /data: need %s, have %s",
			humanBytes(need), humanBytes(free),
		))
	}

	// --- 2. download -----------------------------------------------------
	rep.Progress(proto.StateDownloading, 0, "starting download")
	if err := i.download(ctx, job, bundlePath, rep); err != nil {
		return fail(err)
	}

	// --- 3. extract ------------------------------------------------------
	rep.Progress(proto.StateExtracting, 0, "reading bundle")
	info := i.Sys.DeviceInfo(ctx)
	entries, err := apkm.List(bundlePath)
	if err != nil {
		// A corrupt bundle is not worth keeping around for a resume.
		os.Remove(bundlePath)
		return fail(err)
	}

	locale := i.Sys.Prop(ctx, "persist.sys.locale")
	if locale == "" {
		locale = i.Sys.Prop(ctx, "ro.product.locale")
	}

	chosen, err := apkm.Select(entries, apkm.Selection{
		Abi:      info.Abi,
		Density:  info.Density,
		Language: locale,
		Extra:    job.ExtraSplits,
	})
	if err != nil {
		return fail(err)
	}

	names := make([]string, 0, len(chosen))
	for _, e := range chosen {
		names = append(names, e.Name)
	}
	rep.Log(proto.LevelInfo, "installing splits: "+strings.Join(names, ", "))

	paths, err := apkm.Extract(bundlePath, splitsDir, chosen)
	if err != nil {
		return fail(err)
	}
	rep.Progress(proto.StateExtracting, 100, fmt.Sprintf("extracted %d apks", len(paths)))

	// --- 4. pre-install hook --------------------------------------------
	if strings.TrimSpace(job.PreInstallHook) != "" {
		rep.Log(proto.LevelInfo, "running pre-install hook")
		if out, err := i.Sys.Shell(ctx, job.PreInstallHook); err != nil {
			// The scanner refusing to stop should not abort the update.
			rep.Log(proto.LevelWarn, fmt.Sprintf("pre-install hook failed: %v %s", err, out))
		}
	}

	// --- 5. install ------------------------------------------------------
	rep.Progress(proto.StateInstalling, 0, "opening install session")

	mode := proto.InstallModeInPlace
	dataWiped := false

	if job.ForceClean {
		rep.Log(proto.LevelInfo, "force-clean requested: uninstalling first (app data will be lost)")
		if err := i.uninstall(ctx, job.PackageName); err != nil {
			rep.Log(proto.LevelWarn, fmt.Sprintf("uninstall failed, continuing: %v", err))
		} else {
			mode = proto.InstallModeClean
			dataWiped = true
		}
	}

	err = i.installSession(ctx, job, paths, rep)

	// The agent never changes device-wide settings to get around this — it
	// says what happened and what to do, and leaves the box alone.
	if err != nil && isVerificationBlocked(err) {
		return Result{
			InstallMode: mode,
			DataWiped:   dataWiped,
			Err: fmt.Errorf(
				"a package verifier (Play Protect) refused this install: %w — "+
					"this box has one enabled, unlike the rest of the fleet; "+
					"run `settings put global verifier_verify_adb_installs 0` on it, "+
					"or remove the verifier package",
				err,
			),
		}
	}

	if err != nil && !job.ForceClean && isIncompatible(err) {
		// The in-place upgrade was rejected — different signing key, or a
		// downgrade. Uninstalling is the only way through, and it costs the
		// app's data, so it is recorded on the job.
		rep.Log(proto.LevelWarn, "in-place upgrade rejected: "+err.Error())
		rep.Log(proto.LevelWarn, "falling back to uninstall + install — app data will be lost")
		if uerr := i.uninstall(ctx, job.PackageName); uerr != nil {
			return Result{Err: fmt.Errorf("in-place failed (%v) and uninstall failed: %w", err, uerr)}
		}
		mode = proto.InstallModeClean
		dataWiped = true
		err = i.installSession(ctx, job, paths, rep)
	}
	if err != nil {
		return Result{InstallMode: mode, DataWiped: dataWiped, Err: err}
	}

	// --- 6. verify -------------------------------------------------------
	rep.Progress(proto.StateVerifying, 0, "checking installed version")
	installed, verr := i.verify(ctx, job)
	if verr != nil {
		return Result{InstallMode: mode, DataWiped: dataWiped, Err: verr}
	}

	// --- 7. post-install hook -------------------------------------------
	if strings.TrimSpace(job.PostInstallHook) != "" {
		rep.Log(proto.LevelInfo, "running post-install hook")
		if out, err := i.Sys.Shell(ctx, job.PostInstallHook); err != nil {
			rep.Log(proto.LevelWarn, fmt.Sprintf("post-install hook failed: %v %s", err, out))
		}
	}

	// The bundle has done its job; on a 8 GB box 170 MB is worth reclaiming.
	os.Remove(bundlePath)

	return Result{
		OK:                   true,
		InstallMode:          mode,
		DataWiped:            dataWiped,
		InstalledVersion:     installed.VersionName,
		InstalledVersionCode: installed.VersionCode,
	}
}

// --- download --------------------------------------------------------------

func (i *Installer) download(ctx context.Context, job proto.InstallJob, dest string, rep Reporter) error {
	// A previous attempt may have finished the download and died later.
	if sum, err := fileSHA256(dest); err == nil && sum == job.SHA256 {
		rep.Progress(proto.StateDownloading, 100, "bundle already on device")
		return nil
	}

	var offset int64
	if st, err := os.Stat(dest); err == nil && st.Size() < job.SizeBytes {
		offset = st.Size()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, job.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+i.Token)
	if offset > 0 {
		// Resume rather than restart: a box on a bad uplink can take several
		// tries to pull 170 MB, and starting over each time never converges.
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}

	client := i.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	flags := os.O_CREATE | os.O_WRONLY
	switch resp.StatusCode {
	case http.StatusPartialContent:
		flags |= os.O_APPEND
	case http.StatusOK:
		// Server ignored the Range header; start over.
		offset = 0
		flags |= os.O_TRUNC
	default:
		return fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}

	out, err := os.OpenFile(dest, flags, 0o644)
	if err != nil {
		return err
	}

	written := offset
	lastPct := -1
	lastReport := time.Now()
	buf := make([]byte, 256*1024)

	for {
		select {
		case <-ctx.Done():
			out.Close()
			return ctx.Err()
		default:
		}

		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				out.Close()
				return werr
			}
			written += int64(n)
			if job.SizeBytes > 0 {
				pct := int(written * 100 / job.SizeBytes)
				if pct != lastPct && time.Since(lastReport) > 2*time.Second {
					lastPct = pct
					lastReport = time.Now()
					rep.Progress(proto.StateDownloading, pct,
						fmt.Sprintf("%s / %s", humanBytes(uint64(written)), humanBytes(uint64(job.SizeBytes))))
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			out.Close()
			return fmt.Errorf("download: %w", rerr)
		}
	}

	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	out.Close()

	rep.Progress(proto.StateDownloading, 100, "verifying checksum")
	sum, err := fileSHA256(dest)
	if err != nil {
		return err
	}
	if sum != job.SHA256 {
		// Whatever is on disk is not what the server has. Drop it so the next
		// attempt is a clean download rather than a resume of garbage.
		os.Remove(dest)
		return fmt.Errorf("checksum mismatch: expected %s, got %s", job.SHA256, sum)
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// --- install session -------------------------------------------------------

func (i *Installer) installSession(ctx context.Context, job proto.InstallJob, paths []string, rep Reporter) error {
	var total int64
	sizes := make([]int64, len(paths))
	for idx, p := range paths {
		st, err := os.Stat(p)
		if err != nil {
			return err
		}
		sizes[idx] = st.Size()
		total += st.Size()
	}

	out, err := i.Sys.Exec(ctx, "pm", "install-create",
		"-r", // reinstall, keeping data
		"-d", // allow version downgrade
		"--user", "0",
		// PoGo checks who installed it; the Play Store is the expected answer.
		"-i", "com.android.vending",
		"-S", fmt.Sprint(total),
	)
	if err != nil {
		return fmt.Errorf("install-create: %w", err)
	}
	m := sessionIDRe.FindStringSubmatch(out)
	if len(m) != 2 {
		return fmt.Errorf("could not parse session id from %q", out)
	}
	session := m[1]
	rep.Log(proto.LevelDebug, "install session "+session)

	committed := false
	defer func() {
		if !committed {
			// Abandoned sessions hold on to their staged bytes until reboot.
			_, _ = i.Sys.Exec(ctx, "pm", "install-abandon", session)
		}
	}()

	for idx, p := range paths {
		name := filepath.Base(p)
		rep.Progress(proto.StateInstalling, (idx*80)/len(paths), "writing "+name)

		_, err := i.Sys.Exec(ctx, "pm", "install-write", "-S", fmt.Sprint(sizes[idx]), session, name, p)
		if err != nil {
			// Older ROMs reject a path argument and only accept the APK on
			// stdin.
			rep.Log(proto.LevelDebug, "install-write by path failed, piping instead")
			script := fmt.Sprintf("cat %s | pm install-write -S %d %s %s -",
				shellQuote(p), sizes[idx], session, shellQuote(name))
			if _, perr := i.Sys.Shell(ctx, script); perr != nil {
				return fmt.Errorf("install-write %s: %w", name, perr)
			}
		}
	}

	rep.Progress(proto.StateInstalling, 90, "committing session")
	commitOut, err := i.Sys.Exec(ctx, "pm", "install-commit", session)
	if err != nil {
		return fmt.Errorf("install-commit: %w", err)
	}
	if strings.Contains(commitOut, "Failure") {
		return fmt.Errorf("install-commit: %s", commitOut)
	}
	committed = true

	rep.Progress(proto.StateInstalling, 100, "installed")
	return nil
}

func (i *Installer) uninstall(ctx context.Context, pkg string) error {
	if _, err := i.Sys.Exec(ctx, "pm", "uninstall", "--user", "0", pkg); err != nil {
		// Some ROMs refuse --user 0 for a non-system app.
		if _, err2 := i.Sys.Exec(ctx, "pm", "uninstall", pkg); err2 != nil {
			return err2
		}
	}
	return nil
}

func (i *Installer) verify(ctx context.Context, job proto.InstallJob) (proto.PackageInfo, error) {
	// The package manager needs a moment to settle after a commit.
	var info proto.PackageInfo
	for attempt := 0; attempt < 5; attempt++ {
		var err error
		info, err = i.Sys.PackageInfo(ctx, job.PackageName)
		if err == nil && info.Installed && info.VersionName == job.Version {
			return info, nil
		}
		select {
		case <-ctx.Done():
			return info, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}

	if !info.Installed {
		return info, fmt.Errorf("%s is not installed after commit", job.PackageName)
	}
	return info, fmt.Errorf("expected version %s after install, found %s", job.Version, info.VersionName)
}

// --- helpers ---------------------------------------------------------------

func isIncompatible(err error) bool {
	return matchesAny(err, incompatibleErrors)
}

func isVerificationBlocked(err error) bool {
	return matchesAny(err, verificationErrors)
}

func matchesAny(err error, needles []string) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, needle := range needles {
		if strings.Contains(msg, needle) {
			return true
		}
	}
	return false
}

func fail(err error) Result { return Result{Err: err} }

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func humanBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
