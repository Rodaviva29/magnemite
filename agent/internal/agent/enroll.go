package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"magnemite/agent/internal/config"
	"magnemite/agent/internal/proto"
	"magnemite/agent/internal/sys"
)

// Enroll trades the shared enrollment token for a token belonging to this box
// and writes it into the config. Called once, on first boot after flashing.
func Enroll(ctx context.Context, cfg *config.Config, system sys.System, version, configPath string) error {
	if cfg.EnrollmentToken == "" {
		return fmt.Errorf("no deviceToken and no enrollmentToken in %s — nothing to enroll with", configPath)
	}

	body, err := json.Marshal(proto.EnrollRequest{
		EnrollmentToken: cfg.EnrollmentToken,
		Name:            cfg.Name,
		AgentVersion:    version,
		Device:          system.DeviceInfo(ctx),
	})
	if err != nil {
		return err
	}

	url := strings.TrimSuffix(cfg.ServerURL, "/") + "/api/enroll"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("enroll: %w", err)
	}
	defer resp.Body.Close()

	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("enroll: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}

	var out proto.EnrollResponse
	if err := json.Unmarshal(payload, &out); err != nil {
		return fmt.Errorf("enroll: bad response: %w", err)
	}
	if out.DeviceToken == "" {
		return fmt.Errorf("enroll: server returned no device token")
	}

	cfg.DeviceToken = out.DeviceToken
	cfg.DeviceID = out.DeviceID
	cfg.Name = out.Name
	// The enrollment token has served its purpose. Dropping it means a stolen
	// box cannot be used to enroll more devices.
	cfg.EnrollmentToken = ""

	return cfg.Save(configPath)
}
