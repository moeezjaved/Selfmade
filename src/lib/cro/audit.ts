/**
 * CRO Audit (v2) — a FORENSIC conversion audit, not a checklist. It reads the store's rendered homepage +
 * product page (screenshots via the droplet) PLUS the page content, feeds a world-class-CRO-expert prompt,
 * and returns a structured report: score, the 5 biggest leaks, the 5 highest-impact changes, the exact new
 * homepage structure, exact PDP changes, 5 ranked A/B tests, and the single first move.
 *
 * Ground truth: a cheap rules pass detects hard signals (reviews widget, express-pay, shipping claim,
 * media count…) and hands them to the model as facts so it never hallucinates what's present.
 * Vision when the droplet is available; graceful text-only fallback otherwise.
 */
import { llm } from '@/lib/llm'
import { crawlStore } from '@/lib/ads-studio/store'
import { uploadBufferToR2 } from '@/lib/r2'
import OpenAI from 'openai'

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

/** gpt-4o VISION — actually looks at the screenshots (reliable, JSON mode). This is the primary analyzer:
 *  it prevents the "missing H1 / no CTA" hallucinations that happen when the model can't see the page. */
async function visionCritique(shots: Shot[], prompt: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return ''
  try {
    const content: any[] = [{ type: 'text', text: prompt }]
    for (const s of shots) if (s.b64) {
      content.push({ type: 'text', text: s.label })
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${s.b64}`, detail: 'high' } })
    }
    const res = await oai().chat.completions.create({
      model: 'gpt-4o', max_tokens: 3600, temperature: 0.15,   // low temp → stable evidence run-to-run
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    })
    return res.choices?.[0]?.message?.content || ''
  } catch { return '' }
}

export type CroRegion = { x: number; y: number; w: number; h: number }   // percent of the screenshot (0-100)
export type CroSeverity = 'critical' | 'high' | 'medium'
export type CroLeak = { title: string; why: string; fix: string; screen?: 'home' | 'pdp'; region?: CroRegion; severity?: CroSeverity; evidence?: string }
export type CroChange = { title: string; detail: string; impact: string }
export type CroHomeSection = { section: string; why: string; content?: string }
export type CroPdpChange = { change: string; why: string }
export type CroAbTest = { name: string; hypothesis: string; impact: string }
export type CroShot = { key: string; label: string; url: string }   // key: home-desktop | home-mobile | pdp-desktop | pdp-mobile
export type CroLens = { score: number; take: string; findings: string[]; screen?: 'home' | 'pdp' }   // one expert's own view + the screen they're mainly judging
export type CroPanel = { designer: CroLens; psychologist: CroLens; copywriter: CroLens; cro: CroLens; customer: string }
// Stage-1 visual evidence (what the eyes SEE — no conclusions). Each leak in stage 2 must cite these.
export type CroEvidenceItem = { id: string; element: string; page: 'home' | 'pdp'; observation: string; prominence?: number; confidence: number }
export type CroReport = {
  hasData: boolean
  domain?: string; site?: string; productUrl?: string | null
  score?: number; verdict?: string
  leaks?: CroLeak[]; changes?: CroChange[]; homepage?: CroHomeSection[]; productPage?: CroPdpChange[]; abtests?: CroAbTest[]; firstChange?: string
  shots?: CroShot[]; panel?: CroPanel; issueCount?: number; criticalCount?: number
  usedVision?: boolean; scannedAt?: string; note?: string
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000)
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; SelfmadeCRO/1.0)' } })
    clearTimeout(t); return r.ok ? (await r.text()).slice(0, 400_000) : ''
  } catch { return '' }
}
function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}
const has = (s: string, re: RegExp) => re.test(s)

/** Hard signals we can prove from the HTML — handed to the model as ground truth. */
function ruleFacts(home: string, prod: string, hasProduct: boolean): string {
  const H = home.toLowerCase(), P = prod.toLowerCase()
  const yn = (b: boolean) => (b ? 'YES' : 'NO')
  const imgCount = (prod.match(/<img[^>]+(?:cdn\/shop|\/products\/|product)[^>]*>/gi) || []).length
  const lines = [
    `homepage H1/value-prop present: ${yn(has(home, /<h1[^>]*>[^<]{3,}/i))}`,
    `homepage mobile viewport tag: ${yn(has(home, /<meta[^>]+name=["']viewport["']/i))}`,
    `homepage social-proof number/rating: ${yn(has(H, /\d[\d,]*\+?\s*(?:happy )?(?:customers|orders|reviews|sold)|as seen (?:in|on)|featured in|trusted by|\d(?:\.\d)?\s*(?:out of|\/)\s*5|verified (?:buyer|purchase)/))}`,
  ]
  if (hasProduct) lines.push(
    `product reviews widget/rating/count: ${yn(has(P, /judge\.me|yotpo|loox|okendo|stamped|reviews\.io|trustpilot|\d[\d,]*\s*reviews?\b|\d(?:\.\d)?\s*(?:out of|\/)\s*5|rated\s*\d/))}`,
    `express checkout / BNPL (Shop Pay/Apple Pay/Klarna): ${yn(has(P, /shop pay|apple pay|google pay|klarna|afterpay|clearpay|amazon pay/))}`,
    `shipping/returns/guarantee claim: ${yn(has(P, /free shipping|free returns|money[- ]?back|satisfaction guarantee|\d+[- ]?day (?:returns?|refunds?|guarantee)|ships? (?:in|within|free)|delivery (?:in|within)/))}`,
    `product images detected: ${imgCount}`,
    `product video: ${yn(has(P, /<video|youtube|youtu\.be|vimeo|\.mp4/))}`,
    `urgency/scarcity cue: ${yn(has(P, /low stock|only \d+ left|selling fast|almost gone|\d+ (?:people|sold)/))}`,
  )
  return lines.join('\n')
}

type Shot = { key: string; label: string; b64: string; page: 'home' | 'pdp'; device: 'desktop' | 'mobile'; section: number }

/** Capture the FULL page sliced into sections (desktop + mobile) for home + PDP, so the evidence pass can
 *  map the whole journey — not just above the fold. Section 0 is above-the-fold. Bounded for cost. */
async function screenshots(domain: string, productUrl: string | null): Promise<Shot[]> {
  const base = process.env.DROPLET_PREVIEW_URL, secret = process.env.PREVIEW_SECRET
  if (!base || !secret) return []
  const grab = async (u: string, tag: string, page: 'home' | 'pdp'): Promise<Shot[]> => {
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/screenshot?sections=1&url=${encodeURIComponent(u)}`, { headers: { 'X-Preview-Secret': secret }, signal: AbortSignal.timeout(90_000) })
      if (!r.ok) return []
      const s = await r.json() as { desktop?: string[]; mobile?: string[] }
      const out: Shot[] = []
      // Desktop: up to 4 sections (the journey). Mobile: above-the-fold only (keeps image count/cost sane).
      ;(s.desktop || []).slice(0, 4).forEach((b64, i) => { if (b64) out.push({ key: `${page}-desktop-${i}`, label: `${tag} — DESKTOP · section ${i + 1}${i === 0 ? ' (above the fold)' : ''}:`, b64, page, device: 'desktop', section: i }) })
      ;(s.mobile || []).slice(0, 1).forEach((b64, i) => { if (b64) out.push({ key: `${page}-mobile-${i}`, label: `${tag} — MOBILE (above the fold):`, b64, page, device: 'mobile', section: i }) })
      return out
    } catch { return [] }
  }
  const [home, pdp] = await Promise.all([grab(`https://${domain}/`, 'HOMEPAGE', 'home'), productUrl ? grab(productUrl, 'PRODUCT PAGE', 'pdp') : Promise.resolve([])])
  return [...home, ...pdp]
}

/** Upload the captured screenshots to R2 so the report can render the REAL store, and return their URLs.
 *  Section 0 is published under the LEGACY key (home-desktop / pdp-mobile …) the teardown UI reads; deeper
 *  sections keep their full key (home-desktop-1 …) for the journey map. */
async function persistShots(domain: string, shots: Shot[]): Promise<CroShot[]> {
  const slug = domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out: CroShot[] = []
  for (const s of shots) {
    try {
      const publicKey = s.section === 0 ? `${s.page}-${s.device}` : s.key
      const buf = Buffer.from(s.b64, 'base64')
      const url = await uploadBufferToR2(buf, `cro/${slug}/${publicKey}-${buf.length}.jpg`, 'image/jpeg')
      if (url) out.push({ key: publicKey, label: s.label, url })
    } catch { /* skip a shot that won't upload */ }
  }
  return out
}

function parseReport(txt: string, validEvidence?: Set<string>): Partial<CroReport> | null {
  if (!txt) return null
  try {
    const clean = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))
    const arr = (v: any) => (Array.isArray(v) ? v : [])
    const str = (v: any, n = 400) => String(v || '').slice(0, n)
    const clamp = (v: any) => Math.max(0, Math.min(100, Number(v)))
    const score10 = (v: any) => Math.max(0, Math.min(10, Math.round((Number(v) || 0) * 10) / 10))
    const region = (v: any): CroRegion | undefined => {
      if (!v || typeof v !== 'object') return undefined
      const x = clamp(v.x), y = clamp(v.y), w = clamp(v.w), h = clamp(v.h)
      if ([x, y, w, h].some((n) => Number.isNaN(n)) || w <= 0 || h <= 0) return undefined
      return { x, y, w, h }
    }
    const screen = (v: any): 'home' | 'pdp' | undefined => (v === 'home' || v === 'pdp' ? v : undefined)
    const sev = (v: any): CroSeverity | undefined => (['critical', 'high', 'medium'].includes(v) ? v : undefined)
    const evId = (v: any): string => Array.isArray(v) ? v.map(String).join(',') : str(v, 80)
    // Citation enforcement: when we have real visual evidence, a leak MUST cite at least one valid id —
    // this is what makes hallucinated findings structurally impossible, not just discouraged.
    const cited = (e: string): boolean => {
      if (!validEvidence || validEvidence.size === 0) return true
      return e.split(',').map((s) => s.trim()).some((id) => validEvidence.has(id))
    }
    const p = j.panel && typeof j.panel === 'object' ? j.panel : null
    // A lens may be a bare number (legacy) or a rich object {score, take, findings}. Normalize both.
    const lens = (v: any): CroLens => {
      if (v && typeof v === 'object') return { score: score10(v.score), take: str(v.take, 240), findings: (Array.isArray(v.findings) ? v.findings : []).map((f: any) => str(f, 220)).filter(Boolean).slice(0, 4), screen: screen(v.screen) }
      return { score: score10(v), take: '', findings: [] }
    }
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))),
      verdict: str(j.verdict, 240),
      panel: p ? { designer: lens(p.designer), psychologist: lens(p.psychologist), copywriter: lens(p.copywriter), cro: lens(p.cro), customer: str(p.customer, 240) } : undefined,
      leaks: arr(j.leaks).slice(0, 6)
        .map((x: any) => ({ title: str(x.title, 140), why: str(x.why), fix: str(x.fix), screen: screen(x.screen), region: region(x.region), severity: sev(x.severity), evidence: evId(x.evidence) }))
        .filter((x: CroLeak) => x.title && cited(x.evidence || ''))
        .slice(0, 5),
      changes: arr(j.changes).slice(0, 5).map((x: any) => ({ title: str(x.title, 140), detail: str(x.detail), impact: str(x.impact, 200) })).filter((x: CroChange) => x.title),
      homepage: arr(j.homepage).slice(0, 12).map((x: any) => ({ section: str(x.section, 80), why: str(x.why, 240), content: x.content ? str(x.content, 500) : undefined })).filter((x: CroHomeSection) => x.section),
      productPage: arr(j.productPage).slice(0, 12).map((x: any) => ({ change: str(x.change, 200), why: str(x.why, 300) })).filter((x: CroPdpChange) => x.change),
      abtests: arr(j.abtests).slice(0, 5).map((x: any) => ({ name: str(x.name, 140), hypothesis: str(x.hypothesis), impact: str(x.impact, 200) })).filter((x: CroAbTest) => x.name),
      firstChange: str(j.firstChange, 400),
    }
  } catch { return null }
}

function parseEvidence(txt: string): CroEvidenceItem[] {
  if (!txt) return []
  try {
    const clean = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))
    const arr = Array.isArray(j.evidence) ? j.evidence : (Array.isArray(j) ? j : [])
    const str = (v: any, n = 300) => String(v || '').slice(0, n)
    return arr.map((x: any, i: number) => ({
      id: str(x.id, 40) || `ev_${i + 1}`,
      element: str(x.element, 80),
      page: (x.page === 'pdp' ? 'pdp' : 'home') as 'home' | 'pdp',
      observation: str(x.observation, 300),
      prominence: x.prominence != null ? Math.max(0, Math.min(10, Number(x.prominence) || 0)) : undefined,
      confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)),
    })).filter((e: CroEvidenceItem) => e.observation && e.confidence >= 0.5).slice(0, 30)
  } catch { return [] }
}

/** Stage 1 prompt — the visual inspector. Sees the screenshots, reports EVIDENCE only (no conclusions). */
function evidencePrompt(facts: string): string {
  return `You are a meticulous VISUAL INSPECTOR for an ecommerce store. You are given rendered screenshots — a homepage and a product page, desktop shown top→bottom in sections, plus mobile above-the-fold. Report ONLY what you can literally SEE. Observations, never conclusions, advice, or conversion claims. NEVER invent an element; if something is present note it present, if absent note it absent.

Inspect and note:
- Above-the-fold: is there a headline? a subheadline? a primary CTA (its exact text + how prominent 1-10)? is the product visible? the price? any offer/discount? any trust signal?
- Visual hierarchy: what the eye lands on 1st/2nd/3rd, competing CTAs, clutter, dead space.
- Brand/design: typography consistency, contrast, image/photo quality, premium vs cheap/generic-template feel.
- Trust: reviews, star ratings, testimonials, customer photos, guarantees, payment badges, security, press/press logos, before/after, expert endorsements — and WHERE they sit relative to the buy button.
- Friction: too many choices, confusing variants/pricing, multiple CTAs, unclear next step, missing express checkout.
- Mobile: CTA pushed below the fold, text/buttons too small, horizontal overflow.

HTML-level hints (may be FALSE-negatives — trust your eyes over these): ${facts}

Return ONLY JSON: {"evidence":[ {"id":"ev_1","element":"e.g. Hero CTA","page":"home" or "pdp","observation":"one factual sentence describing what you SEE","prominence":<1-10, optional>,"confidence":<0-1>} ]}. Give 12-25 items. Omit anything you are less than 0.5 confident you can actually see.`
}

/** Stage 2 prompt — the CRO brain. Sees NO pixels; reasons over the evidence + text. Must cite evidence. */
function reasoningPrompt(site: string, facts: string, homeText: string, prodText: string, evidence: CroEvidenceItem[]): string {
  const grounded = evidence.length > 0
  return `You are one of the world's best ecommerce CRO experts. You are NOT looking at the store. You are given VISUAL EVIDENCE gathered by an inspector (what a person literally saw) plus the page text. Turn evidence into conclusions.

HARD RULES:
${grounded ? '- Every leak MUST set "evidence" to the id(s) of the evidence it is based on. A claim you cannot ground in the evidence or the text MUST be omitted.\n- NEVER say an element is missing if the evidence shows it present — instead critique how effective it is.' : '- No screenshots were available; reason from the text only and do NOT claim visual elements are missing unless the text clearly lacks them.'}
- Impact = leverage ("high/medium/low leverage" + one clause of reasoning). Do NOT invent exact % numbers — real lift is measured later against orders.

STORE: ${site}
${grounded ? `VISUAL EVIDENCE (the only thing "seen"):\n${JSON.stringify(evidence)}` : ''}
HTML GROUND TRUTH: ${facts}
HOMEPAGE TEXT (truncated): ${homeText.slice(0, 3000)}
PRODUCT PAGE TEXT (truncated): ${prodText.slice(0, 3000)}

Return ONLY JSON:
{
  "score": <0-100 honest>,
  "verdict": "<one brutally honest sentence>",
  "panel": {
    "designer":     {"score":<0-10>,"take":"<one-sentence verdict through a DESIGNER's lens — visual hierarchy, whitespace, typography, imagery, premium vs cheap>","findings":["<2-3 specific issues, each quoting the exact element>"],"screen":"home" or "pdp" (the page this expert is mainly judging)},
    "psychologist": {"score":<0-10>,"take":"<verdict through a buyer-PSYCHOLOGY lens — trust, objections, risk, motivation>","findings":["<2-3 specific>"],"screen":"home" or "pdp"},
    "copywriter":   {"score":<0-10>,"take":"<verdict through a COPYWRITER's lens — clarity, message, value articulation, grammar>","findings":["<2-3 specific, quoting the copy>"],"screen":"home" or "pdp"},
    "cro":          {"score":<0-10>,"take":"<verdict through a CRO lens — friction, CTA, pricing, checkout>","findings":["<2-3 specific>"],"screen":"home" or "pdp"},
    "customer":     "<one first-person sentence a real shopper on this page would think>"
  },
  "leaks": [ {"title","why (START by quoting or naming the EXACT on-page element/text this is about, e.g. \\"The line 'A powerful solution for who want...' has a grammar error\\", so the founder can find it — never a vague label)","fix","screen":"home" or "pdp","severity":"critical|high|medium"${grounded ? ',"evidence":"ev_x"' : ''}${grounded ? ',"region":{"x":0-100,"y":0-100,"w":0-100,"h":0-100} (approx box on that page\'s above-fold screenshot, omit if unsure)' : ''}} ],  // EXACTLY 5, most severe first
  "changes": [ {"title","detail","impact":"leverage + why"} ],  // 5 highest-impact
  "homepage": [ {"section","why","content":"exact copy/elements for THIS store"} ],  // new homepage structure top→bottom
  "productPage": [ {"change","why"} ],
  "abtests": [ {"name","hypothesis","impact":"leverage + why"} ],  // EXACTLY 5, highest leverage first
  "firstChange": "<the single highest-leverage change to make first>"
}`
}

export async function runCroAudit(domain0: string): Promise<CroReport> {
  const domain = (domain0 || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!domain || !domain.includes('.')) return { hasData: false, note: 'No valid store domain.' }

  const [home, ctx] = await Promise.all([fetchHtml(`https://${domain}/`), crawlStore(domain).catch(() => null)])
  const productUrl = ctx?.products?.[0]?.url || null
  const prod = productUrl ? await fetchHtml(productUrl) : ''
  const site = ctx?.siteName || domain
  if (!home && !prod) return { hasData: false, domain, note: 'Couldn’t read the store — check the URL is public.' }

  const facts = ruleFacts(home, prod, !!prod)
  const shots = await screenshots(domain, productUrl).catch(() => [] as Shot[])
  // Persist the real screenshots to R2 (in parallel with the analysis) so the report can SHOW the store.
  const shotUrlsP = persistShots(domain, shots).catch(() => [] as CroShot[])

  // ── STAGE 1 — VISION = eyes only. gpt-4o looks at the section screenshots and returns structured EVIDENCE
  //    (what it can literally see), no conclusions. This is the grounding that makes stage 2 un-hallucinatable.
  let evidence: CroEvidenceItem[] = []
  if (shots.length) {
    const evRaw = await visionCritique(shots, evidencePrompt(facts))
    evidence = parseEvidence(evRaw)
  }

  // ── STAGE 2 — CRO BRAIN = reasoning only. Sees NO pixels; turns evidence + text into leaks/fixes/panel,
  //    and every leak MUST cite an evidence id (enforced in parseReport) — uncited claims are dropped.
  let raw = '', parsed: Partial<CroReport> | null = null, fallbackErr = ''
  try {
    const res: any = await llm.messages.create({
      model: 'gpt-4o', max_tokens: 3800, temperature: 0.2, response_format: { type: 'json_object' },   // low temp → stable, repeatable score
      messages: [{ role: 'user', content: reasoningPrompt(site, facts, visibleText(home), visibleText(prod), evidence) }],
    })
    raw = res?.content?.[0]?.text || ''
    parsed = parseReport(raw, new Set(evidence.map((e) => e.id)))
  } catch (e) { fallbackErr = String((e as Error)?.message || e).slice(0, 200) }
  const usedVision = evidence.length > 0 && !!parsed?.leaks?.length

  if (!parsed || !parsed.leaks?.length) {
    try {
      const { logError } = await import('@/lib/admin/logError')
      void logError({ user_id: null, error_message: `CRO audit produced no report for ${domain}`, page_url: '/mission/cro', extra: { kind: 'cro_no_report', domain, hadShots: shots.length, evidence: evidence.length, rawLen: (raw || '').length, homeLen: home.length, prodLen: prod.length, fallbackErr } })
    } catch { /* never block */ }
    return { hasData: false, domain, site, note: 'Couldn’t complete the analysis — try again.' }
  }

  const leaks = parsed.leaks || []
  const criticalCount = leaks.filter((l) => l.severity === 'critical').length
  // DETERMINISTIC score — computed from the confirmed leaks + severity, not a free LLM guess. Same store →
  // same score run-to-run; it only moves when the findings actually change (i.e. when you fix something).
  const PENALTY: Record<string, number> = { critical: 16, high: 10, medium: 5 }
  const penalty = leaks.reduce((s, l) => s + (PENALTY[l.severity || 'medium'] || 5), 0)
  const score = Math.max(20, 100 - penalty)
  const shotMeta = await shotUrlsP
  return { hasData: true, domain, site, productUrl, usedVision, scannedAt: new Date().toISOString(), shots: shotMeta, issueCount: evidence.length || leaks.length, criticalCount, ...parsed, score }
}
