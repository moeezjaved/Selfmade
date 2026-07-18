/**
 * autopilot-worker — Daily Ad Autopilot.
 *
 * Once a day per enrolled brand/ad (ad_autopilot rows), generate ONE fresh ad and email it. We
 * alternate between a new variation of the ad the user made and a fresh clone of a new competitor
 * winner in the same niche. Generation + billing reuse the LIVE clone-image endpoint server-to-server
 * (x-autopilot-secret + asUserId), so the ad is charged exactly like a manual clone — i.e. per email.
 * Out of credits → skip the day (no charge, no email). Uncapped until the user turns it off.
 *
 * Run (droplet):
 *   docker run -d --name autopilot-worker --restart unless-stopped --init \
 *     --env-file <env> -v /opt/worker/src:/app/src selfmade-worker npx tsx src/autopilot-worker.mjs
 * Needs in env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL, AUTOPILOT_SECRET, RESEND_API_KEY.
 */
import { sendEmail, getUserEmail, autopilotDailyEmail, emailEnabled } from './email.mjs'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP = (process.env.APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const SECRET = process.env.AUTOPILOT_SECRET
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const EVERY = Math.max(600000, parseInt(process.env.AUTOPILOT_EVERY_MS || '3600000', 10)) // hourly
const DUE_MS = 20 * 3600 * 1000   // a row is "due" if it hasn't run in ~20h (→ roughly daily)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const enc = encodeURIComponent
const nowIso = () => new Date().toISOString()

if (!U || !K) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
if (!SECRET) { console.error('missing AUTOPILOT_SECRET'); process.exit(1) }

async function getJSON(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}
async function patch(path, body) {
  const r = await fetch(`${U}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) })
  if (!r.ok) console.warn(`PATCH ${path} → ${r.status} ${(await r.text()).slice(0, 120)}`)
}

// Pick a fresh competitor winner to clone — same niche as the enrollment's source ad when possible,
// never one we've already used for this enrollment, never the source ad itself.
async function pickFreshAd(sourceAdId, usedIds) {
  let niche = null
  if (sourceAdId) {
    try { niche = (await getJSON(`discovery_ads_index?select=niche&ad_id=eq.${enc(sourceAdId)}`))?.[0]?.niche || null } catch { /* best-effort */ }
  }
  const exclude = [...new Set([sourceAdId, ...(usedIds || [])].filter(Boolean))]
  const notIn = exclude.length ? `&ad_id=not.in.(${exclude.map(enc).join(',')})` : ''
  const nicheF = niche ? `&niche=eq.${enc(niche)}` : ''
  const base = 'discovery_ads_index?select=ad_id&performance_tier=eq.winning&has_creative=is.true&is_active=is.true'
  for (const q of [`${base}${nicheF}${notIn}&order=days_running.desc&limit=25`, `${base}${notIn}&order=days_running.desc&limit=25`]) {
    try { const rows = await getJSON(q); if (Array.isArray(rows) && rows.length) return rows[0].ad_id } catch { /* try next */ }
    if (!nicheF) break
  }
  return null
}

async function processOne(e) {
  const settings = e.settings || {}
  const kind = e.last_kind === 'fresh' ? 'variation' : 'fresh'   // alternate; first run (null) → 'fresh'... start 'variation'
  const useKind = e.last_kind == null ? 'variation' : kind

  let adId = null
  if (useKind === 'variation' && e.source_ad_id) adId = e.source_ad_id
  if (!adId) adId = await pickFreshAd(e.source_ad_id, e.used_ad_ids)   // fresh, or variation with no source
  const actualKind = (useKind === 'variation' && adId === e.source_ad_id) ? 'variation' : 'fresh'
  if (!adId) { await patch(`ad_autopilot?id=eq.${enc(e.id)}`, { last_run_at: nowIso() }); console.warn(`autopilot ${e.id}: no ad to clone`); return }

  // Brand product photos (physical); service brands may have screenshots or none.
  let productImages = []
  try {
    const prods = await getJSON(`brand_products?select=image_urls&brand_id=eq.${enc(e.brand_id)}`)
    productImages = (prods || []).flatMap((p) => p.image_urls || []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 4)
  } catch { /* none */ }

  const gen = await fetch(`${APP}/api/discovery/clone-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-autopilot-secret': SECRET },
    body: JSON.stringify({
      asUserId: e.user_id, adId, brandId: e.brand_id, productImages,
      productType: settings.product_type || 'physical',
      aspectRatio: settings.aspect || 'original', imageSize: settings.image_size || '2K', look: settings.look || 'match',
    }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) })).catch((err) => ({ status: 0, j: { error: String(err?.message || err) } }))

  if (gen.status === 402 || gen.j?.error === 'insufficient_credits') {
    await patch(`ad_autopilot?id=eq.${enc(e.id)}`, { last_run_at: nowIso() })
    console.log(`autopilot ${e.id}: skipped (no credits)`)
    return
  }
  const jobId = gen.j?.jobId
  if (!jobId) { await patch(`ad_autopilot?id=eq.${enc(e.id)}`, { last_run_at: nowIso() }); console.warn(`autopilot ${e.id}: enqueue failed ${JSON.stringify(gen.j).slice(0, 120)}`); return }

  // Poll the generation row (clone-image runs it in the background + commits/refunds credits itself).
  let imageUrl = null, status = 'processing'
  for (let i = 0; i < 60; i++) {   // up to ~3 min
    await sleep(3000)
    try {
      const row = (await getJSON(`creative_generations?select=status,image_url&id=eq.${enc(jobId)}`))?.[0]
      if (row) { status = row.status; if (row.status === 'done') { imageUrl = row.image_url; break } if (row.status === 'failed') break }
    } catch { /* keep polling */ }
  }

  if (status !== 'done' || !imageUrl) {
    // clone-image already refunded on failure — just advance so we retry tomorrow.
    await patch(`ad_autopilot?id=eq.${enc(e.id)}`, { last_run_at: nowIso() })
    console.warn(`autopilot ${e.id}: generation ${status} (no charge kept)`)
    return
  }

  // Deliver. The charge already happened during generation — this email is the delivery, per your rule
  // "charge credit on every email" (one generated + charged ad = one email).
  let brandName = null
  try { brandName = (await getJSON(`brands?select=name&id=eq.${enc(e.brand_id)}`))?.[0]?.name || null } catch { /* ok */ }
  const to = emailEnabled ? await getUserEmail(e.user_id) : null
  if (to) {
    const { subject, html } = autopilotDailyEmail({ brandName, imageUrl, kind: actualKind })
    await sendEmail({ to, subject, html })
  }

  const used = actualKind === 'fresh' ? [...new Set([...(e.used_ad_ids || []), adId])] : (e.used_ad_ids || [])
  await patch(`ad_autopilot?id=eq.${enc(e.id)}`, {
    last_run_at: nowIso(), last_sent_at: nowIso(), last_kind: actualKind, runs: (e.runs || 0) + 1, used_ad_ids: used,
  })
  console.log(`autopilot ${e.id}: sent ${actualKind} ad for ${brandName || e.brand_id}${to ? '' : ' (no email address)'}`)
}

async function tick() {
  const cutoff = new Date(Date.now() - DUE_MS).toISOString()
  let rows
  try {
    rows = await getJSON(`ad_autopilot?select=*&active=is.true&media_type=eq.image&or=(last_run_at.is.null,last_run_at.lt.${enc(cutoff)})&order=last_run_at.asc.nullsfirst&limit=200`)
  } catch (err) { console.warn('fetch enrollments failed:', err.message); return }
  if (!Array.isArray(rows) || !rows.length) return
  console.log(`🚀 autopilot: ${rows.length} due`)
  for (const e of rows) {
    try { await processOne(e) } catch (err) { console.warn(`autopilot ${e.id} error:`, err?.message || err) }
  }
}

console.log(`🚀 autopilot-worker up — checking due enrollments every ${Math.round(EVERY / 60000)} min`)
for (;;) {
  try { await tick() } catch (e) { console.warn('tick error:', e?.message || e) }
  await sleep(EVERY)
}
