import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(request: NextRequest) {
  try {
    const { product, description, targetCustomer } = await request.json()
    if (!product) return NextResponse.json({ competitors: [] })

    const prompt = `You are an expert in brand research and competitive analysis.

Product/Brand: ${product}
Description: ${description || ''}
Target Customer: ${targetCustomer || ''}

List 6 real direct competitors for this brand. Only include brands that actually exist.
For each competitor provide their website domain and Instagram handle if they have one.

Respond ONLY with valid JSON:
{
  "competitors": [
    { "name": "Brand Name", "domain": "brandname.com", "instagram": "@brandhandle" },
    { "name": "Brand Name 2", "domain": "brand2.com", "instagram": "" }
  ]
}`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) return NextResponse.json({ competitors: [] })
    const data = JSON.parse(text.slice(start, end + 1))
    return NextResponse.json({ competitors: data.competitors || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
