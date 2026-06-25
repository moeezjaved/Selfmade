/**
 * Top Picks directory — published experts and their published packs.
 * Public ad-catalog data (same for every signed-in user). Drives /discovery/top-picks.
 */
import { NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/supabase/missing-table'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createReadClient()
  const { data, error } = await admin
    .from('experts')
    .select('id, name, handle, avatar_url, bio, sort_order, expert_packs(id, title, description, cover_url, price_cents, original_price_cents, is_early_bird, gate, sort_order, is_published, ad_count:expert_pack_ads(count))')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
  if (error) {
    // experts tables not created yet (migration 048 pending) → clean empty state, not a 500.
    if (isMissingTable(error)) return NextResponse.json({ experts: [], packs: [] })
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const experts = (data || []).map((e: any) => ({
    id: e.id, name: e.name, handle: e.handle, avatar_url: e.avatar_url, bio: e.bio,
    packs: (e.expert_packs || [])
      .filter((p: any) => p.is_published)
      .map((p: any) => ({
        id: p.id, title: p.title, description: p.description, cover_url: p.cover_url,
        price_cents: p.price_cents, original_price_cents: p.original_price_cents,
        is_early_bird: p.is_early_bird, gate: p.gate,
        ad_count: p.ad_count?.[0]?.count ?? 0,
      }))
      .sort((a: any, b: any) => a.sort_order - b.sort_order),
  })).filter((e: any) => e.packs.length > 0)

  // Flat list of all published packs too (the "Top Picks" card grid à la Atria).
  const packs = experts.flatMap((e: any) =>
    e.packs.map((p: any) => ({ ...p, expert: { id: e.id, name: e.name, handle: e.handle, avatar_url: e.avatar_url } })),
  )

  return NextResponse.json({ experts, packs })
}
