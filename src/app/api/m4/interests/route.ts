import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product, description, competitors, targetCustomer } = await request.json()

  const prompt = `You are an expert Facebook/Meta ads media buyer with 10 years experience.

Suggest the BEST single interests to target on Meta Ads for this product.

RULES:
- Each must be ONE single interest (never combine)
- Must be targetable on Meta Ads Manager
- Mix types: competitor brands, magazines, influencers, activities, complementary products
- Explain WHY in simple friendly language (like talking to a business owner)

Product: ${product}
Description: ${description}
Competitors: ${competitors || 'Unknown'}
Target Customer: ${targetCustomer || 'General'}

Return ONLY valid JSON:
{
  "interests": [
    {
      "name": "exact interest name as on Facebook",
      "category": "Competitor | Publication | Influencer | Activity | Lifestyle | Tool",
      "why": "Simple one sentence why this audience will buy",
      "size": "Small | Medium | Large",
      "confidence": 90
    }
  ]
}

Suggest exactly 8 interests.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return NextResponse.json(parsed)
  } catch (err) {
    console.error('Interest error:', err)
    return NextResponse.json({ error: 'Failed to generate interests' }, { status: 500 })
  }
}
