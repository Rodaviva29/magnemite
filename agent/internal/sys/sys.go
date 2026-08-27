// Package sys wraps everything the agent needs from the Android box it runs
// on: system properties, root shell, storage and package state.
//
// Every call goes through the System interface so the whole install pipeline
// can be exercised on a laptop against the Fake implementation — which is how
// fleet-scale load tests run without the hardware.
package sys

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"magnemite/agent/internal/proto"
)

type System interface {
	// Prop reads an Android system property. Empty string when unset.
	Prop(ctx context.Context, name string) string
	// Exec runs a binary directly.
	Exec(ctx context.Context, name string, args ...string) (string, error)
	// Shell runs a script through sh -c.
	Shell(ctx context.Context, script string) (string, error)
	// Disk reports free and total bytes on the filesystem holding path.
	Disk(path string) (free uint64, total uint64, err error)
	UptimeSeconds() int64
	// LoadAvg is the 1/5/15-minute run queue average out of /proc/loadavg.
	LoadAvg() (one float64, five float64, fifteen float64)
	// Memory reports total and available bytes out of /proc/meminfo.
	Memory() (total uint64, available uint64)
	CPUCount() int
	PackageInfo(ctx context.Context, pkg string) (proto.PackageInfo, error)
	// ThirdPartyPackages lists everything installed that did not ship with the
	// ROM. One `pm` call, no dumpsys per package — see Metrics for why.
	ThirdPartyPackages(ctx context.Context) ([]proto.PackageInfo, error)
	DeviceInfo(ctx context.Context) proto.DeviceInfo
	// LogcatStream starts logcat and hands back its output as it is written.
	// Exec is no good here: it waits for the process to end, and a live logcat
	// never does. Cancelling ctx, or closing the reader, kills the process.
	LogcatStream(ctx context.Context) (io.ReadCloser, error)
	// FileStream follows a file the same way, for the logs an app writes
	// itself rather than sending to logcat.
	FileStream(ctx context.Context, path string) (io.ReadCloser, error)
}

// Android is the real implementation. The agent is started by the Magisk
// service.sh, so it already runs as root and never needs to shell out to su.
type Android struct{}

func NewAndroid() *Android { return &Android{} }

func (a *Android) Exec(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		return text, fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, text)
	}
	return text, nil
}

func (a *Android) Shell(ctx context.Context, script string) (string, error) {
	return a.Exec(ctx, "sh", "-c", script)
}

func (a *Android) LogcatStream(ctx context.Context) (io.ReadCloser, error) {
	// -T 200, not a plain follow: logcat with no bound dumps the entire ring
	// buffer first, which is tens of thousands of lines arriving as fast as
	// the socket takes them. Two hundred is enough to see what just happened.
	return a.stream(ctx, "exec logcat -v time -T 200 2>&1")
}

// FileStream follows a file the way `tail -F` is supposed to.
//
// Not actually `tail -F`: that is toybox on these boxes, its follow support
// varies by ROM, and when it decides not to follow it still prints the tail
// first — which looks exactly like a working stream that then goes quiet. Done
// here, the polling loop is ours and behaves the same everywhere.
func (a *Android) FileStream(ctx context.Context, path string) (io.ReadCloser, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	offset, err := tailOffset(file, followTailLines)
	if err != nil {
		file.Close()
		return nil, err
	}

	reader, writer := io.Pipe()
	go followFile(ctx, file, path, offset, writer)
	return reader, nil
}

const (
	// Lines of context when a follow starts, matching logcat's -T.
	followTailLines = 200
	// How long to wait for more, when the log is busy and when it is not.
	//
	// A log being written to is checked often, so lines land in the panel
	// while they still feel live; one that has gone quiet backs off, because
	// waking four times a second to find nothing is the only thing polling
	// could plausibly waste. Either way it is one read on an open handle.
	followBusyInterval = 250 * time.Millisecond
	followIdleInterval = time.Second
	// How long a log counts as busy after its last line.
	followBusyFor = 5 * time.Second
)

// tailOffset finds where the last `lines` lines start, reading backwards in
// chunks so a 200 MB log does not become 200 MB of memory.
func tailOffset(file *os.File, lines int) (int64, error) {
	stat, err := file.Stat()
	if err != nil {
		return 0, err
	}

	const chunk = 8 * 1024
	end := stat.Size()
	buf := make([]byte, chunk)
	newlines := 0

	for pos := end; pos > 0; {
		size := int64(chunk)
		if pos < size {
			size = pos
		}
		pos -= size

		if _, err := file.ReadAt(buf[:size], pos); err != nil && err != io.EOF {
			return 0, err
		}
		for i := int(size) - 1; i >= 0; i-- {
			if buf[i] != '\n' {
				continue
			}
			newlines++
			// The newline *before* the first line we want to show.
			if newlines > lines {
				return pos + int64(i) + 1, nil
			}
		}
	}
	// Fewer lines in the file than asked for: start at the beginning.
	return 0, nil
}

// followFile reads to EOF, waits, and reads again — starting over when the
// file is rotated, truncated or rewritten, which are the three ways a log
// stops being the file we opened.
func followFile(ctx context.Context, file *os.File, path string, offset int64, writer *io.PipeWriter) {
	defer writer.Close()
	defer file.Close()

	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		writer.CloseWithError(err)
		return
	}
	head := headPrint(file, headPrintBytes)
	var checkedAt time.Time

	// reopenIfStale starts the file over when it is no longer the one we have
	// been reading. Three ways that happens:
	//
	//   shorter than where we are   truncated
	//   a different inode           rotated away and recreated
	//   a different opening         truncated *and* rewritten, which the size
	//                               alone misses whenever the new content is
	//                               longer than our position
	//
	// Only as many bytes as were captured are compared: appending never
	// changes the opening of a file, so a growing log stays the same log.
	//
	// Called before every read, not only when the file goes quiet: a rewrite
	// between two reads would otherwise be consumed as if it were more of the
	// same file, and the panel would show a line starting halfway through.
	//
	// `force` is set whenever the last read drained the file, which is the
	// moment a rewrite can actually slip in. While a backlog is being consumed
	// there is no such gap, so those reads only pay for a check occasionally.
	reopenIfStale := func(force bool) {
		if !force && time.Since(checkedAt) < headCheckInterval {
			return
		}
		checkedAt = time.Now()

		stat, err := os.Stat(path)
		if err != nil {
			return // gone for the moment; it may come back
		}

		stale := stat.Size() < offset ||
			!sameFile(file, stat) ||
			(len(head) > 0 && headPrintAt(path, len(head)) != head)

		if !stale {
			// A log that was shorter than the fingerprint when it was opened
			// has more of an opening now. Take it, so the next check has
			// something to compare against.
			if len(head) < headPrintBytes {
				head = headPrintAt(path, headPrintBytes)
			}
			return
		}

		replacement, err := os.Open(path)
		if err != nil {
			return
		}
		file.Close()
		file = replacement
		offset = 0
		head = headPrint(file, headPrintBytes)
	}

	buf := make([]byte, 32*1024)
	drained := true
	lastLine := time.Now()

	for {
		reopenIfStale(drained)

		n, err := file.Read(buf)
		if n > 0 {
			if _, werr := writer.Write(buf[:n]); werr != nil {
				return // the reader went away
			}
			offset += int64(n)
			lastLine = time.Now()
			// A full buffer means there is more waiting; anything less means
			// we are at the end of the file as it stands.
			drained = n < len(buf)
			continue
		}
		drained = true
		if err != nil && err != io.EOF {
			writer.CloseWithError(err)
			return
		}

		// A log being written to is worth checking often; one that has gone
		// quiet is not.
		wait := followIdleInterval
		if time.Since(lastLine) < followBusyFor {
			wait = followBusyInterval
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

const (
	// Enough of a file's opening to notice it started over, and cheap enough
	// to read this often.
	headPrintBytes = 64
	// Ceiling on how often the file behind the handle is re-examined. Below
	// human reaction time, and far above how often it is worth stat'ing a log.
	headCheckInterval = 200 * time.Millisecond
)

func headPrint(file *os.File, size int) string {
	buf := make([]byte, size)
	n, err := file.ReadAt(buf, 0)
	if err != nil && err != io.EOF {
		return ""
	}
	return string(buf[:n])
}

func headPrintAt(path string, size int) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	return headPrint(file, size)
}

func sameFile(file *os.File, stat os.FileInfo) bool {
	current, err := file.Stat()
	if err != nil {
		return false
	}
	return os.SameFile(current, stat)
}

// stream runs a command that keeps writing — logcat, in practice — with stderr
// folded into stdout by the script itself, so a failure reaches the panel
// instead of vanishing.
func (a *Android) stream(ctx context.Context, script string) (io.ReadCloser, error) {
	cmd := exec.CommandContext(ctx, "sh", "-c", script)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &processReader{ReadCloser: stdout, cmd: cmd}, nil
}

// processReader ties the pipe's lifetime to the process behind it: closing the
// reader kills logcat rather than leaving it writing into a pipe nobody reads.
type processReader struct {
	io.ReadCloser
	cmd *exec.Cmd
}

func (p *processReader) Close() error {
	err := p.ReadCloser.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	_ = p.cmd.Wait()
	return err
}

func (a *Android) Prop(ctx context.Context, name string) string {
	out, err := a.Exec(ctx, "getprop", name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func (a *Android) UptimeSeconds() int64 {
	out, err := a.Shell(context.Background(), "cat /proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(out)
	if len(fields) == 0 {
		return 0
	}
	secs, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return int64(secs)
}

// procField pulls one whitespace-separated field out of a /proc file. These
// are the cheapest readings on the box: no fork, no dumpsys, a few hundred
// bytes each.
func readProc(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

func (a *Android) LoadAvg() (float64, float64, float64) {
	fields := strings.Fields(readProc("/proc/loadavg"))
	if len(fields) < 3 {
		return 0, 0, 0
	}
	one, _ := strconv.ParseFloat(fields[0], 64)
	five, _ := strconv.ParseFloat(fields[1], 64)
	fifteen, _ := strconv.ParseFloat(fields[2], 64)
	return one, five, fifteen
}

func (a *Android) Memory() (uint64, uint64) {
	var total, available uint64
	scanner := bufio.NewScanner(strings.NewReader(readProc("/proc/meminfo")))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		// Values are in kB; the third field is the unit when present.
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = value * 1024
		case "MemAvailable:":
			available = value * 1024
		}
		if total > 0 && available > 0 {
			break
		}
	}
	return total, available
}

func (a *Android) CPUCount() int {
	return runtime.NumCPU()
}

// `pm list packages -3 --show-versioncode` prints one line per third-party
// package: "package:com.example.app versionCode:1234". That is the whole
// inventory in a single call — the alternative, a dumpsys per package, is
// what makes this expensive enough to be worth doing rarely.
func (a *Android) ThirdPartyPackages(ctx context.Context) ([]proto.PackageInfo, error) {
	out, err := a.Exec(ctx, "pm", "list", "packages", "-3", "--show-versioncode")
	if err != nil {
		// Older builds of pm do not know --show-versioncode; the names alone
		// are still worth having.
		out, err = a.Exec(ctx, "pm", "list", "packages", "-3")
		if err != nil {
			return nil, err
		}
	}

	var packages []proto.PackageInfo
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		info, ok := parsePackageLine(scanner.Text())
		if ok {
			packages = append(packages, info)
		}
	}
	return packages, scanner.Err()
}

// ParsePackageLine is split out so the parsing is testable without a device.
func parsePackageLine(line string) (proto.PackageInfo, bool) {
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) == 0 || !strings.HasPrefix(fields[0], "package:") {
		return proto.PackageInfo{}, false
	}

	name := strings.TrimPrefix(fields[0], "package:")
	if name == "" {
		return proto.PackageInfo{}, false
	}

	info := proto.PackageInfo{PackageName: name, Installed: true}
	for _, field := range fields[1:] {
		if code, ok := strings.CutPrefix(field, "versionCode:"); ok {
			info.VersionCode = code
		}
	}
	return info, true
}

var (
	versionNameRe = regexp.MustCompile(`versionName=([^\s]+)`)
	versionCodeRe = regexp.MustCompile(`versionCode=(\d+)`)
)

func (a *Android) PackageInfo(ctx context.Context, pkg string) (proto.PackageInfo, error) {
	info := proto.PackageInfo{PackageName: pkg}

	out, err := a.Exec(ctx, "dumpsys", "package", pkg)
	if err != nil || strings.TrimSpace(out) == "" {
		// dumpsys prints nothing useful for a package that is not installed.
		info.Installed = false
		return info, nil
	}
	if !strings.Contains(out, "Package [") {
		info.Installed = false
		return info, nil
	}

	info.Installed = true
	// Take the first match: later blocks in dumpsys describe hidden/system
	// copies of the package rather than what is actually running.
	if m := versionNameRe.FindStringSubmatch(out); len(m) == 2 {
		info.VersionName = m[1]
	}
	if m := versionCodeRe.FindStringSubmatch(out); len(m) == 2 {
		info.VersionCode = m[1]
	}
	return info, nil
}

func (a *Android) DeviceInfo(ctx context.Context) proto.DeviceInfo {
	sdk, _ := strconv.Atoi(a.Prop(ctx, "ro.build.version.sdk"))
	density, _ := strconv.Atoi(a.Prop(ctx, "ro.sf.lcd_density"))

	serial := a.Prop(ctx, "ro.serialno")
	if serial == "" {
		serial = a.Prop(ctx, "ro.boot.serialno")
	}
	if serial == "" {
		// Some cheap TV boxes ship without a serial property at all. A MAC is
		// stable enough to identify the box across re-enrollments.
		serial = fallbackSerial(ctx, a)
	}

	abi := a.Prop(ctx, "ro.product.cpu.abi")

	return proto.DeviceInfo{
		Serial:         serial,
		Manufacturer:   a.Prop(ctx, "ro.product.manufacturer"),
		Model:          a.Prop(ctx, "ro.product.model"),
		AndroidVersion: a.Prop(ctx, "ro.build.version.release"),
		SdkInt:         sdk,
		Abi:            abi,
		Density:        density,
		LocalIp:        LocalIP(),
	}
}

// LocalIP returns the box's LAN address, empty when it has none.
//
// A TV box normally has exactly one usable interface up (wlan0 or eth0), but
// it can also carry docker/tun leftovers and a link-local 169.254 address
// while DHCP is still running. Prefer a real private address, and among those
// the one on an interface that looks like the box's own network card.
func LocalIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}

	var fallback string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil || !ip.IsPrivate() || ip.IsLinkLocalUnicast() {
				continue
			}
			if isPhysicalIface(iface.Name) {
				return ip.String()
			}
			if fallback == "" {
				fallback = ip.String()
			}
		}
	}
	return fallback
}

func isPhysicalIface(name string) bool {
	for _, prefix := range []string{"wlan", "eth", "en", "wl", "rmnet"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

func fallbackSerial(ctx context.Context, a *Android) string {
	out, err := a.Shell(ctx, "cat /sys/class/net/*/address 2>/dev/null | head -n 1")
	if err == nil {
		mac := strings.TrimSpace(out)
		if mac != "" && mac != "00:00:00:00:00:00" {
			return "mac-" + strings.ReplaceAll(mac, ":", "")
		}
	}
	return fmt.Sprintf("unknown-%d", time.Now().UnixNano())
}

// Metrics gathers everything the hub wants on a heartbeat.
//
// Cost matters here: this runs every 20 seconds on a box whose day job is
// scanning. Load, memory and cpu count are three small /proc reads and are
// always included. The package versions are not: `dumpsys package` prints a
// wall of text per package, so only the packages the hub asked to track get
// one, and the full third-party inventory — a single `pm list packages` — is
// gathered on request rather than on every beat.
func Metrics(ctx context.Context, s System, packages []string, withInventory bool) proto.DeviceMetrics {
	free, total, _ := s.Disk("/data")
	one, five, fifteen := s.LoadAvg()
	memTotal, memAvailable := s.Memory()

	m := proto.DeviceMetrics{
		FreeBytes:         free,
		TotalBytes:        total,
		UptimeSeconds:     s.UptimeSeconds(),
		LoadAvg1:          one,
		LoadAvg5:          five,
		LoadAvg15:         fifteen,
		CPUCount:          s.CPUCount(),
		MemTotalBytes:     memTotal,
		MemAvailableBytes: memAvailable,
	}

	seen := map[string]bool{}
	for _, pkg := range packages {
		info, err := s.PackageInfo(ctx, pkg)
		if err != nil {
			continue
		}
		seen[info.PackageName] = true
		m.Packages = append(m.Packages, info)
	}

	if withInventory {
		installed, err := s.ThirdPartyPackages(ctx)
		if err == nil {
			m.PackagesComplete = true
			for _, info := range installed {
				// The tracked entry already carries a versionName, which the
				// inventory does not: never overwrite it with the thinner one.
				if seen[info.PackageName] {
					continue
				}
				m.Packages = append(m.Packages, info)
			}
		}
	}

	return m
}

// ParseDumpsysVersion is exported for tests and for the verify step, which
// re-reads dumpsys output after an install.
func ParseDumpsysVersion(out string) (versionName string, versionCode string) {
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if versionName == "" {
			if m := versionNameRe.FindStringSubmatch(line); len(m) == 2 {
				versionName = m[1]
			}
		}
		if versionCode == "" {
			if m := versionCodeRe.FindStringSubmatch(line); len(m) == 2 {
				versionCode = m[1]
			}
		}
		if versionName != "" && versionCode != "" {
			break
		}
	}
	return versionName, versionCode
}
