#!/bin/bash
# analyze-stats.sh — keep discovery_ads_index planner stats fresh so the admin dashboard's
# 'estimated' counts (TOTAL / WITH CREATIVE / drain) stay accurate. reltuples drifts high after
# brand-culling deletes (it read 3.06M when the exact count was 2.59M); a daily ANALYZE corrects it
# without the exact-count timeouts that forced the switch to 'estimated'.
#
# Install (droplet), daily at 05:17 UTC:
#   ( crontab -l 2>/dev/null; echo "17 5 * * * /root/Selfmade/worker/analyze-stats.sh >> /var/log/analyze.log 2>&1" ) | crontab -
set -euo pipefail
USEAST=$(cat /root/.useast)
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') analyze: start"
docker run --rm postgres:17 psql "$USEAST" -c "analyze discovery_ads_index; analyze discovery_creatives;" 2>&1 || true
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') analyze: done"
