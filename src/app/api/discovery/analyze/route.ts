import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { llm } from '@/lib/llm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const claude = llm

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { page_id, page_name, ads } = await request.json()
    if (!page_id || !ads?.length) return NextResponse.json({ error: 'page_id and ads required' }, { status: 400 })

    // Check cache (valid for 24 hours)
    const admin = createAdminClient()
    const { data: cached } = await admin
      .from('discovery_brand_analysis')
      .select('*')
      .eq('page_id', page_id)
      .gte('analyzed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cached) return NextResponse.json({ analysis: cached.analysis, cached: true })

    // Build ad text corpus (limit to 60 ads to keep prompt manageable)
    const sample = ads.slice(0, 60)
    const adTexts = sample
      .filter((ad: any) => ad.body || ad.title)
      .map((ad: any, i: number) => `Ad ${i + 1}:\n${ad.title ? `Headline: ${ad.title}\n` : ''}${ad.body ? `Body: ${ad.body}` : ''}`)
      .join('\n---\n')

    const prompt = `You are a marketing intelligence analyst. Analyze these ${sample.length} ads from the brand "${page_name}" and extract structured marketing insights.

Ad corpus:
${adTexts}

Return ONLY a valid JSON object with exactly this structure (no markdown, no explanation):
{
  "personas": ["3-5 specific target audience descriptions, e.g. 'Women 35-55 interested in anti-aging skincare'"],
  "adAngles": ["4-7 ad angles/approaches used, e.g. 'Social proof with celebrity endorsement', 'Problem-solution for dry skin'"],
  "usps": ["4-7 unique selling propositions extracted, e.g. 'Clinically tested formula', 'Free shipping over $50'"],
  "desires": ["3-5 core desires/motivations targeted, e.g. 'Look younger', 'Effortless beauty routine'"],
  "emotions": ["3-5 emotions the ads trigger, e.g. 'Confidence', 'FOMO', 'Trust', 'Excitement'"],
  "hooks": ["5-8 most compelling opening lines or hooks extracted verbatim from the ads"],
  "themes": ["3-6 recurring content themes, e.g. 'Before & After transformation', 'Expert recommendation'"]
}`

    const msg = await claude.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (msg.content[0] as any).text?.trim()
    let analysis: any
    try {
      // Strip markdown code fences if present
      const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
      analysis = JSON.parse(json)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    // Cache in Supabase
    await admin.from('discovery_brand_analysis').upsert({
      page_id,
      page_name,
      analysis,
      ad_count: sample.length,
      analyzed_at: new Date().toISOString(),
    }, { onConflict: 'page_id' })

    return NextResponse.json({ analysis })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
