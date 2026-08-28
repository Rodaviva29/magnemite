// Package monitor answers "is this box actually working" on every heartbeat.
//
// The hub decides what to do about a bad answer; this side only looks. The
// split matters because the evidence is local and expensive to ship: a stalled
// scanner is visible as a pattern in its own log file, and streaming that log
// to the hub every twenty seconds to run one regex against it would cost more
// than the whole heartbeat.
//
// So the hub sends a spec — what to look at and what counts as bad — and gets
// back a boolean per check plus one line of detail. Nothing here is
// hard-coded: every MITM writes a different log, answers to a different
// service name and calls its health line something else, which is why the
// patterns are rows in a database rather than constants in this file.
package monitor

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"magnemite/agent/internal/proto"
	"magnemite/agent/internal/sys"
)

// A detail rides every heartbeat, and a frame is capped at 1 MB. One line is
// what an operator reads; a log window is what they collect the logs for.
const maxDetail = 512

// Result is what one pass saw. A zero value is the honest answer for a box
// that was asked nothing, and the hub reads every empty field as unknown
// rather than as healthy.
type Result struct {
	Foreground string
	ANR        []string
	Checks     []proto.CheckResult
}

// Collect runs the spec, giving up once budget is spent.
//
// Whatever did not get to run reports nothing at all rather than a failure:
// a probe the box was too busy to answer is not evidence that the thing it
// watches is broken, and treating it as such is how a monitor ends up
// rebooting a fleet because one dumpsys was slow.
func Collect(ctx context.Context, s sys.System, spec *proto.MonitorSpec, budget time.Duration) Result {
	var out Result
	if spec == nil {
		return out
	}

	deadline := time.Now().Add(budget)
	spent := func() bool { return !time.Now().Before(deadline) }

	if spec.Foreground {
		out.Foreground = foreground(ctx, s)
	}
	if spec.ANR && !spent() {
		out.ANR = anrPackages(ctx, s)
	}

	for _, check := range spec.Checks {
		if spent() {
			break
		}
		out.Checks = append(out.Checks, run(ctx, s, check))
	}
	return out
}

// --- foreground ------------------------------------------------------------

// The activity a line names, as `<package>/<component>`. Matches both the
// ActivityRecord form (`u0 com.example.app/.MainActivity t42`) and the Window
// form (`com.example.app/com.example.app.MainActivity`).
var activityRe = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)/[.\w$]+`)

// The keys that name the focused activity, best first.
//
// mFocusedApp leads because it is the one aconf has been reading in
// production on this hardware for years. The other two are what different
// Android versions call the same thing, and are only consulted when the first
// is missing or says null — which happens while the launcher is up.
var focusKeys = []string{"mFocusedApp", "topResumedActivity", "mResumedActivity", "mCurrentFocus"}

func foreground(ctx context.Context, s sys.System) string {
	// Both dumpsys calls in one shell, filtered on the box. The unfiltered
	// output is hundreds of kilobytes and all of it is thrown away here.
	out, err := s.Shell(ctx, "dumpsys activity activities 2>/dev/null | grep -E "+
		"'mFocusedApp|topResumedActivity|mResumedActivity' | head -n 6; "+
		"dumpsys window 2>/dev/null | grep mCurrentFocus | head -n 2")
	if err != nil && out == "" {
		return ""
	}
	return parseFocused(out)
}

// parseFocused picks the package out of whatever dumpsys printed. Split from
// the shell call because the shapes it has to survive vary by Android version
// and by ROM, and the only way to be sure about that is a table of real
// output.
func parseFocused(out string) string {
	lines := strings.Split(out, "\n")
	for _, key := range focusKeys {
		for _, line := range lines {
			if !strings.Contains(line, key) {
				continue
			}
			// "mFocusedApp=null" is the launcher, not a parse failure. Fall
			// through to the next key rather than reporting a wrong package.
			if m := activityRe.FindStringSubmatch(line); m != nil {
				return m[1]
			}
		}
	}
	return ""
}

// --- ANR -------------------------------------------------------------------

var anrRe = regexp.MustCompile(`Application Not Responding:?\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)`)

func anrPackages(ctx context.Context, s sys.System) []string {
	// The dialog shows up in the window list; the process table carries the
	// same string. Read both and let the grep keep the output small.
	out, err := s.Shell(ctx, "{ dumpsys window windows; dumpsys activity processes; } 2>/dev/null "+
		"| grep -i 'Application Not Responding' | head -n 20")
	if err != nil && out == "" {
		return nil
	}
	return parseANR(out)
}

func parseANR(out string) []string {
	seen := map[string]bool{}
	var packages []string
	for _, m := range anrRe.FindAllStringSubmatch(out, -1) {
		pkg := m[1]
		if seen[pkg] {
			continue
		}
		seen[pkg] = true
		packages = append(packages, pkg)
	}
	return packages
}

// --- checks ----------------------------------------------------------------

func run(ctx context.Context, s sys.System, spec proto.MonitorCheckSpec) proto.CheckResult {
	seconds := spec.TimeoutSeconds
	if seconds <= 0 {
		seconds = 10
	}
	cctx, cancel := context.WithTimeout(ctx, time.Duration(seconds)*time.Second)
	defer cancel()

	started := time.Now()
	var ok bool
	var detail string

	switch spec.Kind {
	case "shell":
		ok, detail = runShell(cctx, s, spec)
	case "http":
		ok, detail = runHTTP(cctx, spec)
	case "logMatch":
		ok, detail = runLogMatch(cctx, s, spec)
	default:
		ok, detail = false, fmt.Sprintf("unknown check kind %q", spec.Kind)
	}

	return proto.CheckResult{
		ID:     spec.ID,
		OK:     ok,
		Detail: truncate(detail),
		Ms:     time.Since(started).Milliseconds(),
	}
}

// runShell passes when the command succeeds and, if a pattern was given, its
// output matches. This is the one that answers "is the mapping service up":
// `dumpsys activity services | grep MappingService`, whose exit status is the
// whole answer.
func runShell(ctx context.Context, s sys.System, spec proto.MonitorCheckSpec) (bool, string) {
	out, err := s.Shell(ctx, spec.Target)
	if err != nil {
		if ctx.Err() != nil {
			return false, fmt.Sprintf("timed out after %ds", spec.TimeoutSeconds)
		}
		return false, firstLine(out, err.Error())
	}
	if spec.Expect == "" {
		return true, ""
	}

	re, rerr := regexp.Compile(spec.Expect)
	if rerr != nil {
		return false, "bad expect pattern: " + rerr.Error()
	}
	if re.MatchString(out) {
		return true, ""
	}
	return false, "no match for " + spec.Expect
}

func runHTTP(ctx context.Context, spec proto.MonitorCheckSpec) (bool, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, spec.Target, nil)
	if err != nil {
		return false, err.Error()
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer res.Body.Close()
	// Drained so the connection can be reused rather than torn down every beat.
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))

	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return true, ""
	}
	return false, fmt.Sprintf("HTTP %d", res.StatusCode)
}

// runLogMatch is the one that carries the real signals.
//
// The health of a scanner is not a boolean anywhere — it is a count of fault
// lines in a window of its log, and often only a fault when it outnumbers the
// work getting done. aconf's health check is exactly that shape: ten "seconds
// since last ping" lines only matter when there are fewer than ten successful
// worker jobs beside them. So this counts both, and can compare them.
//
// The staleness test is deliberately the file's own mtime rather than a
// timestamp parsed out of a line: every MITM formats its log differently, and
// "nothing has been written here for five minutes" is both format-independent
// and precisely what a stalled loop looks like.
func runLogMatch(ctx context.Context, s sys.System, spec proto.MonitorCheckSpec) (bool, string) {
	lines := spec.Lines
	if lines <= 0 {
		lines = 200
	}
	target := shellQuote(spec.Target)

	// The box's own clock for both halves of the age test, so a hub that
	// disagrees about the time cannot make a healthy log look stale.
	out, err := s.Shell(ctx, fmt.Sprintf(
		"date +%%s; stat -c %%Y %s 2>/dev/null || echo 0; tail -n %d %s 2>/dev/null",
		target, lines, target))
	if err != nil && out == "" {
		if ctx.Err() != nil {
			return false, fmt.Sprintf("timed out after %ds", spec.TimeoutSeconds)
		}
		return false, "could not read " + spec.Target
	}

	now, mtime, window := splitLogRead(out)
	if window == "" && mtime == 0 {
		return false, "no such log: " + spec.Target
	}

	if spec.MaxAgeSeconds > 0 && now > 0 && mtime > 0 {
		if age := now - mtime; age > int64(spec.MaxAgeSeconds) {
			return false, fmt.Sprintf("nothing written for %ds", age)
		}
	}

	if spec.Expect == "" {
		return true, ""
	}
	faultRe, rerr := regexp.Compile(spec.Expect)
	if rerr != nil {
		return false, "bad expect pattern: " + rerr.Error()
	}
	faults := len(faultRe.FindAllString(window, -1))

	failAt := spec.FailAt
	if failAt <= 0 {
		failAt = 1
	}
	if faults < failAt {
		return true, ""
	}

	// Past the count on its own. Without a success pattern that is the answer;
	// with one, the count only means something next to the work done beside it.
	if spec.SuccessPattern == "" {
		return false, fmt.Sprintf("%d matches in the last %d lines", faults, lines)
	}
	successRe, rerr := regexp.Compile(spec.SuccessPattern)
	if rerr != nil {
		return false, "bad success pattern: " + rerr.Error()
	}
	successes := len(successRe.FindAllString(window, -1))

	ratio := spec.MaxRatio
	if ratio <= 0 {
		ratio = 1
	}
	if float64(faults) >= float64(successes)*ratio {
		return false, fmt.Sprintf("%d faults against %d successes", faults, successes)
	}
	return true, ""
}

// splitLogRead pulls the two header lines runLogMatch asked for off the front
// of the output. A box whose toybox has no `stat -c` returns 0 for the mtime,
// which skips the age test rather than failing the check.
func splitLogRead(out string) (now, mtime int64, window string) {
	first, rest, ok := strings.Cut(out, "\n")
	if !ok {
		return 0, 0, ""
	}
	second, body, _ := strings.Cut(rest, "\n")
	now, _ = strconv.ParseInt(strings.TrimSpace(first), 10, 64)
	mtime, _ = strconv.ParseInt(strings.TrimSpace(second), 10, 64)
	return now, mtime, body
}

// --- helpers ---------------------------------------------------------------

// shellQuote wraps a path for `sh -c`. These paths come from the dashboard, so
// they are operator input rather than hostile input — but a log path with a
// space in it should read the file, not two of them.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func firstLine(out, fallback string) string {
	out = strings.TrimSpace(out)
	if out == "" {
		return fallback
	}
	if line, _, ok := strings.Cut(out, "\n"); ok {
		return line
	}
	return out
}

func truncate(detail string) string {
	if len(detail) <= maxDetail {
		return detail
	}
	return detail[:maxDetail] + "…"
}
