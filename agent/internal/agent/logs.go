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
// A bundle is collected, uploaded over HTTP and forgotten. A stream follows one
// source for as long as the hub keeps asking. Two dashboards watching the same
// source share the hub's stream, so the box never follows the same log twice;
// two watching different sources get one follow each, because a box that ran
// only one would answer the second by silently abandoning the first, and the
// hub — which believes it has both — would have no way to notice.

// How long the whole collect-and-upload is given before it is abandoned.
const bundleTimeout = 5 * time.Minute

// How many sources the box will follow at once. The hub asks for one per
// source anyone is watching, which in practice is one or two; the cap is only
// there so a mistake upstream cannot turn into a box running tails forever.
const maxLogStreams = 4

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

	// The hub re-sends the same stream id to extend a watch that is still
	// open, and again whenever a panel joins one — it cannot see what the box
	// is actually following, so it says so rather than assuming. Restarting a
	// follow that is already running would lose whatever it was mid-line on,
	// and re-print the tail the panel already has.
	if _, running := a.logStreams[msg.StreamID]; running {
		a.logMu.Unlock()
		return
	}

	// A box in someone's living room does not run an unbounded number of
	// follows because something upstream lost count.
	if len(a.logStreams) >= maxLogStreams {
		a.logMu.Unlock()
		log.Printf("logs: refusing stream %s: %d already running", msg.StreamID, maxLogStreams)
		_ = a.send(proto.LogLines{
			Type:     "log_lines",
			StreamID: msg.StreamID,
			Lines:    []string{fmt.Sprintf("— this box is already following %d logs", maxLogStreams)},
		})
		return
	}

	seconds := msg.DurationSeconds
	if seconds <= 0 {
		seconds = 300
	}

	// The deadline is the agent's own: a browser that vanished without saying
	// so must not leave logcat running on someone's TV box.
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(seconds)*time.Second)
	follow := &logFollow{cancel: cancel}
	if a.logStreams == nil {
		a.logStreams = make(map[string]*logFollow)
	}
	a.logStreams[msg.StreamID] = follow
	a.logMu.Unlock()

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

		// Only its own entry: a reconnect re-arms the same stream id, and the
		// follow that is winding down must not remove the one that replaced it.
		a.logMu.Lock()
		if a.logStreams[streamID] == follow {
			delete(a.logStreams, streamID)
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

// stopLogStream stops one follow, or every one of them when streamID is empty
// — which is what a lost socket means: nobody is reading any of this now.
func (a *Agent) stopLogStream(streamID string) {
	a.logMu.Lock()
	defer a.logMu.Unlock()

	if streamID == "" {
		for id, follow := range a.logStreams {
			follow.cancel()
			delete(a.logStreams, id)
		}
		return
	}

	// A stop for a stream that already ended is normal, not an error.
	follow, running := a.logStreams[streamID]
	if !running {
		return
	}
	follow.cancel()
	delete(a.logStreams, streamID)
}
