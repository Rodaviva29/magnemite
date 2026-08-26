//go:build !linux && !darwin

package sys

// Disk is a stub for platforms the agent never actually ships to. It exists
// so the package still builds on a Windows dev machine.
func (a *Android) Disk(path string) (uint64, uint64, error) {
	return 0, 0, nil
}
