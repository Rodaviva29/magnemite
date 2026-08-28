package deviceconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"magnemite/agent/internal/proto"
	"magnemite/agent/internal/sys"
)

const agentConfig = "/data/adb/magnemite/config.json"

func TestCheckPathRefusals(t *testing.T) {
	refused := []struct {
		path string
		why  string
	}{
		{"", "empty"},
		{"data/local/tmp/x.json", "relative"},
		{"/data/local/tmp/../../adb/magnemite/config.json", "traversal"},
		{"/data/local//tmp/x.json", "double slash"},
		{"/data/local/tmp/", "trailing slash"},
		{"/system/etc/x.json", "system"},
		{"/vendor/x.json", "vendor"},
		{"/proc/x", "proc"},
		{"/sys/x", "sys"},
		{"/dev/x", "dev"},
		// The one that matters most: this file holds the box's device token,
		// so a config push able to reach it is a way to rewrite the fleet's
		// credentials from the dashboard.
		{agentConfig, "the agent's own config"},
		{"/data/adb/magnemite/anything.json", "Magnemite's own directory"},
	}

	for _, tc := range refused {
		if err := checkPath(tc.path, agentConfig); err == nil {
			t.Errorf("checkPath(%q) allowed it; expected a refusal (%s)", tc.path, tc.why)
		}
	}
}

// The directory refusal must not depend on the -config flag being what it
// should be: a fake box, or one started with -config elsewhere, still refuses.
func TestAgentDirectoryRefusedRegardlessOfConfigFlag(t *testing.T) {
	if err := checkPath(agentConfig, ".dev/fleet/fake-001.json"); err == nil {
		t.Error("wrote into Magnemite's own directory when the config flag pointed elsewhere")
	}
}

func TestCheckPathAllowsRealMitmPaths(t *testing.T) {
	// The paths aconf actually uses. Note these are Android paths on a laptop:
	// the `path` package is what makes them absolute here, `filepath` would
	// say otherwise on Windows and refuse every one of them.
	for _, p := range []string{
		"/data/local/tmp/aegis_config.json",
		"/data/local/tmp/atlas_config.json",
		"/data/local/tmp/config.json",
		"/sdcard/Download/x.json",
	} {
		if err := checkPath(p, agentConfig); err != nil {
			t.Errorf("checkPath(%q) refused a real MITM config path: %v", p, err)
		}
	}
}

func TestParseMode(t *testing.T) {
	if mode, err := parseMode(""); err != nil || mode != 0o644 {
		t.Errorf("empty mode = %v, %v; want 0644, nil", mode, err)
	}
	// Octal, not decimal: "600" read as six hundred is 0o1130.
	if mode, err := parseMode("600"); err != nil || mode != 0o600 {
		t.Errorf(`parseMode("600") = %v, %v; want 0600, nil`, mode, err)
	}
	for _, bad := range []string{"999", "abc", "0", "7777"} {
		if _, err := parseMode(bad); err == nil {
			t.Errorf("parseMode(%q) allowed it; expected an error", bad)
		}
	}
}

func TestApplyWritesAndHashesWhatIsOnDisk(t *testing.T) {
	fake := sys.NewFake("test-serial", filepath.Join(t.TempDir(), "box.json"))
	content := `{"deviceName":"atv-014","workers":8}`

	res, err := Apply(fake, proto.ConfigFile{
		Path:    "/data/local/tmp/aegis_config.json",
		Content: content,
	}, agentConfig)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}

	want := sha256.Sum256([]byte(content))
	if res.SHA256 != hex.EncodeToString(want[:]) {
		t.Errorf("sha256 = %q; want the hash of the content written", res.SHA256)
	}
}

func TestApplyLeavesNoTempFileBehind(t *testing.T) {
	state := filepath.Join(t.TempDir(), "box.json")
	fake := sys.NewFake("test-serial", state)

	if _, err := Apply(fake, proto.ConfigFile{
		Path:    "/data/local/tmp/aegis_config.json",
		Content: "{}",
	}, agentConfig); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	// A leftover .tmp beside a good config is what a rename that did not happen
	// looks like, and the next reader might pick it up.
	dir := sys.FakeFilesDir(state, "test-serial")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("left a temp file behind: %s", e.Name())
		}
	}
}

func TestApplyRefusesBeforeWriting(t *testing.T) {
	fake := sys.NewFake("test-serial", filepath.Join(t.TempDir(), "box.json"))
	if _, err := Apply(fake, proto.ConfigFile{
		Path:    agentConfig,
		Content: "{}",
	}, agentConfig); err == nil {
		t.Fatal("Apply wrote to the agent's own config; expected a refusal")
	}
}
