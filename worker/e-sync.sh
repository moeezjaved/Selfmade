#!/usr/bin/env bash
# Drain the E (OpenAI AI-classification) backlog FAST using sync-parallel mode.
#
#   bash e-sync.sh            # concurrency 40, wave 12000 — drains until no unclassified copy left
#   bash e-sync.sh 80         # push concurrency to 80 (more speed; watch for 429s in the log)
#   bash e-sync.sh 40 20000   # concurrency 40, bigger DB waves
#
# Runs INSIDE the `classify` container (it has node + all env). Sync mode = real-time /chat/completions
# instead of the 24h Batch API, so a wave finishes in minutes. It's full-price (no 50% batch discount) —
# use it to catch up a backlog, then go back to the cheap nightly batch cron (`docker start classify`).
set -euo pipefail

CONC="${1:-40}"
WAVE="${2:-12000}"
CONTAINER="${CLASSIFY_CONTAINER:-classify}"
SRC_DIR="$(cd "$(dirname "$0")/src" && pwd)"

# The classify container bind-mounts /opt/worker/src, which is a SEPARATE checkout from this repo —
# a plain `git pull` here won't update what the container runs. Copy the two E files across so the
# container always runs the latest sync code. (No-op if the mount isn't present.)
if [ -d /opt/worker/src ]; then
  cp "$SRC_DIR/classify-batch.ts" "$SRC_DIR/classify-providers.ts" /opt/worker/src/ 2>/dev/null \
    && echo "✓ synced E code → /opt/worker/src" || echo "… could not sync /opt/worker/src (check perms)"
fi

echo "⚡ E sync drain — provider=openai concurrency=$CONC wave=$WAVE container=$CONTAINER"
echo "   (Ctrl-C is safe to detach; re-run to resume — the gate is self-healing.)"
exec docker exec -e CLASSIFY_PROVIDER=openai -e CLASSIFY_CONCURRENCY="$CONC" \
  "$CONTAINER" npx tsx src/classify-batch.ts --sync --wave="$WAVE"
