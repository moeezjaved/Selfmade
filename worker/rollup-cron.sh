#!/bin/sh
# Nightly rollup on the droplet (no Vercel 300s limit). flock prevents overlap.
# Sets crawl_paused (heartbeat) so the write runs with near-zero contention.
/usr/bin/flock -n /tmp/rollup-cron.lock \
  /usr/bin/docker exec worker node /app/src/nightly-rollup.mjs \
  >> /var/log/rollup-cron.log 2>&1
echo "[rollup tick $(date -u +%H:%M) exit $?]" >> /var/log/rollup-cron.log
