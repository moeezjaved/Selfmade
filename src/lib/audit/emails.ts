/**
 * The audit nurture drip — 8 emails, sent over ~30 days after someone runs the free store-audit and gives
 * their email. Each is built from the lead's own report snapshot (real revenue-at-stake, real leaks, the
 * real ads we rendered them) so it never feels generic. Email #1 sends instantly; #2–#8 are queued and
 * (by default) wait for admin approval. Stops the moment they sign up or unsubscribe.
 */
import { emailShell } from '@/lib/email'

const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai'

export type AuditLead = {
  id: string
  email: string
  domain: string | null
  brand_name: string | null
  ad_urls: string[] | null
  unsub_token: string
  report: {
    score?: number
    category?: string
    currency?: string
    revenueLostPerYear?: number
    topLeak?: string            // one-line biggest leak
    leaks?: string[]            // a few headline gaps
    rivalName?: string          // top competitor
    rivalFormula?: string       // e.g. "Question hook × Curiosity angle"
    aiMissing?: number          // how many AI engines don't mention them
    aiTotal?: number
  } | null
}

const money = (n?: number, cur = '$') => (n && n > 0 ? `${cur}${Math.round(n).toLocaleString()}` : null)
const firstName = (email: string) => {
  const s = (email.split('@')[0] || 'there').replace(/[._-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1).split(' ')[0] : 'there'
}
// Signup-first funnel: the recipient already has an account, so every CTA DEEP-LINKS straight to the
// feature the email is about (not a generic /signup). If their session has expired the app bounces them
// through /login and back. `ref` is kept for attribution.
const deep = (_lead: AuditLead, path: string, ref: string) => `${APP_URL}${path}${path.includes('?') ? '&' : '?'}ref=${ref}`
const unsubFooterUrl = (lead: AuditLead) => `${APP_URL}/api/audit/unsub?t=${lead.unsub_token}`

/** Wrap emailShell but swap the generic footer line for an unsubscribe link (these are cold-ish leads). */
function shell(lead: AuditLead, opts: Parameters<typeof emailShell>[0]): string {
  const html = emailShell(opts)
  return html.replace(
    /You're receiving this because you have an account\. Manage emails in Settings\./,
    `You ran a free store audit for <b>${lead.domain || 'your store'}</b>. <a href="${unsubFooterUrl(lead)}" style="color:#9ca3af;">Unsubscribe</a>.`,
  )
}

export type AuditEmailStep = { step: number; dayOffset: number; build: (lead: AuditLead) => { subject: string; html: string } }

// The sequence. dayOffset is days after capture; step 1 = 0 (instant).
export const AUDIT_SEQUENCE: AuditEmailStep[] = [
  {
    step: 1, dayOffset: 0,
    build: (lead) => {
      const r = lead.report || {}
      const lost = money(r.revenueLostPerYear, r.currency)
      const ad = (lead.ad_urls || [])[0]
      return {
        subject: `Your ${lead.brand_name || 'store'} audit${lost ? ` — ${lost}/yr on the table` : ''}`,
        html: shell(lead, {
          title: `${firstName(lead.email)}, your store audit is ready`,
          intro: `We read your ads, your search &amp; AI visibility, and your catalog.${lost ? ` Best estimate: you're leaving <b>${lost}/year</b> on the table.` : ''}${r.topLeak ? ` Your #1 leak: <b>${r.topLeak}</b>.` : ''}<br/><br/>We also made you <b>${(lead.ad_urls || []).length || 5} real ads</b> from the winning DNA your rivals use. See the full report and claim them — free.`,
          imageUrl: ad || undefined,
          ctaText: 'See your full report + ads', ctaUrl: deep(lead, '/hq', 'audit-email-1'),
        }),
      }
    },
  },
  {
    step: 2, dayOffset: 1,
    build: (lead) => {
      const r = lead.report || {}
      const lost = money(r.revenueLostPerYear, r.currency)
      return {
        subject: `The #1 thing costing ${lead.brand_name || 'your store'} sales`,
        html: shell(lead, {
          title: `Your biggest leak — and the fix`,
          intro: `${r.topLeak ? `<b>${r.topLeak}</b>` : `Your store has a clear, fixable conversion leak`}.${lost ? ` It's the main driver of the ~<b>${lost}/year</b> we found.` : ''} It's the kind of thing a $1M brand fixes in an afternoon — and most $100k brands never see. Want us to fix it for you?`,
          ctaText: 'Fix this leak', ctaUrl: deep(lead, '/mission/cro', 'audit-email-2'),
        }),
      }
    },
  },
  {
    step: 3, dayOffset: 3,
    build: (lead) => {
      const r = lead.report || {}
      return {
        subject: `${r.rivalName || 'Your rivals'} have a formula you're missing`,
        html: shell(lead, {
          title: `Your rivals share one winning recipe`,
          intro: `${r.rivalName ? `<b>${r.rivalName}</b> and your top competitors` : 'Your top competitors'} keep running the same winning pattern${r.rivalFormula ? `: <b>${r.rivalFormula}</b>` : ''} — while your ads don't. We decoded their creative DNA in your audit and wrote ads that beat it. They're waiting in your report.`,
          imageUrl: (lead.ad_urls || [])[1] || (lead.ad_urls || [])[0] || undefined,
          ctaText: 'See the winning formula', ctaUrl: deep(lead, '/ads-workspace/competitors', 'audit-email-3'),
        }),
      }
    },
  },
  {
    step: 4, dayOffset: 5,
    build: (lead) => ({
      subject: `We wrote ${(lead.ad_urls || []).length || 5} ads for ${lead.brand_name || 'you'} — want them live?`,
      html: shell(lead, {
        title: `Your ads are made. Want them running?`,
        intro: `Not a to-do list — <b>${(lead.ad_urls || []).length || 5} finished ads</b>, generated from the winning DNA your rivals use, featuring your real products. Claim them, tweak anything, and launch. Your first renders are on us.`,
        imageUrl: (lead.ad_urls || [])[0] || undefined,
        ctaText: 'Claim my ads', ctaUrl: deep(lead, '/creative-studio', 'audit-email-4'),
      }),
    }),
  },
  {
    step: 5, dayOffset: 8,
    build: (lead) => {
      const r = lead.report || {}
      const miss = r.aiMissing != null && r.aiTotal != null ? `${r.aiMissing} of ${r.aiTotal}` : 'the'
      return {
        subject: `You're invisible when buyers ask ChatGPT`,
        html: shell(lead, {
          title: `Buyers ask AI before they ask Google`,
          intro: `When shoppers ask ChatGPT, Gemini or Perplexity to recommend a ${r.category || 'store like yours'}, <b>${miss} AI assistants don't mention you</b> — they name your rivals. That's tomorrow's traffic going to them. We publish the content that gets you cited.`,
          ctaText: 'Get cited by AI', ctaUrl: deep(lead, '/mission/geo', 'audit-email-5'),
        }),
      }
    },
  },
  {
    step: 6, dayOffset: 12,
    build: (lead) => ({
      subject: `How stores like ${lead.brand_name || 'yours'} add revenue without more ad spend`,
      html: shell(lead, {
        title: `Same traffic, more sales`,
        intro: `The fastest revenue isn't more ad spend — it's plugging the leaks you already have and running ads built on what's proven to work. That's exactly what your audit mapped. One AI marketing team, working every night, you approve every move.`,
        ctaText: 'Put the team to work', ctaUrl: deep(lead, '/mission', 'audit-email-6'),
      }),
    }),
  },
  {
    step: 7, dayOffset: 18,
    build: (lead) => ({
      subject: `Your ${lead.brand_name || 'store'} report is about to expire`,
      html: shell(lead, {
        title: `Don't lose your report + ads`,
        intro: `Your audit, the revenue math, and the ads we made you are saved — for now. Claim your free account to keep them and start fixing what's costing you sales. Takes about a minute.`,
        imageUrl: (lead.ad_urls || [])[0] || undefined,
        ctaText: 'Save my report', ctaUrl: deep(lead, '/mission/seo', 'audit-email-7'),
      }),
    }),
  },
  {
    step: 8, dayOffset: 30,
    build: (lead) => ({
      subject: `Should we close your file?`,
      html: shell(lead, {
        title: `Last one from us`,
        intro: `We won't keep emailing. But your store still has the leaks we found — and your rivals are still running the ads you're not. If you want the team that fixes it, now's the moment: founding members lock in the lowest price we'll ever offer. Otherwise, all the best — the audit's yours to keep.`,
        ctaText: 'Start as a founding member', ctaUrl: deep(lead, '/pricing', 'audit-email-8'),
      }),
    }),
  },
]

export function buildAuditEmail(step: number, lead: AuditLead): { subject: string; html: string } | null {
  const s = AUDIT_SEQUENCE.find((x) => x.step === step)
  return s ? s.build(lead) : null
}
