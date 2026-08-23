/**
 * POST /api/seo/qa { url, keyword } → on-page SEO QA of a live page for a target keyword (free). Read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { qaPage } from '@/lib/seo/content-qa'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const url = String(body?.url || '').trim()
  const keyword = String(body?.keyword || '').trim()
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
  try { return NextResponse.json(await qaPage(url, keyword), { status: 200 }) }
  catch (e) { return NextResponse.json({ error: 'seo_qa_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
}
