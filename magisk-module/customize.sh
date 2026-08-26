#!/system/bin/sh
# Runs once, while Magisk installs the module.

SKIPUNZIP=0
DATADIR=/data/adb/magnemite

ui_print "- Magnemite agent"
ui_print "- Detected ABI: $ARCH"

case "$ARCH" in
arm64)
	BIN=magnemite-agent-linux-arm64
	;;
arm)
	BIN=magnemite-agent-linux-arm
	;;
*)
	abort "! Unsupported ABI: $ARCH (this fleet is arm64)"
	;;
esac

if [ ! -f "$MODPATH/bin/$BIN" ]; then
	abort "! $BIN is missing from the module zip"
fi

mv "$MODPATH/bin/$BIN" "$MODPATH/magnemite-agent"
rm -rf "$MODPATH/bin"
set_perm "$MODPATH/magnemite-agent" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755

mkdir -p "$DATADIR"
set_perm "$DATADIR" 0 0 0700

# A config baked into the zip is how a batch of boxes gets flashed with the
# server URL and enrollment token already in place.
if [ -f "$MODPATH/config.json" ]; then
	if [ -f "$DATADIR/config.json" ]; then
		ui_print "- Keeping the existing config (this box is already enrolled)"
		rm -f "$MODPATH/config.json"
	else
		ui_print "- Installing bundled config"
		mv "$MODPATH/config.json" "$DATADIR/config.json"
		set_perm "$DATADIR/config.json" 0 0 0600
	fi
fi

if [ ! -f "$DATADIR/config.json" ]; then
	ui_print "!"
	ui_print "! No config found. Before rebooting, write $DATADIR/config.json:"
	ui_print '!   {"serverUrl":"https://your.host","enrollmentToken":"..."}'
	ui_print "!"
fi

ui_print "- Installed. The agent starts on the next boot."
