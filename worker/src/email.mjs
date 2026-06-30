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

/** One brand's new-ad alert email. */
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
