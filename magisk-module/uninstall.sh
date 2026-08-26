#!/system/bin/sh
# Magisk runs this when the module is removed.
#
# The config is deliberately left behind: removing the module to reflash it
# should not force a re-enrollment. Delete /data/adb/magnemite by hand to
# fully retire a box.
rm -rf /data/local/tmp/magnemite
