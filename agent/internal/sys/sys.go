// Package sys wraps everything the agent needs from the Android box it runs
// on: system properties, root shell, storage and package state.
//
// Every call goes through the System interface so the whole install pipeline
// can be exercised on a laptop against the Fake implementation — which is how
// 200-device load tests run without 200 devices.
package sys

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
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
	PackageInfo(ctx context.Context, pkg string) (proto.PackageInfo, error)
	DeviceInfo(ctx context.Context) proto.DeviceInfo
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
	}
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
func Metrics(ctx context.Context, s System, packages []string) proto.DeviceMetrics {
	free, total, _ := s.Disk("/data")
	m := proto.DeviceMetrics{
		FreeBytes:     free,
		TotalBytes:    total,
		UptimeSeconds: s.UptimeSeconds(),
	}
	for _, pkg := range packages {
		info, err := s.PackageInfo(ctx, pkg)
		if err != nil {
			continue
		}
		m.Packages = append(m.Packages, info)
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
