import Anthropic from '@anthropic-ai/sdk'
import { AIStrategyResult, CreativeAnalysis, GeneratedCopyVariant } from '@/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const MODEL = 'claude-sonnet-4-20250514'

// ── SKILL: 5 AGENT STRATEGY ──────────────────────────────────
// Implements the AI Ads Strategist SKILL.md internally

export async function runAdStrategy(params: {
  campaignName: string
  objective: 'OUTCOME_SALES' | 'OUTCOME_LEADS'
  landingUrl?: string
  productDescription: string
  dailyBudget: number
  location: string
  ageMin: number
  ageMax: number
  gender: 'all' | 'male' | 'female'
  interests: string[]
  competitors?: string
  competitorInsights?: string
}): Promise<AIStrategyResult> {
  const objective = params.objective === 'OUTCOME_SALES'
    ? 'OUTCOME_SALES (Conversions/Purchase)'
    : 'OUTCOME_LEADS (Lead Generation)'

  const prompt = `You are Selfmade's AI Ads Strategist. Run 5 parallel agents to build a complete Meta ad campaign strategy.

CAMPAIGN BRIEF:
- Name: ${params.campaignName}
- Objective: ${objective}
- Landing URL: ${params.landingUrl || 'N/A'}
- Product/Offer: ${params.productDescription}
- Daily Budget: $${params.dailyBudget}
- Location: ${params.location}
- Age Range: ${params.ageMin}–${params.ageMax}
- Gender: ${params.gender}
- Interests: ${params.interests.join(', ') || 'Not specified'}
- Competitors: ${params.competitors || 'None provided'}
- Competitor Insights: ${params.competitorInsights || 'None'}

AGENT 1 — AUDIENCE (25% weight):
Build 2 ICP personas with full targeting parameters. Include exclusions.

AGENT 2 — CREATIVE (20% weight):
Generate 3 complete ad variations. Each needs: hook, headline (max 40 chars), primary text (2-3 sentences), CTA, why it works.
If competitors provided: extract PATTERNS only — do NOT copy. Find what they're missing.

AGENT 3 — FUNNEL (20% weight):
TOF/MOF/BOF structure. Retargeting flow from this campaign.

AGENT 4 — COMPETITIVE (15% weight):
If competitors given: hook patterns, visual trends, offer gaps, recommended angle.

AGENT 5 — BUDGET (20% weight):
Validate $${params.dailyBudget}/day. Project CPM ($8-15), CPC ($0.50-2.00), CPA ranges. Scaling triggers.

AD READINESS SCORE (0-100): weighted average of all 5 agents.

Return ONLY valid JSON, no markdown:
{
  "audience": {
    "personas": [
      {"name":"string","age":"string","gender":"string","interests":["string"],"behaviors":["string"],"pain_points":["string"],"why_they_buy":"string"},
      {"name":"string","age":"string","gender":"string","interests":["string"],"behaviors":["string"],"pain_points":["string"],"why_they_buy":"string"}
    ],
    "targeting_summary": "string",
    "score": 0
  },
  "creative": {
    "variations": [
      {"id":1,"type":"Pain Point Hook","hook":"string","headline":"string","primary_text":"string","cta":"SHOP_NOW","why":"string"},
      {"id":2,"type":"Social Proof Hook","hook":"string","headline":"string","primary_text":"string","cta":"LEARN_MORE","why":"string"},
      {"id":3,"type":"Transformation Hook","hook":"string","headline":"string","primary_text":"string","cta":"GET_OFFER","why":"string"}
    ],
    "image_direction": "string",
    "score": 0
  },
  "funnel": {
    "structure": "string",
    "tof": "string",
    "mof": "string",
    "bof": "string",
    "retargeting": "string",
    "score": 0
  },
  "competitive": {
    "patterns_found": ["string"],
    "gaps": ["string"],
    "recommended_angle": "string",
    "score": 0
  },
  "budget": {
    "daily": ${params.dailyBudget},
    "est_cpm": "string",
    "est_cpc": "string",
    "est_cpa": "string",
    "est_reach_day": "string",
    "scaling_trigger": "string",
    "score": 0
  },
  "composite_score": 0,
  "top_recommendation": "string"
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content.map(c => c.type === 'text' ? c.text : '').join('')
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean) as AIStrategyResult
}

// ── CREATIVE ANALYSIS (Creative Studio) ──────────────────────

export async function analyzeWinningAd(params: {
  adName: string
  campaign: string
  headline: string
  primaryText: string
  cta: string
  visual: string
  offer: string
  roas: number
  ctr: number
  cpa: number
  spend: number
  competitors?: string
  competitorSummary?: string
}): Promise<Omit<CreativeAnalysis, 'id' | 'user_id' | 'created_at'>> {
  const prompt = `You are an expert Meta ads creative strategist. Analyse this winning ad and generate 6 strategic variation briefs.

WINNING AD (from Meta account — best performer):
- Name: ${params.adName}
- Campaign: ${params.campaign}
- Headline: ${params.headline}
- Primary Text: ${params.primaryText}
- CTA: ${params.cta}
- Visual: ${params.visual}
- Offer: ${params.offer}
- ROAS: ${params.roas}x
- CTR: ${params.ctr}%
- CPA: $${params.cpa}
- Spend: $${params.spend}

${params.competitors ? `COMPETITORS: ${params.competitors}\nCOMPETITOR INSIGHTS: ${params.competitorSummary}` : 'COMPETITOR DATA: None.'}

Return ONLY valid JSON:
{
  "winning_analysis": {
    "hook_type": "string",
    "emotional_trigger": "string",
    "visual_style": "string",
    "offer_type": "string",
    "audience_intent": "string",
    "why_winning": ["string","string","string","string"]
  },
  "competitor_analysis": {
    "has_data": false,
    "common_hooks": ["string"],
    "common_emotions": ["string"],
    "visual_trends": ["string"],
    "offer_patterns": ["string"],
    "doing_better": ["string"],
    "missing": ["string","string","string"]
  },
  "strategy": {
    "preserve": ["string","string","string"],
    "improve": ["string","string","string"],
    "test": ["string","string","string"]
  },
  "variations": [
    {
      "id": 1,
      "name": "Same Angle, Stronger Hook",
      "type": "hook",
      "type_label": "Stronger Hook",
      "hook": "string",
      "headline": "string",
      "primary_text": "string",
      "cta": "string",
      "visual": {"composition":"string","subject":"string","background":"string","text_placement":"string","colors":"string"},
      "design_style": "string",
      "what_changed": ["string"],
      "why_better": "string",
      "image_prompt": "string"
    },
    {"id":2,"name":"Same Angle, Different Emotion","type":"emotion","type_label":"Different Emotion","hook":"","headline":"","primary_text":"","cta":"","visual":{"composition":"","subject":"","background":"","text_placement":"","colors":""},"design_style":"","what_changed":[""],"why_better":"","image_prompt":""},
    {"id":3,"name":"New Hook Inspired by Competitors","type":"comp","type_label":"Competitor-Inspired","hook":"","headline":"","primary_text":"","cta":"","visual":{"composition":"","subject":"","background":"","text_placement":"","colors":""},"design_style":"","what_changed":[""],"why_better":"","image_prompt":""},
    {"id":4,"name":"Same Ad, Different Audience","type":"audience","type_label":"New Audience","hook":"","headline":"","primary_text":"","cta":"","visual":{"composition":"","subject":"","background":"","text_placement":"","colors":""},"design_style":"","what_changed":[""],"why_better":"","image_prompt":""},
    {"id":5,"name":"Premium Version","type":"premium","type_label":"Higher Perceived Value","hook":"","headline":"","primary_text":"","cta":"","visual":{"composition":"","subject":"","background":"","text_placement":"","colors":""},"design_style":"","what_changed":[""],"why_better":"","image_prompt":""},
    {"id":6,"name":"Competitor Gap Opportunity","type":"gap","type_label":"Gap in Market","hook":"","headline":"","primary_text":"","cta":"","visual":{"composition":"","subject":"","background":"","text_placement":"","colors":""},"design_style":"","what_changed":[""],"why_better":"","image_prompt":""}
  ]
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 5000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content.map(c => c.type === 'text' ? c.text : '').join('')
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ── RECOMMENDATIONS ENGINE ───────────────────────────────────

export async function generateRecommendations(campaignData: {
  campaigns: unknown[]
  adSets: unknown[]
  accountAvgCpm: number
  accountAvgRoas: number
}): Promise<{
  recommendations: {
    type: string
    entity_type: string
    entity_id: string
    entity_name: string
    title: string
    reasoning: string
    impact_estimate: string
    confidence_score: number
    meta_action: Record<string, unknown>
  }[]
}> {
  const prompt = `You are Selfmade's decision engine. Analyse this Meta ad account data and generate prioritised recommendations.

ACCOUNT DATA:
${JSON.stringify(campaignData, null, 2)}

RULES:
- CPM > 150% of account average → recommend PAUSE (creative fatigue)
- ROAS stable at 4x+ for 7+ days → recommend SCALE (increase budget 20-30%)
- CTR dropped >40% over 14 days same creative → recommend TEST_CREATIVE
- CPA > 2x target → recommend PAUSE or AUDIENCE_NARROW
- Confidence score 0-100 based on data strength and days of evidence

Return ONLY valid JSON array of recommendations. Max 8 recommendations, sorted by confidence:
{
  "recommendations": [
    {
      "type": "PAUSE|SCALE|TEST_CREATIVE|ADJUST_BUDGET|AUDIENCE_NARROW",
      "entity_type": "campaign|adset|ad",
      "entity_id": "string",
      "entity_name": "string",
      "title": "string",
      "reasoning": "string — explain WHY with specific numbers",
      "impact_estimate": "string — e.g. 'Save ~$280/day in wasted spend'",
      "confidence_score": 85,
      "meta_action": {}
    }
  ]
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content.map(c => c.type === 'text' ? c.text : '').join('')
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ── QUICK AD COPY GENERATION ─────────────────────────────────

export async function generateAdCopy(params: {
  product: string
  audience: string
  objective: string
  tone: string[]
  competitors?: string
}): Promise<GeneratedCopyVariant[]> {
  const prompt = `Generate 3 high-converting Meta ad copy variations.

Product: ${params.product}
Audience: ${params.audience}
Objective: ${params.objective}
Tone: ${params.tone.join(', ')}
Competitors: ${params.competitors || 'Not provided'}

Return ONLY valid JSON array:
[
  {"id":1,"type":"Pain Point Hook","hook":"string","headline":"string (max 40 chars)","primary_text":"2-3 sentences","cta":"SHOP_NOW","why":"string"},
  {"id":2,"type":"Social Proof Hook","hook":"string","headline":"string","primary_text":"string","cta":"LEARN_MORE","why":"string"},
  {"id":3,"type":"Transformation Hook","hook":"string","headline":"string","primary_text":"string","cta":"GET_OFFER","why":"string"}
]`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content.map(c => c.type === 'text' ? c.text : '').join('')
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}
