/**
 * POST /api/brain/ask { question } → "Ask your company anything." Runs the Company Brain answer engine
 * (brainAnswer): retrieves across beliefs + facts + learnings + customer signals + live context and replies
 * in Mello's voice with a Source line. Honest — says when it doesn't know. Powers the Brain Overview tab.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { brainAnswer } from '@/lib/brain'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { question } = await req.json().catch(() => ({}))
  const q = String(question || '').trim()
  if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 })

  const admin = createAdminClient()
  const brandId = (await resolveActiveBrandId(admin, user.id).catch(() => null)) || null
  const ans = await brainAnswer(admin, user.id, q, { brandId })
  if (!ans) {
    return NextResponse.json({
      reply: `I don't have enough in the company memory to answer that confidently yet — teach me, or connect Slack, WhatsApp and your inbox and I'll learn it. I can also research it if it's about your market.`,
      sources: [],
      grounded: false,
    })
  }
  return NextResponse.json({ reply: ans.reply, sources: ans.sources, grounded: true })
}
