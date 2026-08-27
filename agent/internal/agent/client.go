// Package agent owns the long-lived connection to the hub and runs one job
// at a time on the box.
package agent

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"magnemite/agent/internal/certfix"
	"magnemite/agent/internal/config"
	"magnemite/agent/internal/installer"
	"magnemite/agent/internal/proto"
	"magnemite/agent/internal/sys"
)

const (
	writeTimeout     = 15 * time.Second
	pongTimeout      = 90 * time.Second
	minBackoff       = 2 * time.Second
	maxBackoff       = 60 * time.Second
	defaultHeartbeat = 20 * time.Second
	// One full package inventory every 15 heartbeats — five minutes at the
	// default rate.
	inventoryEveryBeats = 15
)

type Agent struct {
	Cfg     *config.Config
	Sys     sys.System
	Version string
	// Path the config was loaded from, so a rotated token can be written back.
	ConfigPath string

	mu      sync.Mutex
	conn    *websocket.Conn
	tracked []string

	jobMu   sync.Mutex
	jobID   string
	jobStop context.CancelFunc
}

func New(cfg *config.Config, system sys.System, version, configPath string) *Agent {
	return &Agent{
		Cfg:        cfg,
		Sys:        system,
		Version:    version,
		ConfigPath: configPath,
		tracked:    []string{"com.nianticlabs.pokemongo"},
	}
}

// Run reconnects forever. The only way out is ctx being cancelled.
func (a *Agent) Run(ctx context.Context) error {
	backoff := minBackoff

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		err := a.session(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			log.Printf("connection lost: %v", err)
		}

		// Jitter matters at fleet scale: a whole fleet reconnecting in lockstep
		// after the VPS restarts is a self-inflicted denial of service.
		jitter := time.Duration(rand.Int63n(int64(backoff / 4)))
		wait := backoff - backoff/8 + jitter
		log.Printf("reconnecting in %s", wait.Round(time.Second))

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}

		backoff = time.Duration(float64(backoff) * 1.7)
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (a *Agent) session(ctx context.Context) error {
	wsURL, err := a.wsURL()
	if err != nil {
		return err
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 20 * time.Second,
		Proxy:            http.ProxyFromEnvironment,
		// The dialer builds its own TLS config, so it misses the roots
		// certfix put on http.DefaultTransport. A nil pool means "platform
		// roots", which is what we want everywhere but Android.
		TLSClientConfig: &tls.Config{RootCAs: certfix.Pool()},
	}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+a.Cfg.DeviceToken)
	headers.Set("User-Agent", "magnemite-agent/"+a.Version)

	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusUnauthorized {
			return fmt.Errorf("device token rejected — re-enroll this box")
		}
		return fmt.Errorf("dial %s: %w", wsURL, err)
	}
	log.Printf("connected to %s", wsURL)

	a.mu.Lock()
	a.conn = conn
	a.mu.Unlock()

	defer func() {
		a.mu.Lock()
		if a.conn == conn {
			a.conn = nil
		}
		a.mu.Unlock()
		conn.Close()
	}()

	conn.SetReadDeadline(time.Now().Add(pongTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongTimeout))
	})

	sessionCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	if err := a.sendHello(); err != nil {
		return err
	}
	go a.heartbeatLoop(sessionCtx)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		conn.SetReadDeadline(time.Now().Add(pongTimeout))
		a.handle(ctx, data)
	}
}

func (a *Agent) wsURL() (string, error) {
	base := strings.TrimSuffix(a.Cfg.ServerURL, "/")
	switch {
	case strings.HasPrefix(base, "https://"):
		return "wss://" + strings.TrimPrefix(base, "https://") + "/ws/device", nil
	case strings.HasPrefix(base, "http://"):
		return "ws://" + strings.TrimPrefix(base, "http://") + "/ws/device", nil
	case strings.HasPrefix(base, "ws://"), strings.HasPrefix(base, "wss://"):
		return base + "/ws/device", nil
	}
	return "", fmt.Errorf("serverUrl %q must start with http:// or https://", a.Cfg.ServerURL)
}

func (a *Agent) send(v any) error {
	a.mu.Lock()
	conn := a.conn
	a.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(v)
	if err != nil {
		return err
	}

	// gorilla/websocket allows exactly one concurrent writer, and the
	// heartbeat loop races the job reporter.
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.conn != conn {
		return fmt.Errorf("connection replaced")
	}
	conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return conn.WriteMessage(websocket.TextMessage, data)
}

func (a *Agent) sendHello() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return a.send(proto.Hello{
		Type:            "hello",
		ProtocolVersion: proto.Version,
		AgentVersion:    a.Version,
		Device:          a.Sys.DeviceInfo(ctx),
		// A reconnect is the cheapest moment to take a full inventory: the
		// hub has just lost sight of this box and one `pm list` is nothing
		// next to the reconnect itself.
		Metrics:      sys.Metrics(ctx, a.Sys, a.trackedPackages(), true),
		CurrentJobID: a.currentJob(),
	})
}

func (a *Agent) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(defaultHeartbeat)
	defer ticker.Stop()

	beats := 0

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			beats++
			// Apps are installed and removed by hand on these boxes, so the
			// inventory does go stale — but not by the second. Every
			// inventoryEveryBeats heartbeats keeps it current at a cost of one
			// `pm list packages` every few minutes.
			withInventory := beats%inventoryEveryBeats == 0

			mctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			metrics := sys.Metrics(mctx, a.Sys, a.trackedPackages(), withInventory)
			cancel()

			if err := a.send(proto.Heartbeat{
				Type:         "heartbeat",
				Metrics:      metrics,
				CurrentJobID: a.currentJob(),
			}); err != nil {
				return
			}

			a.mu.Lock()
			conn := a.conn
			if conn != nil {
				conn.SetWriteDeadline(time.Now().Add(writeTimeout))
				_ = conn.WriteMessage(websocket.PingMessage, nil)
			}
			a.mu.Unlock()
		}
	}
}

func (a *Agent) handle(ctx context.Context, data []byte) {
	var env proto.Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		log.Printf("dropped malformed frame: %v", err)
		return
	}

	switch env.Type {
	case "welcome":
		var msg proto.Welcome
		if json.Unmarshal(data, &msg) != nil {
			return
		}
		if len(msg.TrackedPackages) > 0 {
			a.mu.Lock()
			a.tracked = msg.TrackedPackages
			a.mu.Unlock()
		}
		if a.Cfg.DeviceID != msg.DeviceID {
			a.Cfg.DeviceID = msg.DeviceID
			_ = a.Cfg.Save(a.ConfigPath)
		}
		log.Printf("registered as %q (approved=%v)", msg.Name, msg.Approved)
		if !msg.Approved {
			log.Printf("waiting for an operator to approve this device in the dashboard")
		}

	case "install_job":
		var job proto.InstallJob
		if json.Unmarshal(data, &job) != nil {
			return
		}
		a.startJob(ctx, job)

	case "cancel_job":
		var msg proto.CancelJob
		if json.Unmarshal(data, &msg) != nil {
			return
		}
		a.cancelJob(msg.JobID)

	case "reboot":
		log.Printf("reboot requested by hub")
		go func() {
			rctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			// Give the frame a moment to reach the hub before the box drops.
			time.Sleep(2 * time.Second)
			_, _ = a.Sys.Exec(rctx, "reboot")
		}()

	case "agent_update":
		var msg proto.AgentUpdate
		if json.Unmarshal(data, &msg) != nil {
			return
		}
		go a.selfUpdate(msg)

	case "ping":
		// The frame-level pong is enough; nothing to do.
	}
}

// --- jobs ------------------------------------------------------------------

func (a *Agent) currentJob() string {
	a.jobMu.Lock()
	defer a.jobMu.Unlock()
	return a.jobID
}

func (a *Agent) startJob(ctx context.Context, job proto.InstallJob) {
	a.jobMu.Lock()
	if a.jobID != "" {
		running := a.jobID
		a.jobMu.Unlock()
		// One install at a time. The hub re-queues anything it does not get a
		// result for, so refusing here is safe.
		log.Printf("ignoring job %s: %s is still running", job.JobID, running)
		_ = a.send(proto.JobResult{
			Type:  "job_result",
			JobID: job.JobID,
			OK:    false,
			Error: "agent is already running job " + running,
		})
		return
	}

	timeout := time.Duration(job.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = time.Hour
	}
	jobCtx, cancel := context.WithTimeout(ctx, timeout)
	a.jobID = job.JobID
	a.jobStop = cancel
	a.jobMu.Unlock()

	// Let the fake box know what version a commit should report.
	if fake, ok := a.Sys.(*sys.Fake); ok {
		fake.SetPendingVersion(job.Version)
	}

	go func() {
		defer func() {
			cancel()
			a.jobMu.Lock()
			a.jobID = ""
			a.jobStop = nil
			a.jobMu.Unlock()
		}()

		log.Printf("job %s: installing %s %s", job.JobID, job.PackageName, job.Version)
		rep := &reporter{agent: a, jobID: job.JobID}

		inst := &installer.Installer{
			Sys:     a.Sys,
			WorkDir: a.Cfg.WorkDir,
			Token:   a.Cfg.DeviceToken,
			Client:  &http.Client{Timeout: 0},
		}
		res := inst.Run(jobCtx, job, rep)

		result := proto.JobResult{
			Type:                 "job_result",
			JobID:                job.JobID,
			OK:                   res.OK,
			InstallMode:          res.InstallMode,
			DataWiped:            res.DataWiped,
			InstalledVersion:     res.InstalledVersion,
			InstalledVersionCode: res.InstalledVersionCode,
		}
		if res.Err != nil {
			result.Error = res.Err.Error()
			log.Printf("job %s failed: %v", job.JobID, res.Err)
		} else {
			log.Printf("job %s succeeded: %s", job.JobID, res.InstalledVersion)
		}

		// If the socket is down the hub will time the job out and re-queue it;
		// the download is already on disk, so the retry is cheap.
		if err := a.send(result); err != nil {
			log.Printf("could not report result for %s: %v", job.JobID, err)
		}
	}()
}

func (a *Agent) cancelJob(jobID string) {
	a.jobMu.Lock()
	defer a.jobMu.Unlock()
	if a.jobID == jobID && a.jobStop != nil {
		log.Printf("cancelling job %s", jobID)
		a.jobStop()
	}
}

func (a *Agent) trackedPackages() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]string, len(a.tracked))
	copy(out, a.tracked)
	return out
}

// reporter forwards installer progress to the hub.
type reporter struct {
	agent *Agent
	jobID string
}

func (r *reporter) Progress(state string, percent int, message string) {
	_ = r.agent.send(proto.JobProgress{
		Type:     "job_progress",
		JobID:    r.jobID,
		State:    state,
		Progress: percent,
		Message:  message,
	})
}

func (r *reporter) Log(level, message string) {
	log.Printf("job %s: %s", r.jobID, message)
	_ = r.agent.send(proto.LogMessage{
		Type:    "log",
		JobID:   r.jobID,
		Level:   level,
		Message: message,
	})
}
