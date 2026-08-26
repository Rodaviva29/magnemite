//go:build linux || darwin

package sys

import "syscall"

// Disk reports free/total bytes on the filesystem holding path. /data is what
// the install session writes to, and small TV boxes run out of it long before
// anything else goes wrong.
func (a *Android) Disk(path string) (uint64, uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bsize := uint64(st.Bsize)
	// Bavail, not Bfree: the reserved blocks are not ours to use.
	return st.Bavail * bsize, st.Blocks * bsize, nil
}
