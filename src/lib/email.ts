/**
 * App-side transactional / lifecycle email (Resend, no SDK — just a fetch).
 *
 * Two ideas here:
 *  1. Double opt-in — the first lifecycle email carries a "Confirm your email" CTA. Clicking it sets
 *     user_profiles.email_confirmed_at, which the marketing senders (daily winning-ad alerts / digest)
 *     gate on. So we only push marketing to people who engaged → far better inbox placement.
 *  2. Lifecycle emails — "Brand saved", "Your first ad is ready 🎉" — sent exactly once via a
 *     claim-once column so parallel requests can't double-send.
 *
 * Env: RESEND_API_KEY, EMAIL_FROM (e.g. "Selfmade <alerts@tryselfmade.ai>"), APP_URL.
 */
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'

const KEY = process.env.RESEND_API_KEY
const FROM = process.env.EMAIL_FROM || 'Selfmade <alerts@tryselfmade.ai>'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export const emailEnabled = !!KEY

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!KEY || !to) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!r.ok) { console.warn(`resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`); return false }
    return true
  } catch (e) { console.warn('resend send failed', e); return false }
}

/** Branded Selfmade email shell (dark green + lime), with optional CTA and confirm strip. */
export function emailShell(opts: { title: string; intro: string; ctaText?: string; ctaUrl?: string; confirmUrl?: string; imageUrl?: string }): string {
  const { title, intro, ctaText, ctaUrl, confirmUrl, imageUrl } = opts
  return `<!doctype html><html><body style="margin:0;background:#eef5eb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:#1a3a1a;padding:20px 28px;"><span style="color:#dffe95;font-weight:800;font-size:18px;letter-spacing:-.02em;">Selfmade</span></td></tr>
      ${imageUrl ? `<tr><td><img src="${imageUrl}" alt="" style="width:100%;display:block;"/></td></tr>` : ''}
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 12px;color:#111;font-size:22px;font-weight:800;line-height:1.25;">${title}</h1>
        <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">${intro}</p>
        ${ctaText && ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;background:#1a3a1a;color:#dffe95;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">${ctaText}</a>` : ''}
        ${confirmUrl ? `<div style="margin-top:22px;padding:14px 16px;background:#f3f8f1;border:1px solid #d8e6d4;border-radius:12px;">
          <p style="margin:0 0 10px;color:#375a33;font-size:13px;line-height:1.5;"><b>One quick thing:</b> confirm your email so we can send you fresh winning-ad picks. It keeps us out of your spam folder too.</p>
          <a href="${confirmUrl}" style="display:inline-block;background:#dffe95;color:#14281a;text-decoration:none;font-weight:700;font-size:13px;padding:9px 16px;border-radius:8px;">Confirm my email</a>
        </div>` : ''}
      </td></tr>
      <tr><td style="padding:0 28px 26px;"><p style="margin:0;color:#9ca3af;font-size:12px;">Selfmade · You're receiving this because you have an account. Manage emails in Settings.</p></td></tr>
    </table>
  </td></tr></table></body></html>`
}

/** Get (or lazily create) the user's confirm token, and build the confirm URL. */
export async function confirmUrlFor(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin.from('user_profiles').select('email_confirm_token, email_confirmed_at').eq('id', userId).maybeSingle()
  if ((data as any)?.email_confirmed_at) return '' // already confirmed → no strip needed
  let token = (data as any)?.email_confirm_token
  if (!token) { token = randomUUID(); await admin.from('user_profiles').update({ email_confirm_token: token }).eq('id', userId) }
  return `${APP_URL}/api/email/confirm?token=${token}`
}

/**
 * Atomically claim a one-time lifecycle email so concurrent requests send it exactly once.
 * Returns true only for the caller that flipped the column from NULL → now().
 */
async function claimOnce(userId: string, column: 'first_brand_email_at' | 'first_ad_email_at'): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin.from('user_profiles')
    .update({ [column]: new Date().toISOString() })
    .eq('id', userId).is(column, null).select('id')
  return Array.isArray(data) && data.length > 0
}

/** "Brand saved" — sent once, the first time a user creates a brand. */
export async function sendFirstBrandEmail(userId: string, to: string, brandName: string) {
  if (!emailEnabled || !to) return
  if (!(await claimOnce(userId, 'first_brand_email_at'))) return
  const confirmUrl = await confirmUrlFor(userId)
  const html = emailShell({
    title: `Brand saved: ${brandName}`,
    intro: `Nice — <b>${brandName}</b> is saved. Every ad you clone will now use its product photos automatically. Manage it anytime from My Creatives → Brands.`,
    ctaText: 'Clone an ad', ctaUrl: `${APP_URL}/discovery`, confirmUrl: confirmUrl || undefined,
  })
  await sendEmail(to, `Brand saved: ${brandName}`, html)
}

/** "Your first ad is ready 🎉" — sent once, on the user's first generated creative. */
export async function sendFirstAdEmail(userId: string, to: string, imageUrl?: string) {
  if (!emailEnabled || !to) return
  if (!(await claimOnce(userId, 'first_ad_email_at'))) return
  const confirmUrl = await confirmUrlFor(userId)
  const html = emailShell({
    title: `Your first ad is ready! 🎉`,
    intro: `You just cloned your first winning ad — great work. Try a few variations, tweak the headline, or clone another. Everything you make is saved in My Creatives.`,
    imageUrl, ctaText: 'Open My Creatives', ctaUrl: `${APP_URL}/creative-studio`, confirmUrl: confirmUrl || undefined,
  })
  await sendEmail(to, `Your first ad is ready! 🎉`, html)
}
