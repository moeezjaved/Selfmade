/**
 * GET/POST /api/brain/culture — the company's temperament (Company Brain, set at onboarding, editable
 * in the Brain). Four dials that tune every department at once: how aggressive, how premium, the tone,
 * and how much autonomy Mello has. Stored as a CEO preference so recall() carries it into every prompt.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPrefs, setPref } from '@/lib/brain'

export const dynamic = 'force-dynamic'

const DIALS: Record<string, string[]> = {
  aggressive: ['conservative', 'balanced', 'aggressive'],
  premium: ['mass', 'premium', 'luxury'],
  tone: ['professional', 'friendly', 'funny'],
  risk: ['ask', 'sometimes', 'auto'],
}
const clean = (k: string, v: any) => (DIALS[k]?.includes(String(v)) ? String(v) : DIALS[k][1])

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const prefs = await getPrefs(createAdminClient(), user.id)
  return NextResponse.json({ culture: prefs.culture || null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const culture = { aggressive: clean('aggressive', b.aggressive), premium: clean('premium', b.premium), tone: clean('tone', b.tone), risk: clean('risk', b.risk) }
  const admin = createAdminClient()
  await setPref(admin, user.id, 'culture', culture, false)
  return NextResponse.json({ ok: true, culture })
}
