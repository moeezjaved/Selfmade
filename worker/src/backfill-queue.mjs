/**
 * One-time: seed creative_queue from the current pending set (ads with raw URLs but
 * no creative yet), in keyset-paginated chunks — never one big blocking INSERT…SELECT
 * (that's what hung the migration). Idempotent (ON CONFLICT DO NOTHING). Safe to re-run.
 */
const U = (process.env.SUPABASE_URL || '').split('\n')[0]
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K }
const PENDING = 'select=ad_id&thumbnail_url=is.null&video_url=is.null&creative_extraction_failed_at=is.null&or=(raw_image_urls.not.is.null,raw_video_urls.not.is.null)'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let cursor = '', total = 0
for (;;) {
  // PostgREST caps responses at db-max-rows (1000) regardless of limit, so page in
  // 1000s and only stop when a page comes back SHORT (the true end).
  const q = U + '/rest/v1/discovery_ads_index?' + PENDING + '&order=ad_id.asc&limit=1000' + (cursor ? '&ad_id=gt.' + encodeURIComponent(cursor) : '')
  let rows
  for (let t = 0; ; t++) {
    const r = await fetch(q, { headers: H })
    if (r.ok) { rows = await r.json(); break }
    if (t >= 5) { console.log('FETCH FAILED after retries:', r.status, (await r.text()).slice(0, 200)); process.exit(1) }
    await sleep(1500 * (t + 1))
  }
  if (!Array.isArray(rows) || !rows.length) break
  const body = JSON.stringify(rows.map(x => ({ ad_id: x.ad_id })))
  for (let t = 0; ; t++) {
    const ins = await fetch(U + '/rest/v1/creative_queue', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body })
    if (ins.ok) break
    if (t >= 5) { console.log('INSERT FAILED after retries:', ins.status, (await ins.text()).slice(0, 200)); process.exit(1) }
    await sleep(1500 * (t + 1))
  }
  total += rows.length
  cursor = rows[rows.length - 1].ad_id
  if (total % 20000 < 1000) console.log('backfilled', total)
  if (rows.length < 1000) break
  await sleep(120)   // gentle on the DB
}
console.log('DONE backfilled', total)
process.exit(0)
