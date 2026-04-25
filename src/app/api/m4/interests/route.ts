import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product, description, competitors, targetCustomer } = await request.json()

  const prompt = `You are an expert Facebook/Meta ads media buyer. Suggest 8 interests for Meta Ads targeting.

Product: ${product}
Description: ${description}
Competitors: ${competitors || 'None specified'}
Target Customer: ${targetCustomer || 'General'}

Rules:
- Each must be a SINGLE interest targetable on Meta Ads Manager
- Mix: competitor brands, magazines, influencers, activities, lifestyle
- Explain WHY in simple language a business owner understands

You MUST respond with ONLY a JSON object. No text before or after. No markdown. Start with { and end with }.

{"interests":[{"name":"exact Meta interest name","category":"Competitor|Publication|Influencer|Activity|Lifestyle","why":"one sentence why this audience buys","size":"Small|Medium|Large","confidence":85}]}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await res.json()
    
    if (data.error) {
      console.error('Anthropic API error:', data.error)
      return NextResponse.json({ error: data.error.message }, { status: 500 })
    }

    const text = (data.content?.[0]?.text || '').trim()
    console.log('Claude response:', text.substring(0, 200))

    // Extract JSON robustly
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) {
      console.error('No JSON in response:', text)
      return NextResponse.json({ error: 'No JSON in response' }, { status: 500 })
    }

    const parsed = JSON.parse(text.slice(start, end + 1))
    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('Interest error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
