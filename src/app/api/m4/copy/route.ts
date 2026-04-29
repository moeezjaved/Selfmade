import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(request: NextRequest) {
  try {
    const { product, description, targetCustomer, type } = await request.json()

    const typePrompts: Record<string, string> = {
      main: `Write Facebook ad copy for NEW customer acquisition.
Product: ${product}
Description: ${description}
Target: ${targetCustomer}
Hook them, highlight the benefit, create desire. 2-3 sentences max.
Respond ONLY with JSON: {"primaryText": "...", "headline": "5 words max"}`,
      retargeting: `Write Facebook RETARGETING ad copy for people who visited but did not buy.
Product: ${product}
Description: ${description}
Target: ${targetCustomer}
Overcome objections, create urgency, give them a reason to return NOW. 2-3 sentences.
Respond ONLY with JSON: {"primaryText": "...", "headline": "5 words max"}`,
      retainer: `Write Facebook ad copy for PAST CUSTOMERS to buy again.
Product: ${product}
Description: ${description}
Target: ${targetCustomer}
Make them feel like VIPs. Offer something exclusive. Encourage repeat purchase. 2-3 sentences.
Respond ONLY with JSON: {"primaryText": "...", "headline": "5 words max"}`,
    }

    const prompt = typePrompts[type] || typePrompts.main

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const clean = text.replace(/```json|```/g, '').trim()
    const data = JSON.parse(clean)
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
