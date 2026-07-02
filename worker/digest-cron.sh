#!/bin/bash
# digest-cron.sh — weekly "what's new from brands you follow" email. Reuses the alert-worker's env
# (which carries SUPABASE_* + RESEND_API_KEY + EMAIL_FROM + APP_URL once email is wired), so there are
# no secrets in cron or in a persisted file — captured at runtime, deleted after.
#
# Install (droplet), Mondays 14:00 UTC:
#   ( crontab -l 2>/dev/null | grep -v digest-cron; echo "0 14 * * 1 /root/Selfmade/worker/digest-cron.sh >> /var/log/digest.log 2>&1" ) | crontab -
set -euo pipefail
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') digest: start"
docker inspect alert-worker --format '{{range .Config.Env}}{{println .}}{{end}}' > /tmp/digest.env 2>/dev/null || { echo "alert-worker not found"; exit 0; }
docker run --rm --env-file /tmp/digest.env -v /opt/worker/src:/app/src selfmade-worker npx tsx src/digest-worker.mjs 2>&1 || true
rm -f /tmp/digest.env
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') digest: done"
