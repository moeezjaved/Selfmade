/**
 * Read/write the precomputed Creative Strategist result (mig 151, creative_strategy_cache). The nightly
 * cron fills this; the /api/creative/strategy route reads it first so the "What to make next" card is a
 * fast table read instead of a live scan + LLM call. Best-effort — a missing table (mig not applied yet)
 * degrades to null so the route falls back to live compute.
 */
import type { CreativeStrategy } from '@/lib/creative/strategist'

export async function readStrategyCache(admin: any, userId: string, brandId?: string | null): Promise<CreativeStrategy | null> {
  try {
    let q = admin.from('creative_strategy_cache').select('data').eq('user_id', userId)
    q = brandId ? q.eq('brand_id', brandId) : q.is('brand_id', null)
    const { data } = await q.limit(1).maybeSingle()
    return (data?.data as CreativeStrategy) || null
  } catch { return null }
}

export async function writeStrategyCache(admin: any, userId: string, brandId: string | null | undefined, data: CreativeStrategy): Promise<void> {
  try {
    // delete-then-insert (no onConflict needed for the coalesce unique index) — the row is small and
    // rewritten wholesale each time, so this is simplest + safe against the nullable brand_id.
    let del = admin.from('creative_strategy_cache').delete().eq('user_id', userId)
    del = brandId ? del.eq('brand_id', brandId) : del.is('brand_id', null)
    await del
    await admin.from('creative_strategy_cache').insert({ user_id: userId, brand_id: brandId || null, data, computed_at: new Date().toISOString() })
  } catch { /* best-effort — never let caching break the request */ }
}
