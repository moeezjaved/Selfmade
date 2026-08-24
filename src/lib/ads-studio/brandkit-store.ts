/**
 * Brand Kit persistence — the saved source of truth + Company Brain feed.
 *  • Stored on the user's active brand at `brands.brand_kit.adsStudio` (JSONB; non-breaking — existing
 *    ad-gen/geo readers use other sub-keys). Keyed by the active brand, domain-stamped so a different
 *    store's kit never shadows another's.
 *  • On save, the atomic facts + voice are written into Company Brain (`mello_memory`) as active facts, so
 *    ad generation, audiences and the strategist all read the SAME knowledge via recall().
 *  • Editable: add / edit / delete facts (and voice) mutate the saved kit and re-sync the brain.
 * Everything is best-effort — a logged-out visitor (no brand) just gets live generation, unpersisted.
 */
import type { BrandKitData } from './brandkit'

export type SavedKit = BrandKitData & { domain: string; savedAt: string }

/** Read the saved kit for a brand, only if it was saved for THIS domain (else regenerate fresh). */
export async function getSavedKit(admin: any, brandId: string, domain: string): Promise<SavedKit | null> {
  try {
    const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
    const k = data?.brand_kit?.adsStudio
    if (k && Array.isArray(k.facts) && k.facts.length && k.domain && k.domain.replace(/^www\./, '') === domain.replace(/^www\./, '')) return k as SavedKit
    return null
  } catch { return null }
}

/** Persist the full kit under brands.brand_kit.adsStudio (merged, non-destructive). */
export async function saveKit(admin: any, brandId: string, domain: string, kit: BrandKitData): Promise<SavedKit | null> {
  try {
    const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
    const existing = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
    const saved: SavedKit = { ...kit, domain: domain.replace(/^www\./, ''), savedAt: new Date().toISOString() }
    await admin.from('brands').update({ brand_kit: { ...existing, adsStudio: saved } }).eq('id', brandId)
    return saved
  } catch { return null }
}

/** Write the kit's facts + voice into Company Brain as active facts (batch upsert, no embeddings). */
export async function syncKitToBrain(admin: any, userId: string, brandId: string | null, kit: BrandKitData): Promise<number> {
  try {
    const rows = kit.facts.slice(0, 40).map((f) => ({
      user_id: userId, brand_id: brandId || null, content: String(f).slice(0, 400),
      kind: 'brand', category: 'fact', confidence: 70, source: 'brand_kit', source_kind: 'brand_kit', status: 'active', department: null,
    }))
    if (kit.voice) rows.push({
      user_id: userId, brand_id: brandId || null,
      content: `Brand voice: ${kit.voice.tone} tone, ${kit.voice.energy} energy, for ${kit.voice.audience}.`.slice(0, 400),
      kind: 'brand', category: 'fact', confidence: 70, source: 'brand_kit', source_kind: 'brand_kit', status: 'active', department: null,
    })
    if (!rows.length) return 0
    await admin.from('mello_memory').upsert(rows, { onConflict: 'user_id,content', ignoreDuplicates: true })
    return rows.length
  } catch { return 0 }
}

/** Remove this kit's brain facts (used before re-sync after an edit, so deletes/edits actually stick). */
export async function clearKitBrain(admin: any, userId: string, brandId: string | null): Promise<void> {
  try {
    let q = admin.from('mello_memory').delete().eq('user_id', userId).eq('source', 'brand_kit')
    if (brandId) q = q.eq('brand_id', brandId)
    await q
  } catch { /* best-effort */ }
}
