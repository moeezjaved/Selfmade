/**
 * Mello's ONE intent router. Every surface (/brief, /mello, Slack, WhatsApp) classifies a founder's
 * message through this single function BEFORE any answer is produced, so routing is identical everywhere
 * and — critically — so we only inject the context an intent actually needs. The old bug ("how do I
 * connect Meta" → competitor waffle about Sterone) happened because the generic agent got the watched-
 * competitor block on EVERY turn. Intent gates that: PRODUCT_HELP never sees competitor context.
 *
 * Deterministic (regex/keyword, no LLM) so it's instant and can't hang. When a message is genuinely
 * ambiguous it falls to GENERAL, which is the safe default (the agent, with brand-scoped context).
 */
import { isAdsQuestion } from '@/lib/meta/answer'
import type { MelloStateLite } from '@/lib/mello/context'

// An offer/competitor COMPARISON ("compare my offer vs competitors", "how do I stack up against rivals")
// is analysis, NOT product how-to — it must route to the competitor pipeline, never the pricing upsell.
// This is the guard that stopped bug #3: "compare my offer (pricing, guarantee, bundle, shipping) against
// competitors" used to hit the "$49/mo … upgrade" branch purely because it contained the word "pricing".
const COMPARE = /\b(compare|comparison|versus|vs\.?|against|benchmark|stack\s*(?:up|against)|how do (?:i|we) (?:compare|stack))\b/i
const COMPARE_SUBJECT = /\b(competitor|competitors|rival|rivals|their|our offer|my offer|offer|pricing|price|bundle|guarantee|shipping|market)\b/i
const isOfferComparison = (t: string) => COMPARE.test(t) && COMPARE_SUBJECT.test(t)

export type MelloIntent =
  | 'product_help'    // "how do I add a competitor / connect Meta / upgrade" — in-app instructions
  | 'ads_metric'      // "how are my ads / spend / ROAS / sales" — authoritative Meta audit numbers
  | 'competitor'      // "what did NovaMane launch", "who am I watching" — crawled competitor library
  | 'company_memory'  // "what do you know about our brand", "why did we…", teaching a rule
  | 'creative'        // "make me 3 hooks / an ad / a UGC video"
  | 'general'         // everything else → the agent (brand-scoped context)

/**
 * Product how-to — real, first-person answers so Mello GUIDES the founder through the app ("how do I
 * connect Meta / WhatsApp / add a competitor / upgrade") instead of the marketing agent improvising.
 * This is a deterministic product-help knowledge layer: it NEVER touches competitor/company data, so a
 * how-to question can never leak an unrelated competitor. Returns null when it isn't a product-help ask.
 */
export function productHowTo(q: string, state?: MelloStateLite): string | null {
  const t = q.toLowerCase()
  // An offer/competitor comparison is analysis, not how-to — never answer it here (it belongs to the
  // competitor pipeline). Guard FIRST so "compare my pricing vs competitors" can't hit the upsell below.
  if (isOfferComparison(t)) return null
  // Plan / subscription STATUS ("what plan am I on", "my current plan") — deterministic, read from state
  // (bug #4: a Creator was told "you're on the Free plan"). Must precede the generic upgrade branch so a
  // status question never gets a sales pitch. Excludes cancel/upgrade/change (those are real how-tos).
  if (/\b(plan|tier|subscription|package)\b/.test(t) && /\b(what|which|current|my|status|am i (?:on|paying)|do i have)\b/.test(t) && !/\b(cancel|upgrade|change|switch|downgrade|connect)\b/.test(t)) {
    if (state?.plan) {
      return state.plan.isPaid
        ? `You're on the ${state.plan.label} plan — the full plan: Meta, all your competitors, and the daily work are all unlocked.`
        : `You're on the Free plan — image ads to try me out. Creator ($49/mo) unlocks connecting Meta, watching up to 15 competitors, and the full daily work.`
    }
    return `Let me pull your current plan.` // routing probe (no state yet) → classified as product_help, answered with state on the real pass
  }
  const asksHow = /\b(how|where|can i|help me|guide|steps?|set ?up|connect|link|add|enable|turn on|upgrade|cancel|stop|unsubscribe|downgrade|download|save|export)\b/.test(t) || t.includes('?')
  if (!asksHow) return null
  if (/\b(meta|facebook)\b/.test(t) && /\b(connect|link|ad account|account|integrat)/.test(t)) {
    // STATE-AWARE (Phase 2.2): read actual connection + plan, never assume not-connected or paid-gated.
    if (state?.meta?.connected)
      return `Your Meta ad account${state.meta.accountName ? ` (${state.meta.accountName})` : ''} is already connected — I audit it every morning and flag exactly what to scale or pause. Want your latest numbers, or to connect another account for a different brand? (You can manage accounts in Settings → Connect Meta.)`
    if (state?.plan?.isPaid)
      return `You're on ${state.plan.label}, so Meta's included — nothing to upgrade. Connect it in Settings → Connect Meta (or open /connect/meta): either partner-share your ad account (add Selfmade's Business ID in Meta Business Settings and tick the account — ~60 seconds) or paste a System-User token. The moment it's linked I start auditing it every morning.`
    return `Connecting Meta is on the Creator plan ($49/mo) — you don't need it to use me, everything already runs off the crawled ad library. To turn it on: open Billing → upgrade to Creator, then Settings → Connect Meta and either partner-share your ad account (~60 seconds in Meta Business Settings) or paste a System-User token. After that I audit your account every morning.`
  }
  if (/\bwhatsapp\b/.test(t) && /\b(connect|link|set ?up|brief|qr)/.test(t)) {
    if (state && (state as any)?.whatsapp?.connected) return `WhatsApp is already connected — I send your morning brief there and you can reply YES to approve my work. Want me to send a test?`
    return `Go to Settings → “Mello on Slack & WhatsApp” → Connect WhatsApp, then scan the QR code with your phone (WhatsApp → Linked Devices, just like WhatsApp Web). Once it's linked I'll send your morning brief there and you can reply YES to approve my work.`
  }
  if (/\bslack\b/.test(t) && /\b(connect|add|set ?up|brief)/.test(t))
    return `Settings → “Add to Slack” — approve me and pick a channel. You'll get the brief with one-tap Approve buttons right in Slack.`
  if (/\b(competitor|rival|spy|watch)\b/.test(t) && /\b(add|watch|track|spy|how)/.test(t)) {
    const cap = state?.plan ? (state.plan.isPaid ? '' : ` Free tracks 1 competitor; Creator ($49/mo) watches 15.`) : ` Free tracks 1; upgrade to watch more.`
    return `On the brief hit “+ Add a competitor” (or “Spy on a competitor”). Search their name, or paste their Meta Ad Library link — I start pulling every ad they run right away.${cap}`
  }
  // Cancel must come BEFORE upgrade (both mention "subscription").
  if (/\b(cancel|stop|end|unsubscribe|downgrade)\b/.test(t) && /\b(subscri|plan|billing|membership|account|renew|mello)/.test(t))
    return `Open Billing → “Cancel subscription”. You keep everything until the end of the current period — nothing's charged after that, and you can reactivate any time from the same page.`
  if (/\b(download|save|export)\b/.test(t) && /\b(video|ad|image|creative|clip|generat)/.test(t))
    return `Open the ad in Studio → “My Work” (My Creatives), open it, and hit Download — images save straight to your device, videos download as an .mp4.`
  if (/\b(upgrade|plan|pricing|subscri|paid|creator)\b/.test(t)) {
    // STATE-AWARE: never pitch the plan a paying user already owns.
    if (state?.plan?.isPaid)
      return `You're already on ${state.plan.label} — the full plan, everything's unlocked (Meta, all competitors, the daily work). You can manage or cancel any time in Billing.`
    return `Tap “Go full-time / Hire Mello full-time” on the brief, or open Billing — it's $49/mo (Creator) and unlocks tracking all your competitors, connecting Meta, and the full daily work.`
  }
  if (/\b(make|create|generate|design)\b/.test(t) && /\b(ad|creative|video|image|ugc)\b/.test(t))
    return `Hit Create (the + on the left rail) or “Make one like this” on the brief. Pick a rival ad to clone, or let me design a fresh one from your product photos — I'll write the script and hooks.`
  return null
}

// Routing detector — must stay STATE-FREE (deterministic classification only; the state-aware answer is
// produced separately by passing state into productHowTo).
export const isProductHelp = (q: string): boolean => productHowTo(q) !== null

// A creative-generation ASK ("make me 3 hooks", "write a UGC script", "design an ad").
const CREATIVE = /\b(make|create|generate|write|design|draft|come up with|give me)\b[^?]*\b(ad|ads|creative|hook|hooks|script|caption|headline|copy|ugc|variation|concept|angle)s?\b/i
// STRONG competitor signal — an explicit competitor noun. Checked BEFORE the ads-metric detector so a
// question naming rivals isn't misread as an own-account metric question.
const STRONG_COMPETITOR = /\b(competitor|competitors|rival|rivals|spy|spying|watch(?:ing|list)?|ad library|their ads?)\b/i
// A launch/teardown question about someone ELSE ("what did NovaMane launch this week") — competitor,
// as long as it isn't about the founder's OWN activity (we/our/my/I).
const LAUNCH = /\blaunch(?:ed|ing|es)?\b/i
const OWN_REF = /\b(we|our|my|i|us)\b/i
// Weak competitor signal (kept after the ads check).
const COMPETITOR = STRONG_COMPETITOR
const WATCH_Q = /\bwho\s+(?:am|are)\s+i\s+watch|who\s+do\s+i\s+watch|my\s+(?:competitors|rivals|brands)\b/i
// A company-knowledge / memory / teaching statement.
const TEACH = /^(never|always|from now on|don'?t|do not|only|we (?:never|always|only)|make sure|remember (?:to|that)|keep in mind|by default)\b/i
const COMPANY_Q = /\b(what do you (?:know|remember)|our (?:brand|positioning|voice|audience|customers?|strategy|mission)|why did we|what did we (?:decide|learn|try)|about (?:our|my) (?:brand|business|company))\b/i

/** The single routing decision. Order = priority; product-help wins so it can never be polluted. */
export function classifyIntent(message: string, opts?: { hasItem?: boolean }): MelloIntent {
  const q = String(message || '').trim()
  if (!q) return 'general'
  // A brief item reaction ("why this?") is always general reasoning about that item, never product-help.
  if (!opts?.hasItem && isProductHelp(q)) return 'product_help'
  // Competitor questions win over the ads-metric detector when they clearly name a rival's activity —
  // otherwise "what did NovaMane launch this week" gets caught by "this week" and misread as own metrics.
  if (WATCH_Q.test(q) || STRONG_COMPETITOR.test(q)) return 'competitor'
  if (LAUNCH.test(q) && !OWN_REF.test(q)) return 'competitor'
  if (isAdsQuestion(q)) return 'ads_metric'
  if (COMPETITOR.test(q)) return 'competitor'
  if (CREATIVE.test(q)) return 'creative'
  if ((TEACH.test(q) && !q.includes('?')) || COMPANY_Q.test(q)) return 'company_memory'
  return 'general'
}

/** Which intents legitimately need the watched-competitor / business block injected into the agent
 *  prompt. PRODUCT_HELP and pure ADS_METRIC never do — that's what stopped the competitor leak. */
export function intentNeedsCompetitorContext(intent: MelloIntent): boolean {
  return intent === 'competitor' || intent === 'creative' || intent === 'general'
}
