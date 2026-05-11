/**
 * Auto-discovery seed terms — categories that auto-discovery searches across
 * Meta Ads Library to find new brands.
 *
 * GET    /api/admin/seeds          list all seeds
 * POST   /api/admin/seeds          add a new seed term
 * PATCH  /api/admin/seeds          toggle is_active or update min_followers
 * DELETE /api/admin/seeds?id=XX    remove a seed
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('discovery_seed_terms')
    .select('*')
    .order('category', { ascending: true })
    .order('term', { ascending: true })

  return NextResponse.json({ seeds: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()
  const { term, category, min_followers, countries } = body

  if (!term?.trim()) return NextResponse.json({ error: 'term required' }, { status: 400 })

  const { data, error } = await admin
    .from('discovery_seed_terms')
    .insert({
      term: term.trim().toLowerCase(),
      category: category || 'general',
      min_followers: min_followers || 30000,
      countries: countries || ['US'],
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ seed: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const allowed: Record<string, any> = {}
  if (typeof updates.is_active === 'boolean') allowed.is_active = updates.is_active
  if (typeof updates.min_followers === 'number') allowed.min_followers = updates.min_followers
  if (Array.isArray(updates.countries)) allowed.countries = updates.countries
  if (typeof updates.category === 'string') allowed.category = updates.category

  const { error } = await admin.from('discovery_seed_terms').update(allowed).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await admin.from('discovery_seed_terms').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
