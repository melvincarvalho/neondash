#!/usr/bin/env bash
# Two-sided solvability harness:
#   careful bot (hazard-aware) must CLEAR every cave  → the game is completable
#   greedy bot (no hazard model) should FAIL late caves → greed is priced in
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
BUDGET="${1:-240}"
for mode in careful greedy; do
  for cave in 0 1 2 3 4; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
      --virtual-time-budget=40000 \
      --dump-dom \
      "file://$DIR/index.html?autoplay=$cave&budget=$BUDGET&mode=$mode" 2>/dev/null \
      | grep -o 'AUTOPLAY:{[^<]*' | head -1
  done
done
