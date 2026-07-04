#!/usr/bin/env bash
# Switch E to the CHEAP steady-state setup:
#   • bulk backlog  → cheap 24h Batch API (the 'classify' container, 50% off) — trickles in background
#   • spied brands  → FAST sync mode, PRIORITY (the 'spy-classify' worker) — a user who spies a brand
#     gets it classified in minutes, not a 24h batch. One brand's ads = trivial full-price cost.
#
#   bash ~/Selfmade/worker/e-cheap.sh
#
# To go back to bulk-sync (premium, ~6h for the whole backlog):  bash ~/Selfmade/worker/e-sync.sh 100
set -euo pipefail
SRC_DIR="$(cd "$(dirname "$0")/src" && pwd)"

# keep the container's bind-mounted src current (/opt/worker/src is a separate checkout)
if [ -d /opt/worker/src ]; then
  cp "$SRC_DIR/classify-batch.ts" "$SRC_DIR/classify-providers.ts" "$SRC_DIR/spy-classify-worker.mjs" /opt/worker/src/ 2>/dev/null \
    && echo "✓ synced E code → /opt/worker/src" || echo "… could not sync /opt/worker/src (perms)"
fi

# stop the premium bulk sync (if running)
if docker ps --format '{{.Names}}' | grep -qx classify-sync; then
  docker stop classify-sync >/dev/null 2>&1 && docker rm classify-sync >/dev/null 2>&1 && echo "⏹  stopped premium classify-sync (bulk sync)"
else
  echo "… classify-sync not running (ok)"
fi

# start the cheap bulk batch loop
docker start classify >/dev/null 2>&1 && echo "▶  bulk 'classify' running — cheap 24h batch, background" || echo "… could not start 'classify'"

# restart spy so it picks up sync-mode (priority path for user-spied brands)
docker restart spy-classify >/dev/null 2>&1 && echo "▶  'spy-classify' restarted — FAST sync for spied brands (priority)" || echo "… could not restart 'spy-classify'"

echo
echo "done ✓  bulk = cheap batch (background) · spy = fast sync (priority)"
echo "status: bash ~/Selfmade/worker/status.sh"
