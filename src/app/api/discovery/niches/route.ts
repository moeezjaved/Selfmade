/**
 * Coarse niche vocabulary (from niche_counts) — powers the AI Ad Studio's "Industry" override
 * dropdown so users can correct an auto-detected niche.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = createAdminClient()
  const { data } = await admin.from('niche_counts').select('niche').order('niche', { ascending: true }).limit(200)
  const niches = Array.from(new Set((data || []).map((r: any) => r.niche).filter(Boolean)))
  return NextResponse.json({ niches })
}
