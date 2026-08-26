// Package netfix works around Go's DNS on Android.
//
// A CGO-free Go binary uses the pure-Go resolver, which reads
// /etc/resolv.conf. Android has no such file, so every lookup fails with
// "no such host" while the box itself resolves names fine. The fix is to
// resolve through the servers Android publishes in its system properties.
package netfix

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"
)

var fallbackServers = []string{"1.1.1.1:53", "8.8.8.8:53"}

// Install replaces the default resolver. Safe to call on any platform: if
// /etc/resolv.conf exists and works, nothing changes.
func Install() []string {
	if hasResolvConf() {
		return nil
	}

	servers := androidDNS()
	servers = append(servers, fallbackServers...)

	dialer := &net.Dialer{Timeout: 5 * time.Second}
	var index int

	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			// Try each server in turn; a box on a captive LAN often has one
			// working resolver and one that black-holes.
			var lastErr error
			for i := 0; i < len(servers); i++ {
				addr := servers[(index+i)%len(servers)]
				conn, err := dialer.DialContext(ctx, network, addr)
				if err == nil {
					index = (index + i) % len(servers)
					return conn, nil
				}
				lastErr = err
			}
			return nil, fmt.Errorf("no usable dns server: %w", lastErr)
		},
	}
	return servers
}

func hasResolvConf() bool {
	// This file, and only this file, is what the pure-Go resolver reads.
	st, err := os.Stat("/etc/resolv.conf")
	return err == nil && st.Size() > 0
}

func androidDNS() []string {
	var servers []string
	for _, prop := range []string{"net.dns1", "net.dns2", "net.dns3", "net.dns4"} {
		out, err := exec.Command("getprop", prop).Output()
		if err != nil {
			continue
		}
		addr := strings.TrimSpace(string(out))
		if addr == "" {
			continue
		}
		if strings.Contains(addr, ":") && !strings.Contains(addr, "]") {
			// Bare IPv6 needs brackets before a port can be appended.
			addr = "[" + addr + "]"
		}
		servers = append(servers, addr+":53")
	}
	return servers
}
