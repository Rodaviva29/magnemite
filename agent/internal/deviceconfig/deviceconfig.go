// Package deviceconfig writes a config file the hub sent.
//
// One caller: the install pipeline, which writes a MITM's config between the
// verify and the post-install hook. There was a second — a socket handler for
// a WriteConfig message pushed from the dashboard, which also ran a restart
// command to make the running process re-read the file. Both are gone; the
// post-install hook is what starts the MITM, and it starts it after this.
//
// Most of what is here is refusals. The path is typed by an operator into a
// form, and a root process taking arbitrary paths from the network is one typo
// away from overwriting something that cannot be put back.
package deviceconfig

import (
	"fmt"
	"os"
	"path"
	"strconv"
	"strings"

	"magnemite/agent/internal/proto"
	"magnemite/agent/internal/sys"
)

// Directories nothing the hub sends may write into. Not a general sandbox —
// the config of a MITM lives wherever that MITM decided — but the places where
// a mistake is unrecoverable rather than merely wrong.
var forbiddenRoots = []string{
	"/system",
	"/vendor",
	"/product",
	"/apex",
	"/proc",
	"/sys",
	"/dev",
	"/boot",
	// Magnemite's own directory on a real box. The agent's config lives here
	// and holds this box's device token, so a config push able to write it
	// would be a way to rewrite the fleet's credentials from the dashboard.
	//
	// Refused as a directory as well as by name below: the name check reads
	// the path the agent was actually started with, and this does not depend
	// on that flag being what it should be.
	"/data/adb/magnemite",
}

// Result is what to report back about a write that happened.
type Result struct {
	// SHA256 of the bytes on disk, read back after the rename. Empty only when
	// the write itself failed.
	SHA256 string
}

// Apply validates and writes.
//
// agentConfigPath is the agent's own config, which holds this box's device
// token: a config write able to overwrite it would be a way to rewrite the
// fleet's credentials from the dashboard, so it is refused by name rather than
// by directory.
func Apply(
	s sys.System,
	file proto.ConfigFile,
	agentConfigPath string,
) (Result, error) {
	if err := checkPath(file.Path, agentConfigPath); err != nil {
		return Result{}, err
	}

	mode, err := parseMode(file.Mode)
	if err != nil {
		return Result{}, err
	}

	sha, err := s.WriteFileAtomic(file.Path, []byte(file.Content), mode)
	if err != nil {
		return Result{}, fmt.Errorf("write %s: %w", file.Path, err)
	}
	return Result{SHA256: sha}, nil
}

func checkPath(p, agentConfigPath string) error {
	if p == "" {
		return fmt.Errorf("no path")
	}
	if !strings.HasPrefix(p, "/") {
		return fmt.Errorf("path must be absolute: %s", p)
	}
	// path.Clean collapses "a/../b", but a path that needed collapsing was
	// built by something that did not mean what it said — refuse rather than
	// silently write somewhere else.
	if p != path.Clean(p) {
		return fmt.Errorf("path must be normalised: %s", p)
	}
	for _, root := range forbiddenRoots {
		if p == root || strings.HasPrefix(p, root+"/") {
			return fmt.Errorf("refusing to write under %s: %s", root, p)
		}
	}
	if agentConfigPath != "" && path.Clean(p) == path.Clean(agentConfigPath) {
		return fmt.Errorf("refusing to overwrite the agent's own config: %s", p)
	}
	return nil
}

// parseMode reads the octal string the hub sends. Empty means 0644, which is
// what a config in /data/local/tmp wants: readable by the app that reads it.
func parseMode(mode string) (os.FileMode, error) {
	trimmed := strings.TrimSpace(mode)
	if trimmed == "" {
		return 0o644, nil
	}
	parsed, err := strconv.ParseUint(trimmed, 8, 32)
	if err != nil || parsed == 0 || parsed > 0o777 {
		return 0, fmt.Errorf("bad file mode %q", mode)
	}
	return os.FileMode(parsed), nil
}
