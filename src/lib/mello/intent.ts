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
export function productHowTo(q: string): string | null {
  const t = q.toLowerCase()
  const asksHow = /\b(how|where|can i|help me|guide|steps?|set ?up|connect|link|add|enable|turn on|upgrade)\b/.test(t) || t.includes('?')
  if (!asksHow) return null
  if (/\b(meta|facebook)\b/.test(t) && /\b(connect|link|ad account|account|integrat)/.test(t))
    return `Connecting Meta is a Creator (paid) feature — you don't need it to use me, everything already runs off the crawled ad library. To turn it on: open Billing and upgrade to Creator, then on the brief's “Run your ads on Meta” card hit Connect and either partner-share your ad account (60 seconds in Meta Business Settings) or paste a System-User token. After that I audit your account every morning.`
  if (/\bwhatsapp\b/.test(t) && /\b(connect|link|set ?up|brief|qr)/.test(t))
    return `Go to Settings → “Mello on Slack & WhatsApp” → Connect WhatsApp, then scan the QR code with your phone (WhatsApp → Linked Devices, just like WhatsApp Web). Once it's linked I'll send your morning brief there and you can reply YES to approve my work.`
  if (/\bslack\b/.test(t) && /\b(connect|add|set ?up|brief)/.test(t))
    return `Settings → “Add to Slack” — approve me and pick a channel. You'll get the brief with one-tap Approve buttons right in Slack.`
  if (/\b(competitor|rival|spy|watch)\b/.test(t) && /\b(add|watch|track|spy|how)/.test(t))
    return `On the brief hit “+ Add a competitor” (or “Spy on a competitor”). Search their name, or paste their Meta Ad Library link — I start pulling every ad they run right away. Free tracks 1; upgrade to watch more.`
  if (/\b(upgrade|plan|pricing|subscri|paid|creator)\b/.test(t))
    return `Tap “Go full-time / Hire Mello full-time” on the brief, or open Billing — it's $49/mo and unlocks tracking all your competitors, connecting Meta, and the full daily work.`
  if (/\b(make|create|generate|design)\b/.test(t) && /\b(ad|creative|video|image|ugc)\b/.test(t))
    return `Hit Create (the + on the left rail) or “Make one like this” on the brief. Pick a rival ad to clone, or let me design a fresh one from your product photos — I'll write the script and hooks.`
  return null
}

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
