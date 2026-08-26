//go:build linux || darwin

package agent

import "syscall"

// execSelf replaces the current process image, keeping the same PID so the
// Magisk service loop does not see the agent as having exited.
func execSelf(path string, argv []string, env []string) error {
	return syscall.Exec(path, argv, env)
}
