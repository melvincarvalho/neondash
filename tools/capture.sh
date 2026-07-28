#!/usr/bin/env bash
# Deterministic shot capture. The falling_0..falling_4 sequence exists for the
# physics critic: one boulder drops, lands on another, and rolls off — the core
# Boulder Dash rule, one tick per frame.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$DIR/shots}"
mkdir -p "$OUT"
CHROME="${CHROME:-chromium}"
SHOTS=(title cave1 dig collect push firefly vault vaultfarm maze crush crushkill bloom explosion exitopen timelow clear death deathbanner)
cap() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1280,720 \
    --virtual-time-budget=10000 \
    --screenshot="$OUT/$1.png" \
    "file://$DIR/index.html?$2" 2>/dev/null
  echo "captured $1"
}
for s in "${SHOTS[@]}"; do cap "$s" "shot=$s"; done
for f in 0 1 2 3 4 5 6 7 8; do cap "falling_$f" "shot=falling&f=$f"; done
for f in 0 1 2 3; do cap "magicwall_$f" "shot=magicwall&f=$f"; done
