package agent

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"magnemite/agent/internal/logs"
	"magnemite/agent/internal/proto"
)

// Log collection, driven by the hub.
//
// A bundle is collected, uploaded over HTTP and forgotten. A stream runs
// logcat for as long as the hub keeps asking, and at most one runs at a time:
// two dashboards watching the same box share the hub's stream, so the box
// never runs a second logcat to print the same lines twice.

// How long the whole collect-and-upload is given before it is abandoned.
const bundleTimeout = 5 * time.Minute

func (a *Agent) collectLogs(msg proto.CollectLogs) {
	ctx, cancel := context.WithTimeout(context.Background(), bundleTimeout)
	defer cancel()

	workDir := a.Cfg.WorkDir
	if workDir == "" {
		workDir = os.TempDir()
	}
	path := filepath.Join(workDir, "magnemite-logs-"+msg.BundleID+".zip")
	// The zip is a courier, not an artifact: the hub keeps it, the box does not.
	defer os.Remove(path)

	maxLines := msg.MaxLines
	if maxLines <= 0 {
		maxLines = 50_000
	}

	if err := logs.Bundle(ctx, a.Sys, a.Version, path, maxLines); err != nil {
		a.reportBundleFailure(msg.BundleID, "could not collect the logs: "+err.Error())
		return
	}

	if err := logs.Upload(ctx, msg.UploadURL, a.Cfg.DeviceToken, path); err != nil {
		a.reportBundleFailure(msg.BundleID, "could not upload the bundle: "+err.Error())
		return
	}

	// No success frame: the upload landing is the hub's proof.
	log.Printf("logs: bundle %s uploaded", msg.BundleID)
}

func (a *Agent) reportBundleFailure(bundleID, reason string) {
	log.Printf("logs: %s", reason)
	_ = a.send(proto.LogBundleResult{
		Type:     "log_bundle_result",
		BundleID: bundleID,
		OK:       false,
		Error:    reason,
	})
}

func (a *Agent) startLogStream(msg proto.LogStreamStart) {
	a.logMu.Lock()
	defer a.logMu.Unlock()

	// The hub re-sends the same stream id to extend a watch that is still
	// open. Restarting the follow for that would lose whatever it was mid-line
	// on, and re-print the tail the panel already has.
	if a.logStreamID == msg.StreamID && a.logStop != nil {
		return
	}
	a.stopLogStreamLocked()

	seconds := msg.DurationSeconds
	if seconds <= 0 {
		seconds = 300
	}

	// The deadline is the agent's own: a browser that vanished without saying
	// so must not leave logcat running on someone's TV box.
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(seconds)*time.Second)
	a.logStreamID = msg.StreamID
	a.logStop = cancel

	streamID := msg.StreamID
	path := msg.Path
	go func() {
		defer cancel()
		send := func(lines []string, dropped int) {
			_ = a.send(proto.LogLines{
				Type:     "log_lines",
				StreamID: streamID,
				Lines:    lines,
				Dropped:  dropped,
			})
		}

		err := logs.Stream(ctx, a.Sys, path, send)
		if err != nil && ctx.Err() == nil {
			log.Printf("logs: stream %s ended: %v", streamID, err)
			// A log that cannot be opened is the common case here — a path
			// typed wrong, or an app that has not written one yet. Saying so
			// as a line beats a panel that waits forever for a file that will
			// never arrive.
			send([]string{fmt.Sprintf("— cannot follow %s: %v", source(path), err)}, 0)
		}

		a.logMu.Lock()
		if a.logStreamID == streamID {
			a.logStreamID = ""
			a.logStop = nil
		}
		a.logMu.Unlock()
	}()
}

func source(path string) string {
	if path == "" {
		return "logcat"
	}
	return path
}

func (a *Agent) stopLogStream(streamID string) {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	// A stop for a stream that already ended is normal, not an error.
	if streamID != "" && a.logStreamID != streamID {
		return
	}
	a.stopLogStreamLocked()
}

// stopLogStreamLocked requires logMu.
func (a *Agent) stopLogStreamLocked() {
	if a.logStop != nil {
		a.logStop()
		a.logStop = nil
	}
	a.logStreamID = ""
}
