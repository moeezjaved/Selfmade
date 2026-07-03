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
import { sendPaidEmail, getUserEmail, newAdEmail, emailEnabled } from './email.mjs'

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
  try { follows = await getJSON('followed_brands?select=id,user_id,page_id,brand_name,last_notified_at') }
  catch (e) { console.warn('fetch follows failed:', e.message); return }
  if (!Array.isArray(follows) || !follows.length) return

  // Who opted into instant email (so we only fetch addresses + send for them).
  const wantsEmail = new Map()
  if (emailEnabled) {
    try {
      const prefs = await getJSON('notification_prefs?select=user_id,instant_email&instant_email=is.true')
      for (const p of (prefs || [])) wantsEmail.set(p.user_id, true)
    } catch { /* prefs optional */ }
  }

  let made = 0, mailed = 0, noCredits = 0
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
    // Instant email (opt-in, costs 2 credits). One email per brand per cycle = naturally debounced by
    // the watermark. sendPaidEmail charges before sending and refunds if the send fails; users with no
    // credits are simply skipped (the in-app notification still lands).
    if (wantsEmail.has(f.user_id)) {
      const to = await getUserEmail(f.user_id)
      if (to) {
        const { subject, html } = newAdEmail({ brandName: f.brand_name, adCount: concepts.size, pageId: f.page_id })
        const r = await sendPaidEmail({ to, userId: f.user_id, action: 'email_alert', subject, html })
        if (r.sent) mailed++
        else if (r.reason === 'insufficient_credits') noCredits++
      }
    }
    // Advance the watermark to the newest ad we just notified about → no duplicate alerts next run.
    await write('PATCH', `followed_brands?id=eq.${enc(f.id)}`, { last_notified_at: ads[0].created_at })
    made++
  }
  if (made) console.log(`📢 ${made} new-ad notification(s) created${mailed ? `, ${mailed} emailed (2cr each)` : ''}${noCredits ? `, ${noCredits} skipped (no credits)` : ''} across ${follows.length} follows`)
}

console.log(`🔔 alert-worker up — checking followed brands every ${Math.round(EVERY / 60000)} min`)
for (;;) {
  try { await tick() } catch (e) { console.warn('tick error:', e?.message || e) }
  await sleep(EVERY)
}
