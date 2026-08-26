#!/usr/bin/env bash
#
# Runs N simulated Android TV boxes against the hub.
#
# Each fake agent enrolls, connects, heartbeats and runs the real install
# pipeline — real download, real .apkm extraction — with only pm/dumpsys/getprop
# stubbed. It is the honest way to check the scheduler, the concurrency cap and
# the dashboard at fleet scale before touching 200 real boxes.
#
#   ./scripts/fake-fleet.sh 200 <enrollment-token> [server-url]
#
# Failure injection (see agent/internal/sys/fake.go):
#   MAGNEMITE_FAKE_COMMIT_ERROR=INSTALL_FAILED_UPDATE_INCOMPATIBLE \
#   MAGNEMITE_FAKE_COMMIT_ERROR_ONCE=1 ./scripts/fake-fleet.sh 20 <token>
set -euo pipefail

COUNT="${1:-10}"
TOKEN="${2:-}"
SERVER="${3:-http://localhost:3001}"

cd "$(dirname "$0")/.."

BINARY="agent/bin/magnemite-agent-linux-amd64"
if [ ! -x "$BINARY" ]; then
	echo "Agent binary missing at $BINARY — run: make agent" >&2
	exit 1
fi
if [ -z "$TOKEN" ]; then
	echo "usage: $0 <count> <enrollment-token> [server-url]" >&2
	exit 1
fi

STATE_DIR=".dev/fleet"
mkdir -p "$STATE_DIR"
: >"$STATE_DIR/pids.txt"

echo "Starting $COUNT fake devices against $SERVER"

for i in $(seq 1 "$COUNT"); do
	serial=$(printf "fake-%03d" "$i")
	config="$STATE_DIR/$serial.json"

	args=(-fake-root -fake-serial "$serial" -config "$config" -server "$SERVER")
	# The token is only needed until a device has one of its own.
	[ -f "$config" ] || args+=(-enroll-token "$TOKEN")

	"$BINARY" "${args[@]}" >"$STATE_DIR/$serial.log" 2>&1 &
	echo $! >>"$STATE_DIR/pids.txt"

	# Small stagger so the enrollment burst is realistic rather than a spike.
	sleep 0.05
done

echo
echo "$COUNT agents running. Logs: $STATE_DIR/*.log"
echo "Stop them with: xargs kill <$STATE_DIR/pids.txt"
