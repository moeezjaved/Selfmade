/**
 * The proof loop — turns projected wins into BANKED (verified) revenue, honestly. Organic moves (content,
 * programmatic pages, catalog fixes, SEO, GEO) compound into organic revenue; we measure the REAL organic
 * revenue lift since the founder started that work (from shopify_orders channel='organic') and bank it
 * against those moves. We never invent: if organic didn't grow, nothing banks.
 *
 * Honesty + idempotency: banked total is capped to the actual measured lift, and re-runs only distribute the
 * INCREMENT (current lift minus what's already banked), so it converges to the truth and never double-counts.
 */
import { resolveStore } from '@/lib/shopify/client'

const ORGANIC_CATS = ['content', 'programmatic', 'catalog', 'seo', 'geo']

async function organicRevenueBetween(admin: any, storeId: string, startISO: string, endISO: string): Promise<number> {
  const { data } = await admin.from('shopify_orders')
    .select('total_price, financial_status')
    .eq('store_id', storeId).eq('channel', 'organic')
    .gte('processed_at', startISO).lt('processed_at', endISO).limit(5000)
  return (data || [])
    .filter((r: any) => r.financial_status !== 'voided' && r.financial_status !== 'refunded')
    .reduce((s: number, r: any) => s + (Number(r.total_price) || 0), 0)
}

export type ProofResult = { ran: boolean; lift: number; alreadyBanked: number; newlyBanked: number; winsBanked: number; currency: string | null }

export async function runProofLoop(admin: any, userId: string, brandId: string | null): Promise<ProofResult> {
  const store = await resolveStore(admin, userId, brandId).catch(() => null)
  if (!store) return { ran: false, lift: 0, alreadyBanked: 0, newlyBanked: 0, winsBanked: 0, currency: null }

  // The organic wins in the ledger (the moves that compound into organic revenue).
  let q = admin.from('wins').select('*').eq('user_id', userId).in('category', ORGANIC_CATS).order('created_at', { ascending: true }).limit(1000)
  if (brandId) q = q.eq('brand_id', brandId)
  const { data: winsData } = await q
  const wins: any[] = winsData || []
  if (!wins.length) return { ran: true, lift: 0, alreadyBanked: 0, newlyBanked: 0, winsBanked: 0, currency: store.currency ?? null }

  // Baseline = the 30 days BEFORE the founder started the organic work; Recent = the last 30 days.
  const firstAt = new Date(wins[0].created_at).getTime()
  const now = Date.now()
  const D = 30 * 86400000
  const baseline = await organicRevenueBetween(admin, store.id, new Date(firstAt - D).toISOString(), new Date(firstAt).toISOString())
  const recent = await organicRevenueBetween(admin, store.id, new Date(now - D).toISOString(), new Date(now).toISOString())
  const lift = Math.max(0, Math.round(recent - baseline))

  // Idempotent banking: only distribute the INCREMENT over what's already verified.
  const alreadyBanked = wins.reduce((s, w) => s + (Number(w.banked_value) || 0), 0)
  const toDistribute = Math.max(0, lift - alreadyBanked)
  const unverified = wins.filter((w) => w.banked_value == null)
  if (toDistribute <= 0 || !unverified.length) {
    return { ran: true, lift, alreadyBanked: Math.round(alreadyBanked), newlyBanked: 0, winsBanked: 0, currency: store.currency ?? null }
  }

  // Split the new lift evenly across the moves that plausibly earned it (honest aggregate attribution).
  const per = Math.round(toDistribute / unverified.length)
  let banked = 0, count = 0
  for (const w of unverified) {
    if (per <= 0) break
    await admin.from('wins').update({ banked_value: per, currency: store.currency, verified_at: new Date().toISOString() }).eq('id', w.id)
    banked += per; count++
  }
  return { ran: true, lift, alreadyBanked: Math.round(alreadyBanked), newlyBanked: banked, winsBanked: count, currency: store.currency ?? null }
}
