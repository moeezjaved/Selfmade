#!/bin/bash
# crawl-watchdog.sh — auto-heal the scheduler when it wedges.
#
# WHY: the scheduler occasionally hangs on a single brand (mtalk/chromium pileup) and stops making
# progress entirely — the in-flight crawler_runs row stays status='running' forever. We've hit this
# twice (awsales, raffaella scapini), each losing ~9h of crawl before a manual `docker restart`.
# A healthy scheduler finishes a run every few seconds (16 concurrent, ~50s each), so ANY run left
# 'running' for >15 min = wedged. This checks every 5 min and restarts the scheduler if so.
#
# Install (droplet):
#   chmod +x /root/Selfmade/worker/crawl-watchdog.sh
#   ( crontab -l 2>/dev/null; echo "*/5 * * * * /root/Selfmade/worker/crawl-watchdog.sh >> /var/log/crawl-watchdog.log 2>&1" ) | crontab -
set -euo pipefail

USEAST=$(cat /root/.useast)
THRESH_MIN=${WATCHDOG_THRESH_MIN:-15}
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Count crawls still "running" that started more than THRESH_MIN ago = the wedge signal.
stuck=$(docker run --rm postgres:17 psql "$USEAST" -At -c \
  "select count(*) from crawler_runs where finished_at is null and status='running' and started_at < now() - interval '${THRESH_MIN} minutes';" \
  2>/dev/null | tr -d '[:space:]')

if [ -z "$stuck" ]; then
  echo "$NOW watchdog: DB check failed (skip)"
  exit 0
fi

if [ "$stuck" -gt 0 ]; then
  echo "$NOW watchdog: $stuck run(s) stuck >${THRESH_MIN}min → aborting orphans + restarting scheduler"
  # Close the orphaned rows first so they don't re-trigger a restart on the next tick.
  docker run --rm postgres:17 psql "$USEAST" -c \
    "update crawler_runs set finished_at=now(), status='aborted', abort_reason='watchdog_stall' where finished_at is null and status='running' and started_at < now() - interval '${THRESH_MIN} minutes';" \
    >/dev/null 2>&1 || true
  docker restart scheduler >/dev/null 2>&1 && echo "$NOW watchdog: scheduler restarted" || echo "$NOW watchdog: restart FAILED"
else
  echo "$NOW watchdog: ok"
fi
