package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"magnemite/agent/internal/proto"
)

// selfUpdate replaces the running binary and re-executes it.
//
// The swap is a rename, which is atomic on the same filesystem: a box losing
// power mid-update comes back running either the old agent or the new one,
// never a half-written file. That matters because a bricked agent on a box in
// someone's living room is a physical trip to fix.
func (a *Agent) selfUpdate(msg proto.AgentUpdate) {
	if msg.Version == a.Version {
		log.Printf("self-update: already on %s", msg.Version)
		return
	}
	// Never swap the binary out from under a running install.
	if a.currentJob() != "" {
		log.Printf("self-update to %s deferred: a job is running", msg.Version)
		return
	}

	exe, err := os.Executable()
	if err != nil {
		log.Printf("self-update: cannot find own path: %v", err)
		return
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		log.Printf("self-update: %v", err)
		return
	}

	log.Printf("self-update: downloading %s", msg.Version)
	tmp := exe + ".new"
	if err := a.downloadBinary(msg, tmp); err != nil {
		log.Printf("self-update failed: %v", err)
		os.Remove(tmp)
		return
	}

	if err := os.Chmod(tmp, 0o755); err != nil {
		log.Printf("self-update: chmod failed: %v", err)
		os.Remove(tmp)
		return
	}

	// Keep the old binary next to the new one: if the replacement cannot
	// start, service.sh can put this back.
	backup := exe + ".old"
	os.Remove(backup)
	if err := os.Rename(exe, backup); err != nil {
		log.Printf("self-update: cannot move current binary: %v", err)
		os.Remove(tmp)
		return
	}
	if err := os.Rename(tmp, exe); err != nil {
		log.Printf("self-update: cannot install new binary: %v", err)
		os.Rename(backup, exe)
		return
	}

	log.Printf("self-update: restarting into %s", msg.Version)
	if err := execSelf(exe, os.Args, os.Environ()); err != nil {
		// Exec only returns on failure. Fall back to spawning a child and
		// exiting, which the Magisk service loop also handles.
		log.Printf("self-update: exec failed (%v), respawning", err)
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if serr := cmd.Start(); serr != nil {
			log.Printf("self-update: respawn failed: %v", serr)
			return
		}
		os.Exit(0)
	}
}

func (a *Agent) downloadBinary(msg proto.AgentUpdate, dest string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, msg.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.Cfg.DeviceToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(out, h), resp.Body); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	out.Close()

	sum := hex.EncodeToString(h.Sum(nil))
	if sum != msg.SHA256 {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", msg.SHA256, sum)
	}
	return nil
}
