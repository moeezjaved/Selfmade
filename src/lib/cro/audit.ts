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
import { critiqueScreens } from '@/lib/gemini/vision'
import { uploadBufferToR2 } from '@/lib/r2'

export type CroRegion = { x: number; y: number; w: number; h: number }   // percent of the screenshot (0-100)
export type CroLeak = { title: string; why: string; fix: string; screen?: 'home' | 'pdp'; region?: CroRegion }
export type CroChange = { title: string; detail: string; impact: string }
export type CroHomeSection = { section: string; why: string; content?: string }
export type CroPdpChange = { change: string; why: string }
export type CroAbTest = { name: string; hypothesis: string; impact: string }
export type CroShot = { key: string; label: string; url: string }   // key: home-desktop | home-mobile | pdp-desktop | pdp-mobile
export type CroReport = {
  hasData: boolean
  domain?: string; site?: string; productUrl?: string | null
  score?: number; verdict?: string
  leaks?: CroLeak[]; changes?: CroChange[]; homepage?: CroHomeSection[]; productPage?: CroPdpChange[]; abtests?: CroAbTest[]; firstChange?: string
  shots?: CroShot[]
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

function buildPrompt(site: string, facts: string, homeText: string, prodText: string, hasShots: boolean): string {
  return `Act as one of the world's best e-commerce conversion-rate-optimization experts — years optimizing Shopify stores, millions in added revenue. IGNORE whether the site looks beautiful. Your ONLY objective: turn more existing visitors into paying customers. Be BRUTALLY honest and SPECIFIC to THIS store — no generic advice. Your pay depends only on the revenue lift you'd create.

STORE: ${site}
${hasShots ? 'You are given rendered screenshots (homepage + product page, desktop + mobile). Judge what you can SEE; never invent details.' : 'No screenshots available — analyze from the content below.'}

GROUND TRUTH (detected on the pages — do NOT contradict these facts):
${facts}

HOMEPAGE CONTENT (truncated):
${homeText.slice(0, 3800)}

PRODUCT PAGE CONTENT (truncated):
${prodText.slice(0, 3800)}

Do a forensic CRO audit covering: offer strength, above-the-fold conversion, message clarity, product positioning, CTA strategy, product-page structure, pricing psychology, social proof, reviews, trust signals, objection handling, risk reversal, urgency, mobile experience, checkout friction, information hierarchy, cognitive load, and where users are most likely to abandon. For every weakness, say WHY it costs conversions and WHAT should replace it.

Return ONLY JSON in EXACTLY this shape (no prose outside JSON):
{
  "score": <integer 0-100, honest>,
  "verdict": "<one brutally honest sentence>",
  "leaks": [ {"title":"...","why":"why it kills conversion","fix":"what to do instead"${hasShots ? `,"screen":"home" or "pdp" (which screenshot the problem is on),"region":{"x":0-100,"y":0-100,"w":0-100,"h":0-100} (approx rectangle on that screenshot where the problem is, as % of the image — omit if you can't localize it)` : ''}} ]  // EXACTLY the 5 biggest conversion leaks,
  "changes": [ {"title":"...","detail":"...","impact":"expected conversion/revenue effect, conservative range"} ]  // 5 highest-impact changes,
  "homepage": [ {"section":"e.g. Hero","why":"why this section here","content":"the exact copy/elements to use for THIS store"} ]  // the exact new homepage structure, in order top→bottom,
  "productPage": [ {"change":"the exact change","why":"why"} ]  // exact product-page changes,
  "abtests": [ {"name":"...","hypothesis":"...","impact":"expected revenue impact"} ]  // EXACTLY 5, ordered by expected revenue impact (highest first),
  "firstChange": "<the single change you'd make FIRST if paid only on revenue lift>"
}`
}

type Shot = { key: string; label: string; b64: string }
async function screenshots(domain: string, productUrl: string | null): Promise<Shot[]> {
  const base = process.env.DROPLET_PREVIEW_URL, secret = process.env.PREVIEW_SECRET
  if (!base || !secret) return []
  const grab = async (u: string, tag: string, page: 'home' | 'pdp'): Promise<Shot[]> => {
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/screenshot?url=${encodeURIComponent(u)}`, { headers: { 'X-Preview-Secret': secret }, signal: AbortSignal.timeout(35_000) })
      if (!r.ok) return []
      const s = await r.json() as { desktop?: string | null; mobile?: string | null }
      const out: Shot[] = []
      if (s.desktop) out.push({ key: `${page}-desktop`, label: `${tag} — DESKTOP (above the fold):`, b64: s.desktop })
      if (s.mobile) out.push({ key: `${page}-mobile`, label: `${tag} — MOBILE (above the fold):`, b64: s.mobile })
      return out
    } catch { return [] }
  }
  const [home, pdp] = await Promise.all([grab(`https://${domain}/`, 'HOMEPAGE', 'home'), productUrl ? grab(productUrl, 'PRODUCT PAGE', 'pdp') : Promise.resolve([])])
  return [...home, ...pdp]
}

/** Upload the captured screenshots to R2 so the report can render the REAL store, and return their URLs. */
async function persistShots(domain: string, shots: Shot[]): Promise<CroShot[]> {
  const slug = domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const out: CroShot[] = []
  for (const s of shots) {
    try {
      const buf = Buffer.from(s.b64, 'base64')
      const url = await uploadBufferToR2(buf, `cro/${slug}/${s.key}-${buf.length}.jpg`, 'image/jpeg')
      if (url) out.push({ key: s.key, label: s.label, url })
    } catch { /* skip a shot that won't upload */ }
  }
  return out
}

function parseReport(txt: string): Partial<CroReport> | null {
  if (!txt) return null
  try {
    const clean = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))
    const arr = (v: any) => (Array.isArray(v) ? v : [])
    const str = (v: any, n = 400) => String(v || '').slice(0, n)
    const clamp = (v: any) => Math.max(0, Math.min(100, Number(v)))
    const region = (v: any): CroRegion | undefined => {
      if (!v || typeof v !== 'object') return undefined
      const x = clamp(v.x), y = clamp(v.y), w = clamp(v.w), h = clamp(v.h)
      if ([x, y, w, h].some((n) => Number.isNaN(n)) || w <= 0 || h <= 0) return undefined
      return { x, y, w, h }
    }
    const screen = (v: any): 'home' | 'pdp' | undefined => (v === 'home' || v === 'pdp' ? v : undefined)
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))),
      verdict: str(j.verdict, 240),
      leaks: arr(j.leaks).slice(0, 5).map((x: any) => ({ title: str(x.title, 140), why: str(x.why), fix: str(x.fix), screen: screen(x.screen), region: region(x.region) })).filter((x: CroLeak) => x.title),
      changes: arr(j.changes).slice(0, 5).map((x: any) => ({ title: str(x.title, 140), detail: str(x.detail), impact: str(x.impact, 200) })).filter((x: CroChange) => x.title),
      homepage: arr(j.homepage).slice(0, 12).map((x: any) => ({ section: str(x.section, 80), why: str(x.why, 240), content: x.content ? str(x.content, 500) : undefined })).filter((x: CroHomeSection) => x.section),
      productPage: arr(j.productPage).slice(0, 12).map((x: any) => ({ change: str(x.change, 200), why: str(x.why, 300) })).filter((x: CroPdpChange) => x.change),
      abtests: arr(j.abtests).slice(0, 5).map((x: any) => ({ name: str(x.name, 140), hypothesis: str(x.hypothesis), impact: str(x.impact, 200) })).filter((x: CroAbTest) => x.name),
      firstChange: str(j.firstChange, 400),
    }
  } catch { return null }
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
  const prompt = buildPrompt(site, facts, visibleText(home), visibleText(prod), shots.length > 0)

  // Primary: Gemini multimodal — but ONLY when we actually have screenshots for it to SEE. With no
  // shots there's no reason to route through Gemini (and 2.5 "thinking" models can burn the whole token
  // budget on reasoning and return empty text), so we go straight to the reliable gpt-4o JSON path.
  let raw = shots.length ? await critiqueScreens(shots, prompt, { maxTokens: 4200, temperature: 0.35 }) : ''
  let parsed = parseReport(raw)
  let fallbackErr = ''

  // Reliable fallback: gpt-4o in JSON mode. Runs whenever the vision pass didn't yield a PARSEABLE report
  // — not only when it was empty. (A non-empty-but-unparseable Gemini response used to block this.)
  if (!parsed || !parsed.leaks?.length) {
    try {
      const res: any = await llm.messages.create({
        model: 'gpt-4o', max_tokens: 3600, temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      })
      raw = res?.content?.[0]?.text || ''
      parsed = parseReport(raw)
    } catch (e) { fallbackErr = String((e as Error)?.message || e).slice(0, 200) }
  }

  if (!parsed || !parsed.leaks?.length) {
    // Surface WHY in the admin error log so a blank report is diagnosable instead of a silent "try again".
    try {
      const { logError } = await import('@/lib/admin/logError')
      void logError({ user_id: null, error_message: `CRO audit produced no report for ${domain}`, page_url: '/mission/cro', extra: { kind: 'cro_no_report', domain, hadShots: shots.length, rawLen: (raw || '').length, homeLen: home.length, prodLen: prod.length, fallbackErr } })
    } catch { /* never block */ }
    return { hasData: false, domain, site, note: 'Couldn’t complete the analysis — try again.' }
  }

  const shotMeta = await shotUrlsP
  return { hasData: true, domain, site, productUrl, usedVision: shots.length > 0, scannedAt: new Date().toISOString(), shots: shotMeta, ...parsed }
}
