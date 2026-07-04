#!/usr/bin/env bash
# Drain the E (OpenAI AI-classification) backlog FAST via sync-parallel mode, as a PERSISTENT
# background container that survives Ctrl-C AND disconnect (unlike `docker exec`, which dies with
# your shell). Stops the slow 24h-batch loop first so they don't compete.
#
#   bash e-sync.sh          # concurrency 80
#   bash e-sync.sh 100      # concurrency 100 (faster; watch for 429s in the log)
#
# Watch:   docker logs -f classify-sync
# Status:  bash ~/Selfmade/worker/status.sh
# Stop + revert to the cheap nightly batch when the backlog is clear:
#          docker stop classify-sync && docker rm classify-sync && docker start classify
set -euo pipefail

CONC="${1:-80}"
WAVE="${2:-12000}"
BASE="${CLASSIFY_CONTAINER:-classify}"
SRC_DIR="$(cd "$(dirname "$0")/src" && pwd)"

# Keep the container's bind-mounted src current (the classify container mounts /opt/worker/src — a
# SEPARATE checkout from this repo, so a `git pull` here won't update what runs).
if [ -d /opt/worker/src ]; then
  cp "$SRC_DIR/classify-batch.ts" "$SRC_DIR/classify-providers.ts" /opt/worker/src/ 2>/dev/null \
    && echo "✓ synced E code → /opt/worker/src" || echo "… could not sync /opt/worker/src (perms)"
fi

IMAGE="$(docker inspect "$BASE" -f '{{.Config.Image}}')"

# Stop the slow batch loop so it doesn't double-classify, and clear any prior sync container.
docker stop "$BASE" >/dev/null 2>&1 && echo "⏸  stopped batch-mode '$BASE'" || echo "… '$BASE' not running (ok)"
docker rm -f classify-sync >/dev/null 2>&1 || true

echo "⚡ starting classify-sync — provider=openai concurrency=$CONC wave=$WAVE  (background; survives disconnect)"
docker run -d --name classify-sync \
  --env-file <(docker inspect "$BASE" -f '{{range .Config.Env}}{{println .}}{{end}}') \
  -e CLASSIFY_PROVIDER=openai -e CLASSIFY_CONCURRENCY="$CONC" \
  -v /opt/worker/src:/app/src \
  "$IMAGE" \
  npx tsx src/classify-batch.ts --sync --wave="$WAVE" >/dev/null

sleep 2
echo "✓ classify-sync is running in the background."
echo "  watch:   docker logs -f classify-sync"
echo "  status:  bash ~/Selfmade/worker/status.sh"
echo "  when pct_done hits ~100%, revert to cheap nightly batch:"
echo "           docker stop classify-sync && docker rm classify-sync && docker start $BASE"
