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
REVIEW_FLOW="$(pwd)/maestro/screen_tour_review.yaml"
BUNDLE_ID="com.darrendixon.dailymicrohabits"
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
echo "| Device | Result | Screenshots |" > "$SUMMARY"  # result covers screen_tour.yaml and screen_tour_review.yaml
echo "|---|---|---|" >> "$SUMMARY"

for PREFS in "iPhone Air|iPhone 17|iPhone 16" "iPhone 16e|iPhone SE (3rd generation)|iPhone 17"; do
  IFS='|' read -r -a CANDIDATES <<< "$PREFS"
  PICK=$(pick_device_type "${CANDIDATES[@]}") || { echo "No device type from: $PREFS"; STATUS=1; continue; }
  NAME="${PICK%%|*}"; TYPE="${PICK##*|}"
  SLUG=$(echo "$NAME" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '_' | sed 's/_*$//')
  echo "=== $NAME ($TYPE) ==="
  UDID=$(xcrun simctl create "dmh-$SLUG" "$TYPE" "$RUNTIME")
  # With a hardware keyboard "connected", the software keyboard stays hidden and typed text can
  # land in whichever field still holds focus (2026-11-27 runs). Use the software keyboard only.
  defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false || true
  xcrun simctl spawn "$UDID" defaults write com.apple.HardwareKeyboard HardwareKeyboardLastSeen -bool false 2>/dev/null || true
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

  # Second launch: make the tour's review cards due now (see applyUiTourHooks), then review them.
  # The flag goes in as a launch argument (screen_tour_review.yaml) and, in case the driver does
  # not forward it to NSUserDefaults, also into the app's preferences file.
  REVIEW_RESULT=1
  if [ $RESULT -eq 0 ]; then
    xcrun simctl terminate "$UDID" "$BUNDLE_ID" || true
    DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data 2>/dev/null || true)
    if [ -n "$DATA" ]; then
      mkdir -p "$DATA/Library/Preferences"
      PLIST="$DATA/Library/Preferences/$BUNDLE_ID.plist"
      [ -f "$PLIST" ] || plutil -create xml1 "$PLIST"
      plutil -replace dmhUiTourMakeCardsDue -string 1 "$PLIST" || true
    fi
    ( cd "$DEVICE_DIR" && maestro --device "$UDID" test "$REVIEW_FLOW" --format junit --output "$DEVICE_DIR/maestro_review_report.xml" ) \
      > "$DEVICE_DIR/maestro_review_output.txt" 2>&1
    REVIEW_RESULT=$?
    tail -30 "$DEVICE_DIR/maestro_review_output.txt"
  fi
  # Maestro's own failure screenshot and logs.
  for LATEST in $(ls -td "$HOME"/.maestro/tests/*/ 2>/dev/null | head -2); do
    find "$LATEST" -name '*.png' -exec cp {} "$DEVICE_DIR/" \;
    mkdir -p "$DEVICE_DIR/maestro_logs"
    # Keep command logs; skip the device log (100+ MB, over GitHub's file limit).
    find "$LATEST" \( -name '*.json' -o -name '*.log' -o -name '*.txt' \) -size -5M -exec cp {} "$DEVICE_DIR/maestro_logs/" \;
  done
  COUNT=$(ls "$DEVICE_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
  if [ $RESULT -eq 0 ] && [ $REVIEW_RESULT -eq 0 ]; then
    echo "| $NAME | pass | $COUNT |" >> "$SUMMARY"
  else
    echo "| $NAME | FAIL (tour $RESULT, review $REVIEW_RESULT) | $COUNT |" >> "$SUMMARY"; STATUS=1
  fi
  xcrun simctl shutdown "$UDID" || true
  xcrun simctl delete "$UDID" || true
done

cat "$SUMMARY"
exit $STATUS
