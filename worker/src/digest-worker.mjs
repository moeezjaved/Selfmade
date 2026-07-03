/**
 * digest-worker — weekly "what's new from brands you follow" email. One-shot (runs, sends, exits) so
 * a weekly cron drives it (like rollup-cron.sh / classify-cron.sh). Skips users with nothing new and
 * users who set digest_frequency='off'. Reuses the email layer.
 *
 * Cron (droplet), e.g. Mondays 14:00 UTC:  0 14 * * 1  docker run --rm --env-file <env> -v /opt/worker/src:/app/src selfmade-worker npx tsx src/digest-worker.mjs
 */
import { sendPaidEmail, getUserEmail, emailShell, emailEnabled } from './email.mjs'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP = (process.env.APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const H = { apikey: K, Authorization: 'Bearer ' + K }
const enc = encodeURIComponent
const titleCase = (s) => (s || '').replace(/\b\w/g, (c) => c.toUpperCase())

async function getJSON(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

// "Brands to follow in <your niche>" — the user's dominant industry (from their followed brands),
// then the top brands in that industry they DON'T already follow. Falls back to top brands overall.
async function nicheRecs(followPageIds) {
  const notIn = `(${followPageIds.map(enc).join(',')})`
  try {
    const rows = await getJSON(`discovery_crawl_terms?select=industry&page_id=in.(${followPageIds.map(enc).join(',')})&industry=not.is.null`).catch(() => [])
    const freq = new Map()
    for (const r of rows || []) if (r.industry) freq.set(r.industry, (freq.get(r.industry) || 0) + 1)
    const industry = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    let recs = []
    if (industry) recs = await getJSON(`discovery_crawl_terms?select=page_id,term,ads_found&industry=eq.${enc(industry)}&ads_found=gt.50&page_id=not.in.${notIn}&order=ads_found.desc&limit=4`).catch(() => [])
    if (!recs.length) recs = await getJSON(`discovery_crawl_terms?select=page_id,term,ads_found&ads_found=gt.100&page_id=not.in.${notIn}&order=ads_found.desc&limit=4`).catch(() => [])
    return { industry, recs: recs || [] }
  } catch { return { industry: null, recs: [] } }
}

async function run() {
  if (!emailEnabled) { console.log('RESEND_API_KEY not set — digest skipped'); return }
  if (!U || !K) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  // OPT-IN ONLY: send only to users who explicitly chose weekly/daily. No prefs row = not opted in.
  const prefs = await getJSON('notification_prefs?select=user_id,digest_frequency').catch(() => [])
  const optedIn = new Set((prefs || []).filter(p => ['weekly', 'daily'].includes(p.digest_frequency)).map(p => p.user_id))

  const follows = await getJSON('followed_brands?select=user_id,page_id,brand_name').catch(() => [])
  const byUser = new Map()
  for (const f of follows || []) {
    if (!optedIn.has(f.user_id)) continue
    if (!byUser.has(f.user_id)) byUser.set(f.user_id, [])
    byUser.get(f.user_id).push(f)
  }

  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  let sent = 0
  for (const [userId, userFollows] of byUser) {
    const pageIds = userFollows.slice(0, 200).map(f => f.page_id)
    if (!pageIds.length) continue
    let ads = []
    try {
      ads = await getJSON(`discovery_ads_index?select=page_id,page_name,created_at&page_id=in.(${pageIds.map(enc).join(',')})&created_at=gt.${enc(weekAgo)}&has_creative=is.true&order=created_at.desc&limit=300`)
    } catch { continue }
    if (!Array.isArray(ads) || !ads.length) continue   // nothing new → don't send an empty digest

    const perBrand = new Map()
    for (const a of ads) { const name = a.page_name || a.page_id; perBrand.set(name, (perBrand.get(name) || 0) + 1) }
    const total = ads.length
    const to = await getUserEmail(userId)
    if (!to) continue

    const rows = Array.from(perBrand.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, n]) => `<div style="padding:9px 0;border-bottom:1px solid #f0f4ee;font-size:14px"><b style="color:#1a2e1a">${name}</b> <span style="color:#5a7a5a">— ${n} new ${n === 1 ? 'ad' : 'ads'}</span></div>`).join('')

    // "Brands to follow in <niche>" — drives more follows (= more retention).
    const { industry, recs } = await nicheRecs(pageIds)
    const recsHtml = recs.length ? `<div style="margin-top:22px;padding:16px;background:#f4f7f2;border-radius:10px">
      <div style="font-size:14px;font-weight:700;color:#1a2e1a;margin-bottom:10px">Brands to follow${industry ? ` in ${titleCase(industry)}` : ''}</div>
      ${recs.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px"><span style="color:#1a2e1a"><b>${titleCase(r.term)}</b> <span style="color:#8a9a8a">· ${(r.ads_found || 0).toLocaleString()} ads</span></span><a href="${APP}/discovery/brand-spy/${r.page_id}" style="color:#2d6a00;font-weight:700;text-decoration:none">Follow →</a></div>`).join('')}
    </div>` : ''

    const html = emailShell({
      heading: `${total} new ${total === 1 ? 'ad' : 'ads'} from brands you follow this week`,
      bodyHtml: `Here's what your tracked brands shipped over the last 7 days:<div style="margin-top:14px">${rows}</div>${recsHtml}`,
      ctaText: 'Open your feed →',
      ctaPath: '/discovery/following',
    })
    const r = await sendPaidEmail({ to, userId: userId, action: 'email_digest', subject: `Your week: ${total} new ${total === 1 ? 'ad' : 'ads'} from brands you follow`, html })
    if (r.sent) sent++
  }
  console.log(`📬 digest done — sent ${sent} email(s) across ${byUser.size} follower(s)`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
