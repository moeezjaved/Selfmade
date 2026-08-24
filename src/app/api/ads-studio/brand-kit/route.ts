/**
 * Brand Kit — derived from the WEBSITE alone (no Shopify): logo, colors + typefaces from real CSS, a
 * Knowledge Base of atomic facts, and brand voice (the Lapis pattern).
 *
 * GET  ?domain=…  → the SAVED kit if we have one for this brand+domain (source of truth), else generate it,
 *                    persist it to the active brand, and feed its facts into Company Brain.
 * POST { action } → edit the saved kit: addFact | editFact | deleteFact | setVoice. Persists + re-syncs brain.
 * A logged-out visitor just gets live generation (unpersisted).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { buildBrandKit, type BrandKitData } from '@/lib/ads-studio/brandkit'
import { getSavedKit, saveKit, syncKitToBrain, clearKitBrain, type SavedKit } from '@/lib/ads-studio/brandkit-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const cleanDomain = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()

async function ctx(req: NextRequest) {
  const admin = createAdminClient() as any
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  const brandId = user ? await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand') || undefined).catch(() => null) : null
  return { admin, userId: user?.id || null, brandId }
}

export async function GET(req: NextRequest) {
  const domain = cleanDomain(req.nextUrl.searchParams.get('domain') || '')
  if (!domain || !domain.includes('.')) return NextResponse.json({ empty: true })
  try {
    const { admin, userId, brandId } = await ctx(req)

    // 1. Saved source of truth (per brand + domain).
    if (brandId) {
      const saved = await getSavedKit(admin, brandId, domain)
      if (saved) return NextResponse.json({ ...saved, saved: true, editable: true })
    }

    // 2. Generate fresh, then persist + feed Company Brain (only when we have an owner brand).
    const kit = await buildBrandKit(domain)
    if (userId && brandId) {
      const saved = await saveKit(admin, brandId, domain, kit)
      syncKitToBrain(admin, userId, brandId, kit).catch(() => {})
      return NextResponse.json({ ...(saved || kit), saved: !!saved, editable: !!saved })
    }
    return NextResponse.json({ ...kit, saved: false, editable: false })
  } catch (e: any) {
    return NextResponse.json({ empty: true, error: String(e?.message || e).slice(0, 160) })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const domain = cleanDomain(String(body.domain || ''))
  const action = String(body.action || '')
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })
  try {
    const { admin, userId, brandId } = await ctx(req)
    if (!userId || !brandId) return NextResponse.json({ error: 'Sign in to edit your Brand Kit.' }, { status: 401 })

    const saved = await getSavedKit(admin, brandId, domain)
    if (!saved) return NextResponse.json({ error: 'No saved Brand Kit for this store yet.' }, { status: 404 })

    const facts = [...saved.facts]
    if (action === 'addFact' && String(body.text || '').trim()) {
      facts.unshift(String(body.text).trim().slice(0, 400))
    } else if (action === 'editFact' && Number.isInteger(body.index) && String(body.text || '').trim()) {
      if (body.index >= 0 && body.index < facts.length) facts[body.index] = String(body.text).trim().slice(0, 400)
    } else if (action === 'deleteFact' && Number.isInteger(body.index)) {
      if (body.index >= 0 && body.index < facts.length) facts.splice(body.index, 1)
    } else if (action === 'setVoice' && body.voice) {
      saved.voice = { tone: String(body.voice.tone || '').slice(0, 40), energy: String(body.voice.energy || '').slice(0, 12), audience: String(body.voice.audience || '').slice(0, 80) }
    } else {
      return NextResponse.json({ error: 'unknown or invalid action' }, { status: 400 })
    }

    const next: BrandKitData = { ...saved, facts }
    const savedNext = await saveKit(admin, brandId, domain, next)
    // Re-sync Company Brain so edits/deletes actually stick.
    await clearKitBrain(admin, userId, brandId)
    syncKitToBrain(admin, userId, brandId, next).catch(() => {})
    return NextResponse.json({ ...(savedNext || next), saved: true, editable: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
