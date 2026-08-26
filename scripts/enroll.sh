#!/usr/bin/env bash
#
# Bulk-provisions Android TV boxes over adb on the local network.
#
# This is the one time each box needs hands-on work. After it reboots, the
# agent connects to the hub on its own and every later update goes over that
# socket — no adb, no LAN access, no port forwarding.
#
#   ./scripts/enroll.sh dist/magnemite-agent-0.1.0.zip 192.168.1.10 192.168.1.11
#   ./scripts/enroll.sh dist/magnemite-agent-0.1.0.zip -f hosts.txt
#
# If the zip has no config.json baked in (see `make module SERVER=... TOKEN=...`),
# set these and the script writes the config itself:
#   MAGNEMITE_SERVER=https://magnemite.example.com \
#   MAGNEMITE_TOKEN=<enrollment token> ./scripts/enroll.sh <zip> <ip...>
#
# Boxes must have adb over network enabled and be rooted with Magisk.
set -uo pipefail

MODULE_ZIP="${1:-}"
shift || true

if [ -z "$MODULE_ZIP" ] || [ ! -f "$MODULE_ZIP" ]; then
	echo "usage: $0 <module.zip> <ip|host>... | -f <hosts-file>" >&2
	exit 1
fi

HOSTS=()
if [ "${1:-}" = "-f" ]; then
	[ -f "${2:-}" ] || {
		echo "hosts file not found: ${2:-}" >&2
		exit 1
	}
	while IFS= read -r line; do
		line="${line%%#*}"
		line="$(echo "$line" | tr -d '[:space:]')"
		[ -n "$line" ] && HOSTS+=("$line")
	done <"$2"
else
	HOSTS=("$@")
fi

[ ${#HOSTS[@]} -gt 0 ] || {
	echo "no hosts given" >&2
	exit 1
}

command -v adb >/dev/null || {
	echo "adb is not on PATH" >&2
	exit 1
}

ZIP_NAME="$(basename "$MODULE_ZIP")"
REMOTE_ZIP="/data/local/tmp/$ZIP_NAME"
SERVER="${MAGNEMITE_SERVER:-}"
TOKEN="${MAGNEMITE_TOKEN:-}"

ok=0
failed=()

for host in "${HOSTS[@]}"; do
	target="$host"
	case "$host" in
	*:*) : ;;
	*) target="$host:5555" ;;
	esac

	echo "=== $target"

	if ! adb connect "$target" | grep -qE "connected to"; then
		echo "  ! could not connect (is adb over network on?)"
		failed+=("$host")
		continue
	fi

	# Everything below needs root; fail loudly rather than half-installing.
	if ! adb -s "$target" shell 'su -c "id -u"' 2>/dev/null | tr -d '\r' | grep -q '^0$'; then
		echo "  ! no root via su — is Magisk installed and adb granted?"
		failed+=("$host")
		adb disconnect "$target" >/dev/null 2>&1
		continue
	fi

	echo "  pushing $ZIP_NAME"
	if ! adb -s "$target" push "$MODULE_ZIP" "$REMOTE_ZIP" >/dev/null; then
		echo "  ! push failed"
		failed+=("$host")
		adb disconnect "$target" >/dev/null 2>&1
		continue
	fi

	if [ -n "$SERVER" ] && [ -n "$TOKEN" ]; then
		echo "  writing config.json"
		adb -s "$target" shell "su -c 'mkdir -p /data/adb/magnemite && cat > /data/adb/magnemite/config.json <<EOF
{
  \"serverUrl\": \"$SERVER\",
  \"enrollmentToken\": \"$TOKEN\"
}
EOF
chmod 600 /data/adb/magnemite/config.json'" >/dev/null
	fi

	echo "  installing module"
	install_out="$(adb -s "$target" shell "su -c 'magisk --install-module $REMOTE_ZIP'" 2>&1 | tr -d '\r')"
	if ! echo "$install_out" | grep -qi "done\|success\|Installing"; then
		echo "  ! module install may have failed:"
		echo "$install_out" | sed 's/^/    /'
		failed+=("$host")
		adb disconnect "$target" >/dev/null 2>&1
		continue
	fi

	adb -s "$target" shell "su -c 'rm -f $REMOTE_ZIP'" >/dev/null 2>&1
	echo "  rebooting"
	adb -s "$target" reboot >/dev/null 2>&1
	adb disconnect "$target" >/dev/null 2>&1
	ok=$((ok + 1))
done

echo
echo "provisioned: $ok / ${#HOSTS[@]}"
if [ ${#failed[@]} -gt 0 ]; then
	echo "failed: ${failed[*]}"
	exit 1
fi
echo "The boxes will appear in the dashboard a minute or so after they finish booting."
