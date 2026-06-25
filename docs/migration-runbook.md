# DB Region Migration Runbook — Tokyo (ap-northeast-1) → us-east-1

Method: **pg_dump / pg_restore** (pre-launch → downtime is free). Goal: move the **primary** west so
compute (NYC droplet + Vercel iad1) and the DB are co-located. Ends the trans-Pacific latency that
maxes the DB and bottlenecks ingestion to 5M.

**Golden rules**
- Migrate **first** → then run backfills (200ms→15ms) → then resume crawl. Don't grind slow Tokyo backfills while prepping.
- **Inventory every writer** before cutover. One missed writer = data written to a dead Tokyo DB.
- **Smoke-test fully BEFORE resuming writers** — rollback is only clean until writers resume on us-east.

Connection strings (keep off-screen — never paste into chat):
- `TOKYO` = session pooler of the current project (`postgres.mylbmxqijhucgyaupxqr@aws-1-ap-northeast-1.pooler.supabase.com:5432`)
- `USEAST` = session pooler of the NEW project (created in step 1)
All `psql`/`pg_dump`/`pg_restore` below run via `docker run --rm -v /root/migration:/backup postgres:16 …` on the droplet.

---

## 0 — Pre-flight (no downtime)
```bash
mkdir -p /root/migration
docker pull postgres:16
```
- Confirm Vercel functions region = **iad1** (us-east-1).
- Decide the maintenance window (low traffic; pre-launch so anytime).

## 1 — THE 30-SECOND TIMEOUT TEST (do this FIRST)
Gabriel's unblock is the role-level timeout. Prove it works through the pooler before committing:
```bash
# raise it on Tokyo
docker run --rm postgres:16 psql "$TOKYO" -c "alter role postgres set statement_timeout = 0;"
# fresh connection → try a schema-only dump (forces the planner across all tables, ~30s)
docker run --rm -v /root/migration:/backup postgres:16 pg_dump "$TOKYO" --schema=public --schema-only -f /backup/_test_schema.sql
```
- **Completes without "canceling statement due to statement timeout"** → pooler respects it. Proceed.
- **Still times out** → the pooler overrides it. **Fallback:** run `pg_dump` from your **Mac over the Direct connection** (`db.<ref>.supabase.co:5432`, IPv6 — your home ISP almost certainly has IPv6) where the role setting applies cleanly. Install client: `brew install libpq` then use its `pg_dump`. Everything else in this runbook is identical, just from the Mac.

## 2 — Create the new project + enable extensions BEFORE restore
1. Dashboard → **New project** → org `moeezjaved's Org` → region **East US (us-east-1)** → **size the disk above Tokyo's current 72%** (e.g. 2× headroom for 5M). Get its session-pooler string → `USEAST`.
2. Extensions must exist *before* restore or dependent objects (the GIN trgm index, etc.) fail:
```bash
docker run --rm postgres:16 psql "$USEAST" -c "
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
create extension if not exists \"uuid-ossp\";
-- if you use pgvector anywhere, also: create extension if not exists vector;"
```

## 3 — Freeze writers, then dump Tokyo
**Stop EVERY writer first** (see the inventory in step 7 — do it now):
```bash
# on the droplet:
docker stop scheduler worker image-thumb mp4-poster classify vision vision-spy feed-snapshot 2>/dev/null
```
Also pause the **Vercel rollup cron** (vercel.json crons / dashboard) and put the app in a brief maintenance state so no user/API writes land in Tokyo during the window.

Now dump — **split, because of the auth gotcha**:
```bash
# A) PUBLIC schema = your app (tables, indexes, triggers, functions, sequences, generated-col DEFS).
#    Custom format (-Fc) so we can parallel-restore.
docker run --rm -v /root/migration:/backup postgres:16 \
  pg_dump "$TOKYO" -Fc --no-owner --no-privileges --schema=public -f /backup/public.dump

# B) AUTH USERS as DATA-ONLY (do NOT dump the auth schema structure — see gotcha #1).
docker run --rm -v /root/migration:/backup postgres:16 \
  pg_dump "$TOKYO" -Fc --no-owner --no-privileges --data-only \
  --table=auth.users --table=auth.identities -f /backup/auth_data.dump
```
> Generated columns (`search_vector`, `copy_sig`, `is_classifiable`) are **excluded from data by pg_dump on purpose** — Postgres recomputes them on insert during restore. That's correct; don't try to force them.

## 4 — Restore into us-east (parallel; expect a couple hours, not minutes)
`discovery_ads_index` has ~23 indexes + `discovery_creatives` ~2.1M rows — **index rebuild is the slow part.** Use `-j` parallel restore:
```bash
# Public schema + data, parallel
docker run --rm -v /root/migration:/backup postgres:16 \
  pg_restore -d "$USEAST" -j 4 --no-owner --no-privileges /backup/public.dump
```
If the index build inside the restore is brutal, split it: `--section=pre-data` then `--section=data` then `--section=post-data` (indexes last). For most cases `-j 4` is enough.

Then load auth users into the new project's **existing** auth tables (data-only):
```bash
docker run --rm -v /root/migration:/backup postgres:16 \
  pg_restore -d "$USEAST" --data-only --no-owner --no-privileges /backup/auth_data.dump
```

## 5 — Post-restore fixes
**a) The `on_auth_user_created` trigger lives on `auth.users`** — it's NOT in the public dump. Re-apply it (and its function) from your migration `018_credits_and_create.sql` (the handle_new_user / create-profile-on-signup trigger). Without it, new signups won't get a `user_profiles` row.

**b) Reset sequences** (BIGSERIAL columns) to `max(id)` so new inserts don't collide:
```bash
docker run --rm postgres:16 psql "$USEAST" -c "
do \$\$ declare r record; begin
  for r in select schemaname, sequencename from pg_sequences where schemaname='public' loop
    execute format('select setval(%L, coalesce((select max(\"id\") from public.%I),1))',
      r.schemaname||'.'||r.sequencename, replace(r.sequencename,'_id_seq',''));
  end loop;
end \$\$;"
```
(If a sequence name doesn't map cleanly to its table, reset those manually — verify in step 7.)

## 6 — Re-add Auth config / Meta OAuth (does NOT migrate)
- New project → **Authentication → Providers → enable the Meta/Facebook provider**, paste its **client ID + secret** (from your Meta app — same values, re-entered).
- Set **Site URL + redirect URLs** to your app's domains.
- Optional: Gabriel's **Management-API config-copy** bash script can copy Auth/Realtime config between projects with an access token (cleaner if you have many providers).
- Re-check any **Realtime** settings if you use them.

## 7 — VERIFY (beyond row counts) — gate before cutover
```bash
docker run --rm -e PGOPTIONS='-c statement_timeout=0' postgres:16 psql "$USEAST" -c "
-- extensions
select extname from pg_extension where extname in ('pg_trgm','pgcrypto','uuid-ossp');
-- triggers (must include trg_enqueue_creative; on_auth_user_created re-applied in 5a)
select tgname, relname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not tgisinternal order by 1;
-- generated columns populated
select count(*) ngc from discovery_ads_index where search_vector is not null;
select count(*) ncs from discovery_ads_index where copy_sig is not null;
-- RLS policies (expect 5)
select count(*) npol from pg_policies;
-- GIN/search indexes valid
select indexrelid::regclass idx, indisvalid from pg_index where indexrelid::regclass::text like 'discovery_ads_%_gin' or indexrelid::regclass::text like '%search_vector%';
-- row counts on the big tables (compare to Tokyo)
select (select count(*) from discovery_ads_index) ads,
       (select count(*) from discovery_creatives) creatives,
       (select count(*) from auth.users) users;"
```
**Pass criteria:** 3 extensions present · `trg_enqueue_creative` + the `updated_at` triggers present · `on_auth_user_created` present (after 5a) · generated columns non-null · 5 policies · indexes `indisvalid=t`.

### 7b — PROVE no data was lost (exact per-table count, Tokyo vs us-east)
Writers are frozen, so counts are stable. Run this on **BOTH** `$TOKYO` and `$USEAST`; the outputs must be **identical**:
```bash
docker run --rm -e PGOPTIONS='-c statement_timeout=0' postgres:16 psql "$TOKYO" -At -F',' -c "
select table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint cnt
from information_schema.tables
where table_schema='public' and table_type='BASE TABLE' order by table_name;" > /root/migration/counts_tokyo.csv

docker run --rm -e PGOPTIONS='-c statement_timeout=0' postgres:16 psql "$USEAST" -At -F',' -c "
select table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint cnt
from information_schema.tables
where table_schema='public' and table_type='BASE TABLE' order by table_name;" > /root/migration/counts_useast.csv

diff /root/migration/counts_tokyo.csv /root/migration/counts_useast.csv && echo "✅ EVERY public table matches — zero rows lost" || echo "❌ MISMATCH — do NOT cut over; investigate the diff"
# auth users too:
docker run --rm postgres:16 psql "$TOKYO"  -At -c "select 'auth.users', count(*) from auth.users"
docker run --rm postgres:16 psql "$USEAST" -At -c "select 'auth.users', count(*) from auth.users"
```
**Hard gate:** the `diff` must print `✅` (zero output) and `auth.users` must match. If any table differs, **STOP** — Tokyo is untouched, so re-dump/re-restore that table; do not proceed to cutover.

## 8 — Cutover (the writer inventory — miss one and you lose data)
Update `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ new anon key + new DB password) in **EVERY** place that touches the DB:

| Where | What |
|---|---|
| **Vercel** env | `SUPABASE_URL`, service key, anon key, (`SUPABASE_READ_URL` if set) → **redeploy** |
| **Droplet `/opt/worker/.env`** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, any DB URL |
| **Classifier** (uses same `.env`) | covered by the droplet `.env` |
| **2nd droplet** (if you ever add one) | its own `/opt/worker/.env` |
| **Crons** | Vercel `api/cron/rollup`, `feed-snapshot`, any `rollup-cron.sh` |

Then:
1. Redeploy Vercel.
2. **Smoke test on us-east (BEFORE resuming writers):** feed loads · **search "sauce" is fast** (indexes valid) · save an ad · check credits · **log in** (JWT secret changed → you'll be logged out once; confirm login *works*).
3. Only when all green → **resume writers** pointed at us-east:
```bash
docker start scheduler worker image-thumb mp4-poster classify vision vision-spy feed-snapshot
```

## 9 — Post-cutover sequencing (the speed payoff)
1. **Backfills first** — re-run thumb + poster + drain on us-east; they now run at ~15ms/write (the 200/min → thousands/min jump). Re-run any rows that were mid-flight during the freeze (idempotent).
2. **Rebuild the 3 search GIN indexes** if the verify showed any missing/invalid — trivial now from NYC→us-east.
3. **Resume crawl** last, toward 5M, with fast writes.

## 10 — Rollback
- Keep the **Tokyo project for ~3 days** as insurance.
- **Before writers resume:** rollback = revert the env vars to Tokyo, done (no data written to us-east yet).
- **After writers resume on us-east:** rollback means data divergence — so **do not resume writers until smoke tests pass.** That's the point of no return.
- After ~3 clean days, delete the Tokyo project to stop its billing (the new project already costs ~$65/mo).
