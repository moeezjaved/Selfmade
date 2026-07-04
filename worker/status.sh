#!/usr/bin/env bash
# Pipeline status in one shot: thumbnails, drain, E classification.
# Reads the DB connection from ~/.useast. Run it with:  bash ~/Selfmade/worker/status.sh
# (Avoids pasting multi-line SQL — the DO web console mangles quotes/newlines.)
set -euo pipefail

USEAST="$(cat ~/.useast)"

docker run --rm -i postgres:17 psql "$USEAST" <<'SQL'
\echo '── Thumbnails (discovery_creatives.poster_url) ──'
select
  count(*) filter (where poster_url is not null)                                              as have_thumb,
  count(*) filter (where asset_type='image' and poster_url is null and r2_url is not null)    as images_left,
  count(*) filter (where poster_url is not null and width is not null)                        as have_size
from discovery_creatives;

\echo '── Drain (creatives) ──'
select
  count(*) filter (where not has_creative)                                                    as still_missing,
  count(*) filter (where not has_creative and creative_extraction_failed_at is not null)      as confirmed_dead
from discovery_ads_index;

\echo '── E classification (OpenAI) ──'
select
  count(*) filter (where is_classifiable)                                                                 as classifiable,
  count(*) filter (where is_classifiable and (ai_classified is distinct from true or topics is null))     as backlog_not_done,
  round(100.0 * count(*) filter (where is_classifiable and ai_classified is true and topics is not null)
        / nullif(count(*) filter (where is_classifiable), 0), 1)                                          as pct_done
from discovery_ads_index;
SQL
