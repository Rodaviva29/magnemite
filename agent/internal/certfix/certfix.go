// Package certfix works around Go's empty trust store on Android.
//
// Same root cause as netfix. A CGO-free binary built for GOOS=linux verifies
// certificates with the pure-Go verifier, which loads its roots from
// /etc/ssl/certs and a handful of other distro paths. Android has none of
// them: its CAs live in /system/etc/security/cacerts, and on Android 14+ in
// an APEX copy. So every handshake fails with
//
//	x509: certificate signed by unknown authority
//
// even against an ordinary publicly-trusted certificate. The fix is to build
// the root pool from Android's own directories.
package certfix

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"os"
	"path/filepath"
)

// Where Android keeps its CAs, newest layout first.
var certDirs = []string{
	"/apex/com.android.conscrypt/cacerts", // Android 14+
	"/system/etc/security/cacerts",        // every release
	"/data/misc/user/0/cacerts-added",     // CAs the operator installed
}

var pool *x509.CertPool

// Install builds a root pool from Android's CA directories and makes it the
// default for the process. It returns how many certificates were loaded; 0
// means the platform roots already work and nothing was changed.
func Install() int {
	if systemRootsWork() {
		return 0
	}

	p := x509.NewCertPool()
	n := 0
	for _, dir := range certDirs {
		n += appendDir(p, dir)
	}
	if n == 0 {
		return 0
	}

	pool = p
	// Everything in the agent dials through http.DefaultClient or a client
	// with a nil Transport, so this one assignment covers enrollment, artifact
	// downloads and self-update.
	if tr, ok := http.DefaultTransport.(*http.Transport); ok {
		if tr.TLSClientConfig == nil {
			tr.TLSClientConfig = &tls.Config{}
		}
		tr.TLSClientConfig.RootCAs = p
	}
	return n
}

// Pool returns the roots Install loaded, or nil when the platform roots are
// fine. Callers that build their own tls.Config — the WebSocket dialer — need
// it; a nil pool there means "use the platform roots", which is correct.
func Pool() *x509.CertPool { return pool }

func systemRootsWork() bool {
	// Go reads these before anything else, so an operator who sets them has
	// already solved the problem by hand.
	if os.Getenv("SSL_CERT_FILE") != "" || os.Getenv("SSL_CERT_DIR") != "" {
		return true
	}

	for _, f := range []string{
		"/etc/ssl/certs/ca-certificates.crt",
		"/etc/pki/tls/certs/ca-bundle.crt",
		"/etc/ssl/ca-bundle.pem",
		"/etc/pki/tls/cacert.pem",
		"/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
		"/etc/ssl/cert.pem",
	} {
		if st, err := os.Stat(f); err == nil && st.Size() > 0 {
			return true
		}
	}
	for _, d := range []string{"/etc/ssl/certs", "/etc/pki/tls/certs"} {
		if entries, err := os.ReadDir(d); err == nil && len(entries) > 0 {
			return true
		}
	}
	return false
}

// appendDir adds every certificate found in dir and returns how many parsed.
// Android's files are named by subject hash (3d4b0a4f.0) and carry a
// human-readable dump after the PEM block, which pem.Decode simply ignores.
func appendDir(p *x509.CertPool, dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}

	n := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		for len(data) > 0 {
			var block *pem.Block
			block, data = pem.Decode(data)
			if block == nil {
				break
			}
			if block.Type != "CERTIFICATE" {
				continue
			}
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				continue
			}
			p.AddCert(cert)
			n++
		}
	}
	return n
}
