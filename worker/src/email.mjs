/**
 * Shared email layer — Resend API. Used by alert-worker (instant new-ad alerts) and digest-worker
 * (weekly "what's winning"). Auth emails (confirm/reset) go through Supabase Auth's own SMTP →
 * point that at Resend in the Supabase dashboard; this module is only for product emails.
 *
 * Env: RESEND_API_KEY, EMAIL_FROM (e.g. "Selfmade <alerts@tryselfmade.ai>"), APP_URL.
 * No SDK — just a fetch to https://api.resend.com/emails. Gracefully no-ops if the key isn't set.
 */
const KEY = process.env.RESEND_API_KEY
const FROM = process.env.EMAIL_FROM || 'Selfmade <alerts@tryselfmade.ai>'
const APP = (process.env.APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY

export const emailEnabled = !!KEY

export async function sendEmail({ to, subject, html }) {
  if (!KEY) { console.warn(`(RESEND_API_KEY not set — would email "${subject}" to ${to})`); return false }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!r.ok) { console.warn(`resend ${r.status}: ${(await r.text()).slice(0, 160)}`); return false }
    return true
  } catch (e) { console.warn('email send failed:', e?.message || e); return false }
}

const SB_H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const rpc = (fn, body) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SB_H, body: JSON.stringify(body) })

/**
 * Charge N credits (priced by `action` in credit_pricing) for an email, THEN send it, then commit —
 * or refund if the send fails so we never charge for a non-delivered email. Returns a reason so the
 * caller can skip users with no credits. reserve_credits() raises 'insufficient_credits'.
 */
export async function sendPaidEmail({ to, userId, action, subject, html }) {
  if (!emailEnabled) return { sent: false, reason: 'no_key' }
  if (!U || !K || !userId) return { sent: false, reason: 'no_user' }
  const rr = await rpc('reserve_credits', { p_user: userId, p_action: action })
  if (!rr.ok) {
    const t = await rr.text().catch(() => '')
    return { sent: false, reason: t.includes('insufficient_credits') ? 'insufficient_credits' : 'reserve_failed' }
  }
  const tx = await rr.json().catch(() => null)
  const txId = Array.isArray(tx) ? tx[0]?.id : tx?.id
  const sent = await sendEmail({ to, subject, html })
  if (sent) { if (txId) await rpc('commit_credits', { p_tx: txId }).catch(() => {}); return { sent: true } }
  if (txId) await rpc('refund_credits', { p_tx: txId }).catch(() => {})   // don't charge for a failed send
  return { sent: false, reason: 'send_failed' }
}

/** Look up a user's email via the Supabase Auth admin API (service-role only). */
export async function getUserEmail(userId) {
  if (!U || !K) return null
  try {
    const r = await fetch(`${U}/auth/v1/admin/users/${userId}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    if (!r.ok) return null
    const d = await r.json()
    return d?.email || null
  } catch { return null }
}

/** Branded responsive shell — inline styles (email clients strip <style>). */
export function emailShell({ heading, bodyHtml, ctaText, ctaPath }) {
  const cta = ctaText ? `<a href="${APP}${ctaPath || ''}" style="display:inline-block;margin-top:18px;background:#1a3a1a;color:#dffe95;padding:12px 24px;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px">${ctaText}</a>` : ''
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#f4f7f2;padding:28px 12px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6ede2;border-radius:14px;padding:28px 26px">
    <div style="font-size:22px;font-weight:800;color:#2d6a00;letter-spacing:-0.02em;margin-bottom:18px">Selfmade</div>
    <div style="font-size:18px;font-weight:700;color:#1a2e1a;margin-bottom:12px">${heading}</div>
    <div style="font-size:14px;line-height:1.6;color:#3a4a3a">${bodyHtml}</div>
    ${cta}
    <div style="margin-top:26px;font-size:12px;color:#9aaa9a;border-top:1px solid #eef2ec;padding-top:14px">
      You're receiving this because you track brands on Selfmade.
      <a href="${APP}/settings" style="color:#6b7280">Manage email alerts</a>.
    </div>
  </div>
</div>`
}

/** One brand's new-ad alert email (kept for one-off use). */
export function newAdEmail({ brandName, adCount, pageId }) {
  return {
    subject: `${brandName || 'A brand you follow'} just launched ${adCount} new ${adCount === 1 ? 'ad' : 'ads'}`,
    html: emailShell({
      heading: `${brandName || 'A brand you follow'} launched ${adCount} new ${adCount === 1 ? 'ad' : 'ads'}`,
      bodyHtml: `A brand you're tracking just shipped fresh creative. See what they're testing — hooks, angles, and how it compares to their winners.`,
      ctaText: `See the new ${adCount === 1 ? 'ad' : 'ads'} →`,
      ctaPath: pageId ? `/discovery/brand-spy/${pageId}` : '/discovery/following',
    }),
  }
}

/** Daily Ad Autopilot: one freshly-generated ad for the user's brand, emailed each day. The credit
 * charge already happened during generation (same price as a manual clone) — this email is the
 * delivery. kind = 'variation' (a new take on their ad) | 'fresh' (a new competitor winner cloned). */
export function autopilotDailyEmail({ brandName, imageUrl, kind, creditsLeft }) {
  const b = brandName || 'your brand'
  const badge = kind === 'fresh' ? 'Fresh competitor angle · cloned with your product' : 'A new take on your ad'
  const left = Number.isFinite(creditsLeft) ? ` · ${creditsLeft.toLocaleString()} credits left` : ''
  const img = imageUrl
    ? `<div style="margin:14px 0 4px"><img src="${imageUrl}" alt="Your daily ad" width="280" style="width:280px;max-width:100%;border-radius:12px;border:1px solid #e6ede2;display:block;margin:0 auto"></div>`
    : ''
  return {
    subject: `Today's ad for ${b} is ready`,
    html: emailShell({
      heading: `Today's ad for ${b}`,
      bodyHtml: `<span style="display:inline-block;background:#eaf3de;color:#3b6d11;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:6px">${badge}</span>${img}
        <div style="margin-top:10px">Your daily ad is ready — rebuilt around your real product. Download it, tweak the words, or launch it as-is.</div>
        <div style="margin-top:10px;font-size:12px;color:#9aaa9a">$0.15 charged to your credits${left}</div>`,
      ctaText: 'Download or edit this ad →',
      ctaPath: '/creative-studio',
    }),
  }
}

/** BUNDLED alert: ALL of a user's followed brands that shipped ads this cycle, in ONE email (2 credits
 * total, not per-brand). items = [{ brandName, count, pageId }]. */
export function newAdBundleEmail({ items }) {
  const nBrands = items.length
  const totalAds = items.reduce((s, i) => s + (i.count || 0), 0)
  const rows = items.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 25)
    .map((i) => {
      // Tables (not flex) for image+text alignment — the only layout email clients render reliably.
      const thumbCell = i.thumb
        ? `<td width="64" style="padding:8px 12px 8px 0;vertical-align:middle"><img src="${i.thumb}" width="52" height="52" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid #e6ede2;display:block"></td>`
        : ''
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #f0f4ee"><tr>${thumbCell}<td style="padding:9px 0;font-size:14px;vertical-align:middle"><b style="color:#1a2e1a">${i.brandName || 'A brand you follow'}</b> <span style="color:#5a7a5a">— ${i.count} new ${i.count === 1 ? 'concept' : 'concepts'}</span></td></tr></table>`
    }).join('')
  return {
    subject: `${nBrands} ${nBrands === 1 ? 'brand' : 'brands'} you follow launched ${totalAds} new ${totalAds === 1 ? 'ad' : 'ads'}`,
    html: emailShell({
      heading: `${nBrands} ${nBrands === 1 ? 'brand' : 'brands'} you follow just shipped new ads`,
      bodyHtml: `Fresh creative from the competitors you're tracking:<div style="margin-top:14px">${rows}</div>`,
      ctaText: 'See all the new ads →',
      ctaPath: '/discovery/following',
    }),
  }
}
