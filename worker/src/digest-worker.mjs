/**
 * digest-worker — weekly "what's new from brands you follow" email. One-shot (runs, sends, exits) so
 * a weekly cron drives it (like rollup-cron.sh / classify-cron.sh). Skips users with nothing new and
 * users who set digest_frequency='off'. Reuses the email layer.
 *
 * Cron (droplet), e.g. Mondays 14:00 UTC:  0 14 * * 1  docker run --rm --env-file <env> -v /opt/worker/src:/app/src selfmade-worker npx tsx src/digest-worker.mjs
 */
import { sendEmail, getUserEmail, emailShell, emailEnabled } from './email.mjs'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K }
const enc = encodeURIComponent

async function getJSON(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

async function run() {
  if (!emailEnabled) { console.log('RESEND_API_KEY not set — digest skipped'); return }
  if (!U || !K) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  const prefs = await getJSON('notification_prefs?select=user_id,digest_frequency').catch(() => [])
  const off = new Set((prefs || []).filter(p => p.digest_frequency === 'off').map(p => p.user_id))

  const follows = await getJSON('followed_brands?select=user_id,page_id,brand_name').catch(() => [])
  const byUser = new Map()
  for (const f of follows || []) {
    if (off.has(f.user_id)) continue
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

    const html = emailShell({
      heading: `${total} new ${total === 1 ? 'ad' : 'ads'} from brands you follow this week`,
      bodyHtml: `Here's what your tracked brands shipped over the last 7 days:<div style="margin-top:14px">${rows}</div>`,
      ctaText: 'Open your feed →',
      ctaPath: '/discovery/following',
    })
    if (await sendEmail({ to, subject: `Your week: ${total} new ${total === 1 ? 'ad' : 'ads'} from brands you follow`, html })) sent++
  }
  console.log(`📬 digest done — sent ${sent} email(s) across ${byUser.size} follower(s)`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
