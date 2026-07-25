/**
 * The AI-authored Competitor Intelligence Report — Mello's flagship artifact.
 *
 * "Analyze <competitor>" → a McKinsey/Sequoia-grade strategy document, NOT a ChatGPT summary.
 * It is generated for a Selfmade USER about a RIVAL brand they watch, and every section ends in an
 * action for THE USER'S OWN brand — never generic observations.
 *
 * Two design decisions the founder locked (2026-07-26):
 *   1. GROUNDING — the report is built on REAL crawled ad DNA from discovery_ads_index
 *      (problem/mechanism/offer/cta_style/format_style/days_running/tier), so it cannot hallucinate a
 *      competitor's playbook. The model reasons over evidence, it doesn't invent it.
 *   2. MODEL — premium artifact ⇒ optimize for QUALITY, not cost. Chain is
 *      Claude Opus (best non-"ChatGPT" long-form reasoner) → Gemini 2.5 Pro (ships today on the
 *      existing GEMINI_API_KEY) → gpt-4o (last resort). It runs live on Gemini Pro until an
 *      ANTHROPIC_API_KEY is set in Vercel, then auto-upgrades to Opus with no code change.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { getCompetitorAds } from '../library-data'

// ── The data pack: real evidence the model reasons over ──────────────────────
export interface CompetitorPack {
  competitorName: string
  myBrand: { name: string; industry?: string; website?: string; voice?: string; edge?: string } | null
  adCount: number
  activeAds: number | null
  niches: string[]
  formatMix: Record<string, number>       // UGC / Studio / Graphic / Mixed → count
  tierMix: Record<string, number>         // winning / optimized / ... → count
  topProblems: string[]
  topMechanisms: string[]
  topOffers: string[]
  ctaStyles: Record<string, number>       // soft / hard / none → count
  longRunners: { headline: string | null; days: number; offer: string | null; format: string | null }[]
  sampleAds: { headline: string | null; problem: string | null; mechanism: string | null; offer: string | null; format: string | null; cta: string | null; days: number | null; tier: string | null }[]
  site: { sells?: string; buyer?: string; voice?: string; differentiator?: string } | null
}

const tally = (rows: any[], key: string) => {
  const m: Record<string, number> = {}
  for (const r of rows) { const v = r[key]; if (v) m[String(v)] = (m[String(v)] || 0) + 1 }
  return m
}
const topN = (rows: any[], key: string, n: number) => {
  const seen = new Map<string, number>()
  for (const r of rows) { const v = r[key]; if (!v) continue; const k = String(v).trim(); seen.set(k, (seen.get(k) || 0) + 1) }
  return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}

/** Best-effort site read for mission/positioning/pricing signal (fail-soft — the ad DNA is the spine). */
async function readSite(url?: string): Promise<CompetitorPack['site']> {
  if (!url) return null
  try {
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    const r = await fetch(full, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(8000) })
    const html = (await r.text()).slice(0, 200_000)
    const grab = (re: RegExp) => re.exec(html)?.[1]?.trim() || ''
    return {
      sells: grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,300})/i) || grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i),
      differentiator: grab(/<title[^>]*>([^<]{0,160})/i),
    }
  } catch { return null }
}

/** Assemble the evidence pack from our real corpus. Competitor by name (+ optional website for site read). */
export async function assembleCompetitorPack(opts: {
  competitorName: string
  myBrand?: CompetitorPack['myBrand']
  competitorWebsite?: string
}): Promise<CompetitorPack> {
  const admin = createAdminClient()
  // Pull the competitor's ads (grounded DNA). Fall back gracefully to an empty pack if none crawled.
  let ads: any[] = []
  try { ads = (await getCompetitorAds({ brand: opts.competitorName, limit: 24 })).ads } catch { ads = [] }
  void admin

  const active = ads.filter((a) => a.is_active).length
  const longRunners = [...ads]
    .filter((a) => typeof a.days_running === 'number')
    .sort((a, b) => (b.days_running || 0) - (a.days_running || 0))
    .slice(0, 6)
    .map((a) => ({ headline: a.headline, days: a.days_running || 0, offer: a.offer, format: a.format_style || a.format }))

  const site = await readSite(opts.competitorWebsite)

  return {
    competitorName: opts.competitorName,
    myBrand: opts.myBrand || null,
    adCount: ads.length,
    activeAds: ads.length ? active : null,
    niches: topN(ads, 'niche', 4),
    formatMix: tally(ads, 'format_style'),
    tierMix: tally(ads, 'tier'),
    topProblems: topN(ads, 'problem', 6),
    topMechanisms: topN(ads, 'mechanism', 6),
    topOffers: topN(ads, 'offer', 6),
    ctaStyles: tally(ads, 'cta_style'),
    longRunners,
    sampleAds: ads.slice(0, 14).map((a) => ({
      headline: a.headline, problem: a.problem, mechanism: a.mechanism, offer: a.offer,
      format: a.format_style || a.format, cta: a.cta_style, days: a.days_running ?? null, tier: a.tier,
    })),
    site,
  }
}

// ── The prompt: what makes it feel like Sequoia, not ChatGPT ─────────────────
function renderEvidence(p: CompetitorPack): string {
  const mix = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') || '—'
  const list = (a: string[]) => a.length ? a.map((x) => `• ${x}`).join('\n') : '• (none crawled)'
  const runners = p.longRunners.length
    ? p.longRunners.map((r) => `• ${r.days}d live — ${r.headline || 'untitled'}${r.offer ? ` · offer: ${r.offer}` : ''}${r.format ? ` · ${r.format}` : ''}`).join('\n')
    : '• (no longevity data)'
  const samples = p.sampleAds.length
    ? p.sampleAds.map((a, i) => `${i + 1}. [${a.tier || 'untiered'}${a.days ? `, ${a.days}d` : ''}] ${a.headline || 'untitled'}\n   problem: ${a.problem || '—'} | mechanism: ${a.mechanism || '—'} | offer: ${a.offer || '—'} | ${a.format || '—'} | CTA: ${a.cta || '—'}`).join('\n')
    : '(no ads crawled for this competitor yet)'
  return `COMPETITOR: ${p.competitorName}
CRAWLED ADS: ${p.adCount}${p.activeAds != null ? ` (${p.activeAds} currently active)` : ''}
NICHES: ${p.niches.join(', ') || '—'}
FORMAT MIX: ${mix(p.formatMix)}
PERFORMANCE TIERS: ${mix(p.tierMix)}
CTA POSTURE: ${mix(p.ctaStyles)}
RECURRING PROBLEMS THEY HOOK ON:
${list(p.topProblems)}
MECHANISMS THEY CLAIM:
${list(p.topMechanisms)}
OFFERS THEY RUN:
${list(p.topOffers)}
LONGEST-RUNNING ADS (proven winners — longevity = they're paying to keep it live):
${runners}
${p.site ? `THEIR SITE SAYS: ${[p.site.sells, p.site.differentiator].filter(Boolean).join(' · ')}\n` : ''}AD-BY-AD SAMPLE (the raw evidence — cite these):
${samples}`
}

export function buildReportPrompt(p: CompetitorPack): { system: string; user: string } {
  const me = p.myBrand?.name || 'the reader’s brand'
  const myCtx = p.myBrand
    ? `THE READER'S OWN BRAND (write every recommendation FOR them):
- Name: ${p.myBrand.name}${p.myBrand.industry ? ` · ${p.myBrand.industry}` : ''}${p.myBrand.website ? ` · ${p.myBrand.website}` : ''}
${p.myBrand.voice ? `- Voice: ${p.myBrand.voice}\n` : ''}${p.myBrand.edge ? `- Their edge: ${p.myBrand.edge}\n` : ''}`
    : `THE READER'S OWN BRAND: not specified — write the opportunities as direct, usable moves any operator in this niche could run tomorrow.`

  const system = `You are the sharpest competitive-strategy mind a founder could put in a room — the analytical instinct of Paul Graham, the product taste of Jony Ive and Karri Saarinen, the market clarity of Patrick Collison and Sam Altman, the storytelling of Brian Chesky. You are writing an INTERNAL STRATEGY DOCUMENT that will shape ${me}'s marketing roadmap for the next 12 months.

This is a MARKETING & CREATIVE competitive-intelligence report about a rival ADVERTISER, grounded in that rival's real ad data (their crawled Meta ads: the problems they hook on, the mechanisms they claim, the offers they run, their creative formats, and how long each ad has stayed live — longevity is the strongest signal that an ad is winning, because they're spending to keep it up).

ABSOLUTE RULES:
- NEVER sound like ChatGPT. No "In today's competitive landscape", no "It's important to note", no hedging, no both-sidesism, no restating the question, no bland summaries.
- Write like an operator who has run ad accounts and shipped product. Sharp, specific, opinionated, a little irreverent. Short paragraphs. Strong verbs.
- EVERY section must end with a concrete, actionable takeaway FOR ${me} — a hook to steal, an offer to test, a gap to attack, an angle to own. If a section can't produce an action, cut it.
- GROUND every claim in the evidence provided. Cite specific ads, offers, mechanisms, and longevity numbers from the data. If the data is thin on something, SAY "insufficient signal" — never invent a funding round, a headcount, a revenue figure, or an ad that isn't in the evidence.
- Numbers over adjectives. "3 of their 5 longest-running ads lead with a price anchor" beats "they use strong offers."
- This must read like a document a Fortune 500 CEO paid McKinsey for — because that is the bar.`

  const user = `${myCtx}

=== EVIDENCE (real crawled data — this is your source of truth) ===
${renderEvidence(p)}
=== END EVIDENCE ===

Write the report in clean Markdown with these sections (use ## headings). Adapt depth to the evidence — go deep where the data is rich, mark "insufficient signal" where it's thin. This competitor is a BRAND ADVERTISER, so weight the marketing/creative/offer/funnel sections heavily; keep product/engineering sections short unless the evidence shows they're a software product.

## Executive Summary
A three-minute read. If the founder reads only this, they must know: what this rival really is, why customers buy them, the one job they solve best, why they're growing, where they're weak, and whether ${me} should care. End with the single most important move for ${me}.

## The Rival at a Glance
Positioning, target customer, apparent stage, offer/pricing posture, category. Only what the evidence + site support; mark gaps honestly. → what this tells ${me}.

## The Real Product (the transformation they sell)
Don't list features. Map the BEFORE → AFTER transformation their ads promise the customer, per major angle. → the transformation ${me} could own instead.

## The Jobs They Win (most important section)
List the customer JOBS their ads are hired for (in the customer's own voice — "I don't want to feel X", "I need Y fast"). For each: Importance (1–10), Frequency (daily/weekly/one-time), how well THIS rival solves it, and specifically how ${me} could solve it BETTER. Use a table.

## Their Creative Playbook
The hooks, mechanisms, and offer structures they lean on — cite the actual ads and longevity. What's their signature move? What's formulaic? → the hook/offer ${me} should test or deliberately avoid.

## Longevity Tells (what they're betting real money on)
Read the longest-running ads as revealed preference — those are their proven winners. What pattern do the survivors share? → the pattern ${me} should adapt.

## Growth & Distribution
How they appear to acquire — creative volume, format bets, offer cadence, retargeting signals visible in the ad mix. Strongest and weakest channels. → where ${me} can out-flank them.

## The Moat (what can't be copied fast)
Brand, offer economics, creative velocity, data, distribution, community. Be honest — many advertisers have NO moat. → whether ${me} can beat them on this.

## Opportunities for ${me} (this becomes the roadmap)
Three tiers, each with concrete moves tied to the evidence:
- **Ship this week** — highest impact, lowest effort (hooks/offers to test now).
- **Build this quarter** — durable creative/positioning advantages.
- **Long-term edge** — hard but defensible.

## What ${me} Should NOT Copy
Their bad ideas — angles, offers, or patterns that look tempting but are traps. Say why.

## Final Verdict
Answer directly: Is this a real threat to ${me} or noise? If you ran ${me}, what would you ship first after reading this? Then finish with EXACTLY this line, filled in:
**The biggest lesson ${p.competitorName} teaches ${me} is ______.**`

  return { system, user }
}

// ── The model chain: Opus → Gemini 2.5 Pro → gpt-4o ──────────────────────────
async function callAnthropic(system: string, user: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.REPORT_ANTHROPIC_MODEL || 'claude-opus-4-8',
        max_tokens: 8000, temperature: 0.6, system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) return null
    const j = await r.json()
    const text = (j.content || []).map((c: any) => (c.type === 'text' ? c.text : '')).join('')
    return text.trim() || null
  } catch { return null }
}

async function callGeminiPro(system: string, user: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  try {
    const model = process.env.REPORT_GEMINI_MODEL || 'gemini-2.5-pro'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) return null
    const j = await r.json()
    const text = (j?.candidates?.[0]?.content?.parts || []).map((pt: any) => pt.text || '').join('')
    return text.trim() || null
  } catch { return null }
}

async function callOpenAI(system: string, user: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.REPORT_OPENAI_MODEL || 'gpt-4o', max_tokens: 6000, temperature: 0.6,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) return null
    const j = await r.json()
    return (j.choices?.[0]?.message?.content || '').trim() || null
  } catch { return null }
}

export interface GeneratedReport { title: string; markdown: string; model: string; adCount: number }

/** Generate the report end-to-end. Assembles the evidence pack, runs the model chain, returns markdown. */
export async function generateCompetitorReport(opts: {
  competitorName: string
  myBrand?: CompetitorPack['myBrand']
  competitorWebsite?: string
}): Promise<GeneratedReport> {
  const pack = await assembleCompetitorPack(opts)
  const { system, user } = buildReportPrompt(pack)

  let markdown: string | null = null
  let model = ''
  for (const [name, fn] of [
    ['claude-opus', callAnthropic],
    ['gemini-2.5-pro', callGeminiPro],
    ['gpt-4o', callOpenAI],
  ] as const) {
    markdown = await fn(system, user)
    if (markdown) { model = name; break }
  }
  if (!markdown) throw new Error('All report models unavailable (Anthropic/Gemini/OpenAI). Check keys/quota.')

  const myName = pack.myBrand?.name || 'You'
  return {
    title: `${pack.competitorName} — Competitor Intelligence for ${myName}`,
    markdown,
    model,
    adCount: pack.adCount,
  }
}
