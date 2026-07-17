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
 * Env: RESEND_API_KEY, EMAIL_FROM (e.g. "Selfmade <alerts@send.tryselfmade.ai>"), APP_URL.
 */
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'

const KEY = process.env.RESEND_API_KEY
// Must send from a Resend-VERIFIED domain. The verified domain is the send.tryselfmade.ai
// subdomain (Resend › Domains), NOT the bare tryselfmade.ai — sending from an unverified
// domain makes Resend reject every send. Override via EMAIL_FROM (keep it on send.*).
const FROM = process.env.EMAIL_FROM || 'Selfmade <alerts@send.tryselfmade.ai>'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export const emailEnabled = !!KEY

/** Credit top-up receipt — sent when a one-time credit pack purchase completes. */
export async function sendTopupEmail(to: string, credits: number, amountUsd: number): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const html = emailShell({
    title: `${credits.toLocaleString()} credits added 🎉`,
    intro: `Your payment of <b>$${amountUsd.toFixed(2)}</b> went through and <b>${credits.toLocaleString()} credits</b> are in your account now. Use them on any image or video remake — they never expire.`,
    ctaText: 'Start remaking', ctaUrl: `${APP_URL}/discovery`,
  })
  return sendEmail(to, `Your ${credits.toLocaleString()} credits are ready`, html)
}

/** Subscription receipt — sent when a plan starts (checkout completes). */
export async function sendSubscriptionEmail(to: string, planLabel: string, cycle: string, trialing: boolean): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const cyc = cycle === 'annual' ? 'annual' : 'monthly'
  const html = emailShell({
    title: trialing ? `Your ${planLabel} trial is live 🚀` : `Welcome to ${planLabel} 🚀`,
    intro: trialing
      ? `Your <b>${planLabel}</b> plan (${cyc}) is active with a <b>7-day free trial</b> — you won't be charged until it ends, and you can cancel anytime from Billing. Your monthly credits are in your account now.`
      : `Your <b>${planLabel}</b> plan (${cyc}) is active and your monthly credits have been added. Manage or change your plan anytime from Billing.`,
    ctaText: 'Open Selfmade', ctaUrl: `${APP_URL}/discovery`,
  })
  return sendEmail(to, trialing ? `Your ${planLabel} trial is live` : `Welcome to ${planLabel}`, html)
}

/** Subscription cancelled → dropped to Free. Warm win-back (work is saved, come back anytime). */
export async function sendSubscriptionCanceledEmail(to: string, planLabel: string): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const html = emailShell({
    title: `Your ${planLabel} plan was cancelled`,
    intro: `You're on the <b>Free</b> plan now — but nothing's lost. Every ad, brand and board you made is still here, and you can pick up right where you left off. Come back whenever you're ready; your best-performing remakes are waiting.`,
    ctaText: 'Reactivate my plan', ctaUrl: `${APP_URL}/pricing`,
  })
  return sendEmail(to, `Your ${planLabel} plan was cancelled — your work is saved`, html)
}

/** Low-credits nudge — sent once per month when a user runs low, so they can top up before they're stuck. */
export async function sendLowCreditsEmail(to: string): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const html = emailShell({
    title: `You're running low`,
    intro: `Heads up — you don't have quite enough left for your next <b>video ad</b>. Top up in a few seconds (packs never expire) so you're not stopped mid-idea. Image ads stay free on Creator and Agency.`,
    ctaText: 'Top up', ctaUrl: `${APP_URL}/pricing`,
  })
  return sendEmail(to, `You're running low — top up to keep creating`, html)
}

/** Fire a low-credits nudge at most once/calendar-month, when the owner can't afford another video. */
export async function maybeLowCreditsEmail(userId: string, to: string): Promise<void> {
  if (!emailEnabled || !to) return
  try {
    const { resolveBillingOwner } = await import('@/lib/org')
    const admin = createAdminClient()
    const owner = await resolveBillingOwner(admin, userId)
    const { data: w } = await admin.from('credit_wallets').select('plan_credits_balance, topup_credits_balance').eq('owner_id', owner).maybeSingle()
    const bal = Number((w as any)?.plan_credits_balance || 0) + Number((w as any)?.topup_credits_balance || 0)
    if (bal >= 600) return   // still enough for a video → not "low"
    const now = new Date()
    const mk = `LOW_CREDITS_${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    if (!(await claimOnceLog(owner, mk))) return   // already nudged this month
    await sendLowCreditsEmail(to)
  } catch { /* best-effort */ }
}

/** Abandoned-onboarding nudge — signed up, never made an ad. Sent once, ~1–2 days after signup. */
export async function sendOnboardingNudgeEmail(to: string, fullName?: string): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there'
  const html = emailShell({
    title: `${first}, your first ad is 2 minutes away`,
    intro: `You signed up but haven't made an ad yet — and the first one's the fun part. Pick any winning ad, drop in your product, and get a scroll-stopping <b>image or video</b> back in about two minutes. Your first 5 image ads are free.`,
    ctaText: 'Remake your first ad', ctaUrl: `${APP_URL}/discovery`,
  })
  return sendEmail(to, `${first}, make your first ad in 2 minutes 🎬`, html)
}

/** Payment-failed notice — a renewal charge bounced. Nudge them to update their card before we suspend. */
export async function sendPaymentFailedEmail(to: string, planLabel: string): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const html = emailShell({
    title: `Your ${planLabel} payment didn't go through`,
    intro: `We couldn't charge your card for your <b>${planLabel}</b> plan. No stress — your account is still active for now. Update your card in Billing and we'll retry automatically. If it isn't fixed, the plan pauses and you'd drop to Free.`,
    ctaText: 'Update payment method', ctaUrl: `${APP_URL}/pricing`,
  })
  return sendEmail(to, `Action needed: your ${planLabel} payment failed`, html)
}

/**
 * Welcome email — sent once when a new account is created (both email + Google signup). Self-contained:
 * uses only sendEmail + emailShell (no user_profiles lifecycle columns, which aren't all present on
 * this DB). Idempotency is handled by the caller via an activity_logs 'WELCOME_EMAIL' row.
 */
export async function sendWelcomeEmail(to: string, fullName?: string): Promise<boolean> {
  if (!emailEnabled || !to) return false
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there'
  const html = emailShell({
    title: `Welcome to Selfmade, ${first} 👋`,
    intro: `You're in — with <b>600 free credits</b> to start. The fastest way to see what Selfmade does: find a winning ad from any brand and remake it with <b>your</b> product in minutes. No designer, no filming, no waiting.`,
    ctaText: 'Remake your first ad', ctaUrl: `${APP_URL}/discovery`,
  })
  return sendEmail(to, 'Welcome to Selfmade 👋 remake your first ad', html)
}

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
 * Claim a one-time lifecycle email via activity_logs so it sends exactly once. Reliable on this DB:
 * the old version keyed on user_profiles columns that (a) don't exist here and (b) were matched by the
 * wrong id (row PK vs auth user_id), so it silently never sent. activity_logs is always present and
 * keyed by the auth user_id. Best-effort: a logging hiccup returns false (skip) rather than throwing.
 */
async function claimOnceLog(userId: string, key: string): Promise<boolean> {
  const admin = createAdminClient()
  try {
    const { data: prior } = await admin.from('activity_logs')
      .select('id').eq('user_id', userId).eq('action_type', key).limit(1).maybeSingle()
    if (prior) return false
    await admin.from('activity_logs').insert({
      user_id: userId, action_type: key, entity_type: 'account', description: `${key} sent`, performed_by: 'system',
    })
    return true
  } catch { return false }
}

/** "Brand saved" — sent once, the first time a user creates a brand. */
export async function sendFirstBrandEmail(userId: string, to: string, brandName: string) {
  if (!emailEnabled || !to) return
  if (!(await claimOnceLog(userId, 'FIRST_BRAND_EMAIL'))) return
  const html = emailShell({
    title: `Brand saved: ${brandName}`,
    intro: `Nice — <b>${brandName}</b> is saved. Every ad you remake will now use its product photos automatically. Manage it anytime from My Creatives → Brands.`,
    ctaText: 'Remake an ad', ctaUrl: `${APP_URL}/discovery`,
  })
  await sendEmail(to, `Brand saved: ${brandName}`, html)
}

/** "Your first ad is ready 🎉" — sent once, on the user's first generated creative. */
export async function sendFirstAdEmail(userId: string, to: string, imageUrl?: string) {
  if (!emailEnabled || !to) return
  if (!(await claimOnceLog(userId, 'FIRST_AD_EMAIL'))) return
  const html = emailShell({
    title: `Your first ad is ready! 🎉`,
    intro: `You just remade your first winning ad — great work. Try a few variations, tweak the headline, or remake another. Everything you make is saved in My Creatives.`,
    imageUrl, ctaText: 'Open My Creatives', ctaUrl: `${APP_URL}/creative-studio`,
  })
  await sendEmail(to, `Your first ad is ready! 🎉`, html)
}
