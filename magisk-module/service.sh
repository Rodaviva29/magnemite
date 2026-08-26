#!/system/bin/sh
# Started by Magisk at late_start, as root. Everything below already has the
# privileges pm install-create needs, so the agent never shells out to su.

MODDIR=${0%/*}
DATADIR=/data/adb/magnemite
LOG="$DATADIR/agent.log"
MAX_LOG_BYTES=2097152

mkdir -p "$DATADIR"

# Wait for the box to actually finish booting. Starting before this point
# means getprop returns half-populated values and the network is not up.
until [ "$(getprop sys.boot_completed)" = "1" ]; do
	sleep 2
done
sleep 15

# Respawn loop: the agent exits on a self-update (it re-execs) and on fatal
# config errors. A box in someone's living room has to come back on its own.
while true; do
	# Keep the log from filling a small /data partition.
	if [ -f "$LOG" ]; then
		size=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
		if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
			mv "$LOG" "$LOG.1"
		fi
	fi

	echo "[magnemite] starting agent at $(date)" >>"$LOG"
	"$MODDIR/magnemite-agent" -config "$DATADIR/config.json" >>"$LOG" 2>&1

	# If a self-update left a broken binary behind, fall back to the previous
	# one rather than looping on a crash forever.
	if [ ! -x "$MODDIR/magnemite-agent" ] && [ -x "$MODDIR/magnemite-agent.old" ]; then
		echo "[magnemite] restoring previous agent binary" >>"$LOG"
		mv "$MODDIR/magnemite-agent.old" "$MODDIR/magnemite-agent"
	fi

	sleep 10
done
