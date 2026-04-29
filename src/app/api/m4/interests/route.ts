import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product, description, competitors, targetCustomer, competitorDomains, competitorFBPages, competitorIGHandles } = await request.json()

  const compCtx = [
    competitors ? "Known competitors: " + competitors : "",
    competitorDomains ? "Competitor websites: " + competitorDomains : "",
    competitorFBPages ? "Competitor Facebook pages: " + competitorFBPages : "",
    competitorIGHandles ? "Competitor Instagram: " + competitorIGHandles : "",
  ].filter(Boolean).join("\n")

  const prompt = "You are an expert Facebook/Meta ads media buyer.\n\nProduct: " + product + "\nDescription: " + description + "\nTarget Customer: " + (targetCustomer || "General") + "\n" + (compCtx ? "\nCompetitor Intelligence:\n" + compCtx : "") + "\n\nSuggest 8 highly targeted Meta Ads interests. Use competitor data to find competitor brand interests, publications, influencers, activities.\n\nExtract brand names from domains/handles. Use EXACT names as in Meta Ads Manager.\n\nRespond ONLY with valid JSON:\n{\"interests\":[{\"name\":\"exact Meta interest name\",\"category\":\"Competitor|Publication|Influencer|Activity|Lifestyle\",\"why\":\"one sentence\",\"size\":\"Small|Medium|Large\",\"confidence\":85}]}"

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }]
      })
    })
    const data = await res.json()
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 })
    const text = (data.content?.[0]?.text || "").trim()
    console.log("Claude response:", text.substring(0, 200))
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start === -1 || end === -1) return NextResponse.json({ error: "No JSON" }, { status: 500 })
    const parsed = JSON.parse(text.slice(start, end + 1))
    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
