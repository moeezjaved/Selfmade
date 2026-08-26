/**
 * CRO Audit (v1) — find the conversion leaks on a store's homepage + product page, and frame each as
 * money left on the table (the CVR lever of Revenue = Traffic × CVR × AOV).
 *
 * Two layers:
 *   1) RULES  — deterministic checks on the fetched HTML (reviews, ATC, express-pay, shipping, images,
 *      urgency, social proof, H1/CTA, viewport…). Cheap, provable, no LLM.
 *   2) REVIEW — one gpt-4o pass over the visible copy/structure for the judgment calls a regex can't make
 *      (offer clarity in 5s, visual hierarchy, trust density, CTA prominence, copy quality).
 *
 * Returns a score + findings shaped like the SEO audit so the UI/report can render it the same way.
 * Honest-data rule: we only flag what we can actually observe; unknowns are omitted, never faked.
 */
import { llm } from '@/lib/llm'
import { crawlStore } from '@/lib/ads-studio/store'
import { critiqueScreens } from '@/lib/gemini/vision'

export type CroSeverity = 'high' | 'medium' | 'low'
export type CroFinding = { area: 'product' | 'home' | 'global'; severity: CroSeverity; title: string; detail: string; impact?: string; source: 'rule' | 'ai' | 'vision' }
export type CroAudit = { hasData: boolean; site?: string; domain?: string; score?: number; productUrl?: string | null; findings?: CroFinding[]; note?: string; scannedAt?: string }

async function fetchHtml(url: string): Promise<string> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; SelfmadeCRO/1.0)' } })
    clearTimeout(t)
    if (!r.ok) return ''
    return (await r.text()).slice(0, 400_000)
  } catch { return '' }
}

// Visible-ish text: strip scripts/styles/tags → for the LLM review + some rules.
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const has = (html: string, re: RegExp) => re.test(html)
const IMPACT = {
  reviews: 'Stores that surface reviews on the PDP typically convert 5–15% better — social proof is the #1 objection-killer.',
  express: 'Express checkout / BNPL (Shop Pay, Apple Pay, Klarna) can lift PDP conversion 5–10% by cutting checkout friction.',
  shipping: 'Showing shipping & returns near the buy button removes the top pre-purchase anxiety — often a few % of lost carts.',
  images: 'More product images/angles (and a video) is one of the strongest PDP conversion levers.',
  urgency: 'Honest urgency/stock cues nudge fence-sitters — small but real CVR lift.',
  h1: 'A clear 5-second value prop above the fold is the biggest driver of bounce vs engage.',
  cta: 'One obvious primary CTA above the fold directs traffic to the action — scattered/weak CTAs leak clicks.',
  social: 'Homepage social proof (press, customer count, ratings) builds trust before the buyer even reaches a product.',
  viewport: 'Without a mobile viewport tag the store renders poorly on phones — where most DTC traffic is.',
} as const

/** Layer 1 — deterministic rule checks on the product + home HTML. */
function ruleFindings(homeHtml: string, prodHtml: string, hasProduct: boolean): CroFinding[] {
  const f: CroFinding[] = []
  const H = homeHtml.toLowerCase()
  const P = prodHtml.toLowerCase()

  // ── Product page ──
  if (hasProduct) {
    // Reviews must be a real WIDGET or a rating/count — not just the word "review" in a footer link.
    if (!has(P, /judge\.me|yotpo|loox|okendo|stamped|reviews\.io|trustpilot|\d[\d,]*\s*reviews?\b|\d(?:\.\d)?\s*(?:out of|\/)\s*5|★{3,}|rated\s*\d/)) f.push({ area: 'product', severity: 'high', title: 'No product reviews or ratings visible', detail: 'No review widget, star rating, or review count detected on the product page. Shoppers look for proof before buying.', impact: IMPACT.reviews, source: 'rule' })
    if (!has(P, /shop pay|apple pay|google pay|klarna|afterpay|clearpay|paypal|amazon pay/)) f.push({ area: 'product', severity: 'medium', title: 'No express checkout / BNPL badges', detail: 'No Shop Pay, Apple Pay, Klarna or similar detected near checkout — one-tap pay and “pay later” reduce friction.', impact: IMPACT.express, source: 'rule' })
    // Require a concrete shipping/returns CLAIM, not just the word appearing somewhere in the page.
    if (!has(P, /free shipping|free returns|money[- ]?back|satisfaction guarantee|\d+[- ]?day (?:returns?|refunds?|guarantee|money)|ships? (?:in|within|free)|delivery (?:in|within)|easy returns/)) f.push({ area: 'product', severity: 'medium', title: 'Shipping & returns not stated on the page', detail: 'No concrete shipping, returns, or guarantee promise detected near the buy button — the top pre-purchase question.', impact: IMPACT.shipping, source: 'rule' })
    const imgCount = (prodHtml.match(/<img[^>]+(?:cdn\/shop|\/products\/|product)[^>]*>/gi) || []).length
    const hasVideo = has(P, /<video|youtube\.com|youtu\.be|vimeo|\.mp4|product.*video/)
    if (imgCount < 3 && !hasVideo) f.push({ area: 'product', severity: 'medium', title: 'Thin product media (few images, no video)', detail: `Detected ${imgCount} product image${imgCount === 1 ? '' : 's'} and no video. Multiple angles + a short video meaningfully lift PDP conversion.`, impact: IMPACT.images, source: 'rule' })
    if (!has(P, /in stock|low stock|only \d+ left|selling fast|almost gone|hurry|limited|\d+ (people|sold)/)) f.push({ area: 'product', severity: 'low', title: 'No stock/urgency cue', detail: 'No honest scarcity or stock signal (e.g. “Only 4 left”, “Selling fast”). Used well, this nudges fence-sitters.', impact: IMPACT.urgency, source: 'rule' })
  }

  // ── Homepage ──
  if (!has(homeHtml, /<h1[^>]*>[^<]{3,}/i)) f.push({ area: 'home', severity: 'high', title: 'No clear value proposition above the fold', detail: 'No prominent H1 headline found. Visitors should understand what you sell and why in 5 seconds.', impact: IMPACT.h1, source: 'rule' })
  if (!has(H, /shop now|shop all|buy now|get \d+%|start|browse|explore|order/)) f.push({ area: 'home', severity: 'medium', title: 'Weak / missing primary CTA', detail: 'No obvious primary call-to-action detected on the homepage. Give traffic one clear next step.', impact: IMPACT.cta, source: 'rule' })
  // Social proof must be a real claim/number, not just the word "review" somewhere on the page.
  if (!has(H, /\d[\d,]*\+?\s*(?:happy )?(?:customers|orders|reviews|sold|five[- ]star)|as seen (?:in|on)|featured in|trusted by|\d(?:\.\d)?\s*(?:out of|\/)\s*5|★{3,}|verified (?:buyer|purchase)|\d[\d,]*\s*reviews?/)) f.push({ area: 'home', severity: 'medium', title: 'No social proof on the homepage', detail: 'No customer count, rating, press mention or testimonial detected. Trust signals lift the whole funnel.', impact: IMPACT.social, source: 'rule' })

  // ── Global ──
  if (!has(homeHtml, /<meta[^>]+name=["']viewport["']/i)) f.push({ area: 'global', severity: 'medium', title: 'No mobile viewport tag', detail: 'The page is missing a responsive viewport meta tag — it may render poorly on phones, where most DTC traffic is.', impact: IMPACT.viewport, source: 'rule' })

  return f
}

/** Layer 2 — one LLM pass for the judgment calls rules can't make. */
async function reviewFindings(site: string, homeText: string, prodText: string): Promise<CroFinding[]> {
  const prompt = `You are a senior DTC conversion-rate-optimization (CRO) expert reviewing an online store. Below is the VISIBLE text of the homepage and a product page. Judge ONLY what the text supports — do not invent design details you can't infer.

STORE: ${site}
HOMEPAGE TEXT (truncated):
${homeText.slice(0, 3500)}

PRODUCT PAGE TEXT (truncated):
${prodText.slice(0, 3500)}

Give 3–6 of the highest-impact CRO problems a conversion expert would flag — focus on: clarity of the offer in the first 5 seconds, message/benefit vs feature copy, objection handling, trust, and how compelling the product description is. Be specific to THIS store (quote or reference their actual wording). Each finding: area ("home"|"product"|"global"), severity ("high"|"medium"|"low"), a short title, a concrete detail, and a one-line "impact" on conversion (a conservative, clearly-estimated range — never a fake precise number).
Return ONLY JSON: {"findings":[{"area":"...","severity":"...","title":"...","detail":"...","impact":"..."}]}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1400, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
    const txt = res?.content?.[0]?.text || res?.choices?.[0]?.message?.content || ''
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    const arr = Array.isArray(j?.findings) ? j.findings : []
    return arr.slice(0, 6).map((x: any): CroFinding => ({
      area: (['home', 'product', 'global'].includes(x.area) ? x.area : 'home'),
      severity: (['high', 'medium', 'low'].includes(x.severity) ? x.severity : 'medium'),
      title: String(x.title || '').slice(0, 120),
      detail: String(x.detail || '').slice(0, 400),
      impact: x.impact ? String(x.impact).slice(0, 200) : undefined,
      source: 'ai',
    })).filter((x: CroFinding) => x.title)
  } catch { return [] }
}

// The vision rubric — the model gets the RENDERED screenshots (desktop + mobile, above the fold) and
// judges what only the eye can: 5-second clarity, CTA prominence, hierarchy/clutter, visible trust,
// PDP essentials, and mobile. It must reference what it actually sees and never invent.
const CRO_VISION_PROMPT = `You are a senior DTC conversion-rate-optimization expert. You are shown the ABOVE-THE-FOLD screenshots of an online store's homepage — desktop and mobile. Critique ONLY what you can actually see; never invent details.

Judge, in priority order:
1. 5-SECOND CLARITY: can a first-time visitor tell what's sold and who it's for within 5 seconds? Is the headline a real benefit or just a vague slogan? Is the product visible?
2. CTA PROMINENCE: is there ONE obvious primary button above the fold, high-contrast and clearly clickable — or does it blend in / compete with other buttons?
3. HIERARCHY & CLUTTER: does the eye land on product + CTA, or is it noisy/cramped? Enough whitespace? Any popup or banner blocking the view?
4. VISIBLE TRUST: star ratings, a review count, payment/security badges, guarantees, press logos, real photos vs generic stock. Does it LOOK premium/legit or cheap/templated?
5. MOBILE (the mobile shot): legible without zoom, tappable, hero not cut off, no full-screen popup on load, sticky add-to-cart if visible.
6. DESIGN QUALITY: overall — does it read as a premium brand, a generic template, or low-trust?

Return 3–6 of the HIGHEST-IMPACT problems, specific to THIS store (reference what you see, e.g. "the hero is dark and the 'Shop' button blends into it"). Each: area ("home"|"product"|"global"), severity ("high"|"medium"|"low"), a short title, a concrete detail, and a one-line "impact" on conversion (a conservative, clearly-estimated range — never a fake precise number).
Return ONLY JSON: {"findings":[{"area":"...","severity":"...","title":"...","detail":"...","impact":"..."}]}`

/** Layer 3 — VISION: screenshot the store (via the droplet) and let a vision model critique the design. */
async function visionFindings(domain: string): Promise<CroFinding[]> {
  const base = process.env.DROPLET_PREVIEW_URL, secret = process.env.PREVIEW_SECRET
  if (!base || !secret) return []
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/screenshot?url=${encodeURIComponent('https://' + domain + '/')}`, { headers: { 'X-Preview-Secret': secret }, signal: AbortSignal.timeout(70_000) })
    if (!r.ok) return []
    const shots = await r.json() as { desktop?: string | null; mobile?: string | null }
    if (!shots.desktop && !shots.mobile) return []
    const txt = await critiqueScreens(shots, CRO_VISION_PROMPT)
    if (!txt) return []
    const clean = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))
    const arr = Array.isArray(j?.findings) ? j.findings : []
    return arr.slice(0, 6).map((x: any): CroFinding => ({
      area: (['home', 'product', 'global'].includes(x.area) ? x.area : 'home'),
      severity: (['high', 'medium', 'low'].includes(x.severity) ? x.severity : 'medium'),
      title: String(x.title || '').slice(0, 120),
      detail: String(x.detail || '').slice(0, 400),
      impact: x.impact ? String(x.impact).slice(0, 200) : undefined,
      source: 'vision',
    })).filter((x: CroFinding) => x.title)
  } catch { return [] }
}

const WEIGHT: Record<CroSeverity, number> = { high: 12, medium: 7, low: 3 }

export async function runCroAudit(domain0: string): Promise<CroAudit> {
  const domain = (domain0 || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!domain || !domain.includes('.')) return { hasData: false, note: 'No valid store domain.' }

  // Discover a product page via the store crawler, and fetch the raw HTML we need for the rules.
  const [home, ctx] = await Promise.all([fetchHtml(`https://${domain}/`), crawlStore(domain).catch(() => null)])
  const productUrl = ctx?.products?.[0]?.url || null
  const prod = productUrl ? await fetchHtml(productUrl) : ''
  const site = ctx?.siteName || domain

  if (!home && !prod) return { hasData: false, domain, note: 'Couldn’t read the store — check the URL is public.' }

  const rules = ruleFindings(home, prod, !!prod)
  // Text review + vision critique run in parallel; vision is best-effort (needs the droplet + screenshot).
  const [ai, vision] = await Promise.all([
    reviewFindings(site, visibleText(home), visibleText(prod)),
    visionFindings(domain).catch(() => [] as CroFinding[]),
  ])

  // Merge, de-dupe near-identical titles. Order: rules (provable) → vision (design) → ai (copy).
  const seen = new Set<string>()
  const findings: CroFinding[] = []
  for (const f of [...rules, ...vision, ...ai]) {
    const key = f.title.toLowerCase().replace(/[^a-z]/g, '').slice(0, 22)
    if (seen.has(key)) continue
    seen.add(key); findings.push(f)
  }
  const order: CroSeverity[] = ['high', 'medium', 'low']
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))

  const penalty = findings.reduce((s, f) => s + WEIGHT[f.severity], 0)
  const score = Math.max(20, 100 - penalty)

  return { hasData: findings.length > 0, site, domain, score, productUrl, findings, scannedAt: new Date().toISOString() }
}
