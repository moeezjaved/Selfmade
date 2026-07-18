/**
 * alert-worker — brand-tracking new-ad alerts (the retention #1).
 *
 * Every ~30 min: for each followed brand, find ads INSERTED since that follow's watermark
 * (created_at > last_notified_at), collapse variants by copy_sig into "concepts" so "47 new ads"
 * becomes "3 new concepts" (no spam), write one notification per (user, brand), and advance the
 * watermark. The in-app bell + Following feed read `notifications`. Email is Phase 2 (Resend).
 *
 * Run (droplet):
 *   docker run -d --name alert-worker --restart unless-stopped --init \
 *     --env-file <env> -v /opt/worker/src:/app/src selfmade-worker npx tsx src/alert-worker.mjs
 */
import { sendPaidEmail, getUserEmail, newAdBundleEmail, emailEnabled } from './email.mjs'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const EVERY = Math.max(300000, parseInt(process.env.ALERT_EVERY_MS || '1800000', 10))  // 30 min default
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const enc = encodeURIComponent

if (!U || !K) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

async function getJSON(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}
async function write(method, path, body) {
  const r = await fetch(`${U}/rest/v1/${path}`, { method, headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) })
  if (!r.ok) console.warn(`${method} ${path} → ${r.status} ${(await r.text()).slice(0, 120)}`)
}

async function tick() {
  let follows
  try { follows = await getJSON('followed_brands?select=id,user_id,page_id,brand_name,last_notified_at,email_alerts') }
  catch (e) { console.warn('fetch follows failed:', e.message); return }
  if (!Array.isArray(follows) || !follows.length) return

  let made = 0
  // Collect every opted-in user's brands-with-new-ads so we can send ONE bundled email per user
  // (2 credits total), instead of one email per brand. In-app notifications stay per-brand.
  const emailBundle = new Map()   // user_id -> [{ brandName, count, pageId }]
  for (const f of follows) {
    const since = f.last_notified_at || '1970-01-01T00:00:00Z'
    let ads
    try {
      ads = await getJSON(`discovery_ads_index?select=ad_id,copy_sig,created_at&page_id=eq.${enc(f.page_id)}&created_at=gt.${enc(since)}&has_creative=is.true&order=created_at.desc&limit=300`)
    } catch (e) { console.warn(`brand ${f.page_id} query failed: ${e.message}`); continue }
    if (!Array.isArray(ads) || !ads.length) continue

    // Collapse variants by copy signature → distinct CONCEPTS (so the alert isn't "47 near-dup ads").
    const concepts = new Set()
    for (const a of ads) concepts.add(a.copy_sig || a.ad_id)

    await write('POST', 'notifications', {
      user_id: f.user_id, type: 'new_ad', page_id: f.page_id,
      brand_name: f.brand_name, ad_count: concepts.size, sample_ad_id: ads[0].ad_id,
    })
    // Per-brand email opt-in: only bundle brands the user turned email alerts ON for.
    if (emailEnabled && f.email_alerts) {
      if (!emailBundle.has(f.user_id)) emailBundle.set(f.user_id, [])
      emailBundle.get(f.user_id).push({ brandName: f.brand_name, count: concepts.size, pageId: f.page_id, sampleAdId: ads[0].ad_id })
    }
    // Advance the watermark to the newest ad we just notified about → no duplicate alerts next run.
    await write('PATCH', `followed_brands?id=eq.${enc(f.id)}`, { last_notified_at: ads[0].created_at })
    made++
  }

  // ONE bundled email per opted-in user this cycle = 2 credits total (not per brand). Charged before
  // send, refunded on failure; users with no credits are skipped (their in-app notifications stand).
  // Double opt-in gate: only email users who confirmed their address (better inbox placement).
  const confirmedRows = await getJSON('user_profiles?select=id&email_confirmed_at=not.is.null').catch(() => [])
  const confirmed = new Set((confirmedRows || []).map(r => r.id))

  // One thumbnail per brand's sample ad (poster frame for video, R2 image for image ads). R2 URLs
  // are public (cdn.tryselfmade.ai), so they load directly in the email — no proxy needed.
  const thumbMap = {}
  const sampleIds = [...new Set([...emailBundle.values()].flat().map((i) => i.sampleAdId).filter(Boolean))]
  if (sampleIds.length) {
    const cres = await getJSON(`discovery_creatives?select=ad_id,asset_type,r2_url,poster_url,position&ad_id=in.(${sampleIds.map(enc).join(',')})&order=position.asc`).catch(() => [])
    for (const c of (cres || [])) {
      if (thumbMap[c.ad_id]) continue
      const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)
      if (t) thumbMap[c.ad_id] = t
    }
  }

  let mailed = 0, noCredits = 0, unconfirmed = 0
  for (const [userId, items] of emailBundle) {
    if (!confirmed.has(userId)) { unconfirmed++; continue }
    const to = await getUserEmail(userId)
    if (!to) continue
    const { subject, html } = newAdBundleEmail({ items: items.map((i) => ({ ...i, thumb: thumbMap[i.sampleAdId] || null })) })
    const r = await sendPaidEmail({ to, userId, action: 'email_alert', subject, html })
    if (r.sent) mailed++
    else if (r.reason === 'insufficient_credits') noCredits++
  }
  if (made) console.log(`📢 ${made} new-ad notification(s)${mailed ? `, ${mailed} bundled email(s) sent (2cr each)` : ''}${noCredits ? `, ${noCredits} skipped (no credits)` : ''}${unconfirmed ? `, ${unconfirmed} skipped (email unconfirmed)` : ''} across ${follows.length} follows`)
}

console.log(`🔔 alert-worker up — checking followed brands every ${Math.round(EVERY / 60000)} min`)
for (;;) {
  try { await tick() } catch (e) { console.warn('tick error:', e?.message || e) }
  await sleep(EVERY)
}
