/**
 * GET /api/brain/overview — everything the Company Brain screen shows in one call:
 * identity, beliefs (active DNA) + Mello's pending proposals, per-department notebooks + learnings,
 * the recent learning log, CEO prefs, and a simple playbook (the highest-confidence plays).
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPrefs } from '@/lib/brain'

export const dynamic = 'force-dynamic'

const DEPTS = ['research', 'creative', 'media', 'growth', 'customer', 'store', 'finance']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const [brandRes, dnaRes, memRes, learnRes, prefs] = await Promise.all([
    admin.from('brands').select('name, industry, brand_type').eq('user_id', user.id).limit(1),
    admin.from('company_dna').select('id, rule, department, priority, active, created_by, source, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
    admin.from('mello_memory').select('content, category, department, confidence').eq('user_id', user.id).order('confidence', { ascending: false }).limit(200),
    admin.from('learnings').select('department, event, result, metric, confidence, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200),
    getPrefs(admin, user.id),
  ])

  const dnaRows = (dnaRes.data || []) as any[]
  const beliefs = dnaRows.filter(d => d.active)
  const proposals = dnaRows.filter(d => !d.active && d.created_by === 'mello' && d.source === 'reflection')
  const mem = (memRes.data || []) as any[]
  const learns = (learnRes.data || []) as any[]

  const departments = DEPTS.map(dept => ({
    department: dept,
    notebook: mem.filter(m => m.department === dept).map(m => ({ content: m.content, category: m.category, confidence: m.confidence })),
    learnings: learns.filter(l => l.department === dept).slice(0, 12),
  })).filter(d => d.notebook.length || d.learnings.length)

  // Playbook = the highest-confidence learnings that carry a result (the plays the company has earned).
  const playbook = learns.filter(l => l.result && l.confidence >= 75).slice(0, 12)

  return NextResponse.json({
    identity: (brandRes.data || [])[0] || null,
    beliefs, proposals,
    departments,
    learnings: learns.slice(0, 30),
    prefs,
    playbook,
    counts: { beliefs: beliefs.length, proposals: proposals.length, learnings: learns.length },
  })
}
