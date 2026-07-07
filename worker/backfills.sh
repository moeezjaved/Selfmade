#!/usr/bin/env bash
# Launch any maintenance backfill from the CURRENT `selfmade-worker` image.
# Env (secrets / proxy / R2 / Supabase) is derived at runtime from the running
# `worker` container, so this stays correct even after image rebuilds and does
# NOT depend on the old (now-removed) stopped backfill containers.
#
#   ./backfills.sh poster   # mp4 → poster frame (reads R2, no IPRoyal)
#   ./backfills.sh thumb    # image thumbnails (reads R2, no IPRoyal)
#   ./backfills.sh embed    # vector embeddings backfill
#   ./backfills.sh queue    # (re)fill creative_queue from unprocessed ads
#   ./backfills.sh dims     # width/height dimensions backfill
#   ./backfills.sh hcfill   # has_creative SQL fill (re-runs the hcfill2 one-shot)
#   ./backfills.sh status   # what's running + backlog snapshot
#
# NOTE: poster/thumb/embed/dims add DB load — while the media DRAIN is the
# priority (commit-batched worker), prefer to run these AFTER the drain winds
# down, or at reduced concurrency, so they don't slow it.
set -euo pipefail
JOB="${1:-}"
IMG=selfmade-worker
ENVF=/opt/worker/.backfill.env

derive_env() {
  docker inspect worker --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENVF"
  chmod 600 "$ENVF"
}
launch() {  # name  [extra -e flags...]  -- cmd...
  local name="$1"; shift
  local extra=(); while [ "$1" != "--" ]; do extra+=("$1"); shift; done; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --restart no --network bridge \
    --env-file "$ENVF" "${extra[@]}" "$IMG" "$@"
  echo "▶ started $name  —  follow: docker logs -f $name"
}

case "$JOB" in
  poster) derive_env; launch mp4-poster    -e MP4POSTER_CONCURRENCY=10 -e MP4POSTER_BATCH=240 -- npx tsx src/mp4-poster.ts ;;
  thumb)  derive_env; launch image-thumb   -e THUMB_CONCURRENCY=12 -e THUMB_BATCH=400 -- npx tsx src/image-thumb-backfill.ts ;;
  embed)  derive_env; launch embed-backfill -- node src/embed-backfill.mjs ;;
  queue)  derive_env; launch queue-backfill -- node src/backfill-queue.mjs ;;
  dims)   derive_env; launch backfill-dims -e BF_BATCH=500 -e BF_CONCURRENCY=20 -- node src/backfill-dimensions.mjs ;;
  hcfill) echo "re-running has_creative SQL fill (hcfill2 one-shot)…"; docker start -a hcfill2 ;;
  status)
    echo "=== running maintenance/backfill containers ==="
    docker ps --format '{{.Names}} | {{.Status}}' | grep -iE 'poster|thumb|embed|queue|dims|worker|classify' || echo '(none running)'
    ;;
  *) echo "usage: backfills.sh {poster|thumb|embed|queue|dims|hcfill|status}"; exit 1 ;;
esac
rm -f "$ENVF" 2>/dev/null || true
