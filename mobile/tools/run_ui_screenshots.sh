#!/usr/bin/env bash
# Runs maestro/screen_tour.yaml on each simulator model and collects the screenshots into
# ui-screenshots/<device-slug>/. Usage: tools/run_ui_screenshots.sh <path-to-.app>
# Exit status is non-zero if any device's flow failed; screenshots are kept either way.
set -uo pipefail

# CI Macs can take minutes to start the XCTest driver on a freshly booted simulator.
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000

APP_PATH="$1"
OUT_ROOT="$(pwd)/ui-screenshots"
FLOW="$(pwd)/maestro/screen_tour.yaml"
rm -rf "$OUT_ROOT" && mkdir -p "$OUT_ROOT"

RUNTIME=$(xcrun simctl list runtimes -j | python3 -c "
import json,sys
rs=[r for r in json.load(sys.stdin)['runtimes'] if r['isAvailable'] and r['platform']=='iOS']
print(sorted(rs,key=lambda r:[int(x) for x in r['version'].split('.')])[-1]['identifier'])")
echo "Runtime: $RUNTIME"

pick_device_type() {
  # First available device type from the preference list.
  local available; available=$(xcrun simctl list devicetypes -j)
  for name in "$@"; do
    local id; id=$(echo "$available" | python3 -c "
import json,sys
for t in json.load(sys.stdin)['devicetypes']:
    if t['name']==sys.argv[1]: print(t['identifier'])" "$name")
    if [ -n "$id" ]; then echo "$name|$id"; return 0; fi
  done
  return 1
}

STATUS=0
SUMMARY="$OUT_ROOT/SUMMARY.md"
echo "| Device | Result | Screenshots |" > "$SUMMARY"
echo "|---|---|---|" >> "$SUMMARY"

for PREFS in "iPhone Air|iPhone 17|iPhone 16" "iPhone 16e|iPhone SE (3rd generation)|iPhone 17"; do
  IFS='|' read -r -a CANDIDATES <<< "$PREFS"
  PICK=$(pick_device_type "${CANDIDATES[@]}") || { echo "No device type from: $PREFS"; STATUS=1; continue; }
  NAME="${PICK%%|*}"; TYPE="${PICK##*|}"
  SLUG=$(echo "$NAME" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '_' | sed 's/_*$//')
  echo "=== $NAME ($TYPE) ==="
  UDID=$(xcrun simctl create "dmh-$SLUG" "$TYPE" "$RUNTIME")
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b
  xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 || true
  xcrun simctl install "$UDID" "$APP_PATH"

  DEVICE_DIR="$OUT_ROOT/$SLUG"
  mkdir -p "$DEVICE_DIR"
  for ATTEMPT in 1 2; do
    ( cd "$DEVICE_DIR" && maestro --device "$UDID" test "$FLOW" --format junit --output "$DEVICE_DIR/maestro_report.xml" ) \
      > "$DEVICE_DIR/maestro_output.txt" 2>&1
    RESULT=$?
    # Retry once only when the driver failed to start (infrastructure), not when the flow failed.
    if [ $RESULT -ne 0 ] && grep -q 'IOSDriverTimeoutException' "$DEVICE_DIR/maestro_output.txt" && [ $ATTEMPT -eq 1 ]; then
      echo "Driver start timed out on $NAME; retrying once"
      continue
    fi
    break
  done
  tail -40 "$DEVICE_DIR/maestro_output.txt"
  # Maestro's own failure screenshot and logs.
  LATEST=$(ls -td "$HOME"/.maestro/tests/*/ 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    find "$LATEST" -name '*.png' -exec cp {} "$DEVICE_DIR/" \;
    mkdir -p "$DEVICE_DIR/maestro_logs"
    find "$LATEST" \( -name '*.json' -o -name '*.log' -o -name '*.txt' \) -exec cp {} "$DEVICE_DIR/maestro_logs/" \;
  fi
  COUNT=$(ls "$DEVICE_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
  if [ $RESULT -eq 0 ]; then echo "| $NAME | pass | $COUNT |" >> "$SUMMARY"; else echo "| $NAME | FAIL | $COUNT |" >> "$SUMMARY"; STATUS=1; fi
  xcrun simctl shutdown "$UDID" || true
  xcrun simctl delete "$UDID" || true
done

cat "$SUMMARY"
exit $STATUS
