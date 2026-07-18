/**
 * Admin — image-generation health (last 7 days). Watches how the clone/remake pipeline is doing on
 * Google's Pro image model: what % of finished clones ran on Pro, and how many hit "Pro busy" (Pro
 * congested → we surface a retry instead of downgrading). Populates from clone_meta.model /
 * clone_meta.fail_reason, which the clone route started recording — so it fills in going forward.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const since = new Date(Date.now() - 7 * 864e5).toISOString()
  const { data } = await admin.from('creative_generations')
    .select('status, clone_meta, created_at')
    .eq('type', 'clone').eq('media_type', 'image').gte('created_at', since).limit(5000)
  const rows = (data || []) as any[]

  const proModel = process.env.GEMINI_IMAGE_MODEL_PRO || 'gemini-3-pro-image'
  const models: Record<string, number> = {}
  let done = 0, failed = 0, busy = 0, pro = 0, other = 0
  for (const r of rows) {
    const m = r.clone_meta?.model as string | undefined
    if (r.status === 'done') {
      done++
      if (m) { models[m] = (models[m] || 0) + 1; if (m === proModel) pro++; else other++ }
    } else if (r.status === 'failed') {
      failed++
      if (r.clone_meta?.fail_reason === 'pro_model_busy') busy++
    }
  }
  const tracked = pro + other   // done rows that recorded which model (new rows only)
  const proPct = tracked ? Math.round((pro / tracked) * 100) : null
  return NextResponse.json({
    windowDays: 7, total: rows.length, done, failed, busy,
    proModel, proCount: pro, fallbackCount: other, tracked, proPct, models,
  })
}
