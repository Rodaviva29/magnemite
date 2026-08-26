//go:build !linux && !darwin

package agent

import "errors"

// execSelf has no equivalent outside unix; the caller falls back to spawning
// a child process. Only reachable on a dev machine.
func execSelf(path string, argv []string, env []string) error {
	return errors.New("exec is not supported on this platform")
}
