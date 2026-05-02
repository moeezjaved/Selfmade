import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(request: NextRequest) {
  try {
    const { product, description, targetCustomer, type, tone } = await request.json()

    const toneInstructions: Record<string,string> = {
      attention_grabbing: "Use emojis strategically. Bold hook. Pattern interrupt. Make them stop scrolling.",
      storytelling: "Tell a mini story. Problem → struggle → solution. Emotional journey in 2-3 sentences.",
      funny: "Be witty and relatable. Light humor. Make them smile while learning about the product.",
      serious: "Professional and credible. Facts and benefits. No fluff. Trust-building tone.",
      urgent: "Create urgency. Limited time/stock. FOMO. Clear deadline or scarcity.",
      social_proof: "Lead with numbers, reviews, or results. How many customers, what results they got.",
    }
    const toneGuide = toneInstructions[tone] || toneInstructions.attention_grabbing

    const typePrompts: Record<string, string> = {
      target: `Describe the ideal target customer for this product in one concise sentence.
Product: ${product}
Description: ${description}
Include: age range, gender (if relevant), key pain point, and what they want.
Example format: "Women 28-45 struggling with acne-prone skin who want clear, glowing skin without harsh chemicals."
Respond ONLY with JSON: {"targetCustomer": "..."}`,
      main: `Write Facebook ad copy for NEW customer acquisition.
Product: ${product}
Description: ${description}
Target: ${targetCustomer}
Tone: ${toneGuide}
2-3 sentences max. Make it irresistible.
Respond ONLY with JSON: {"primaryText": "...", "headline": "5 words max"}`,
      retargeting: `Write Facebook RETARGETING ad copy for people who visited but did not buy.
Product: ${product}
Description: ${description}
Target: ${targetCustomer}
Tone: ${toneGuide}
Overcome objections, give them a reason to return NOW. 2-3 sentences.
Respond ONLY with JSON: {"primaryText": "...", "headline": "5 words max"}`,
      retainer: `Write Facebook ad copy for PAST CUSTOMERS to buy again.
Product: ${product}
Description: ${description}
Target: ${targetCustomer}
Tone: ${toneGuide}
Make them feel like VIPs. Exclusive offer. Encourage repeat purchase. 2-3 sentences.
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
