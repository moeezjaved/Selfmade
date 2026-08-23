/**
 * Shopify orders sync — TRUE revenue. Pulls real orders via the Admin REST API (read_orders), labels each
 * order's acquisition channel from its landing page + referrer, and rolls them up into revenue / AOV / and
 * per-channel splits. The `organic` split is the first honest "SEO contribution to revenue" — straight from
 * order referrers, no GA needed. (GA/GSC later sharpens it with sessions → true CVR.)
 */
import { shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'

export type Channel = 'organic' | 'paid' | 'social' | 'email' | 'referral' | 'direct'

const SEARCH = /(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave)\./i
const SOCIAL = /(facebook|instagram|fb\.com|t\.co|twitter|x\.com|tiktok|pinterest|linkedin|reddit|snapchat|youtube)\./i

/** Label an order's channel from its landing page (paid markers win) and referrer. */
export function classifyChannel(sourceName?: string | null, landing?: string | null, referring?: string | null): Channel {
  const land = String(landing || '').toLowerCase()
  const ref = String(referring || '').toLowerCase()
  // paid: click ids or cpc/paid utm markers
  if (/(gclid=|gbraid=|wbraid=|fbclid=|msclkid=|utm_medium=(cpc|ppc|paid|paidsocial|paid_social)|utm_source=(google_ads|adwords|facebook|instagram|meta|tiktok_ads))/i.test(land)) return 'paid'
  if (/utm_medium=email|utm_source=(klaviyo|mailchimp|omnisend|email)/i.test(land)) return 'email'
  if (/utm_medium=(social|organic_social)/i.test(land)) return 'social'
  if (SEARCH.test(ref)) return 'organic'
  if (SOCIAL.test(ref)) return 'social'
  if (ref && !/utm_/.test(ref)) return 'referral'
  if (land && /utm_medium=organic/i.test(land)) return 'organic'
  return 'direct'
}

/**
 * Sync recent orders (default last 90 days) into shopify_orders. Pulls up to 250 in one page — plenty for
 * the revenue window of an early store. (A Link-header-aware pass can extend beyond 250 when needed;
 * shopifyRest doesn't surface the cursor yet.)
 */
export async function syncOrders(admin: any, store: StoreRow, days = 90): Promise<{ synced: number }> {
  const token = tokenFor(store)
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const path = `orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=id,name,total_price,currency,financial_status,source_name,landing_site,referring_site,processed_at,created_at`
  const json = await shopifyRest(store.shop_domain, token, path)
  const orders: any[] = json?.orders || []
  if (orders.length) {
    const rows = orders.map((o) => ({
      store_id: store.id, brand_id: store.brand_id, user_id: store.user_id,
      order_id: Number(o.id), name: o.name || null,
      total_price: Number(o.total_price) || 0, currency: o.currency || store.currency || null,
      financial_status: o.financial_status || null, source_name: o.source_name || null,
      landing_site: o.landing_site || null, referring_site: o.referring_site || null,
      channel: classifyChannel(o.source_name, o.landing_site, o.referring_site),
      processed_at: o.processed_at || o.created_at || null,
    }))
    await admin.from('shopify_orders').upsert(rows, { onConflict: 'store_id,order_id' })
  }
  await admin.from('shopify_stores').update({ last_sync: new Date().toISOString() }).eq('id', store.id)
  return { synced: orders.length }
}

export type RevenueSummary = {
  windowDays: number
  revenue: number; orders: number; aov: number; currency: string | null
  byChannel: Record<Channel, { revenue: number; orders: number }>
  organicRevenue: number; organicShare: number
  hasData: boolean; lastSync: string | null
}

const EMPTY_CHANNELS = (): Record<Channel, { revenue: number; orders: number }> => ({
  organic: { revenue: 0, orders: 0 }, paid: { revenue: 0, orders: 0 }, social: { revenue: 0, orders: 0 },
  email: { revenue: 0, orders: 0 }, referral: { revenue: 0, orders: 0 }, direct: { revenue: 0, orders: 0 },
})

/** Roll up stored orders for the last N days into revenue / AOV / per-channel + the organic (SEO) split. */
export async function revenueSummary(admin: any, store: StoreRow, days = 30): Promise<RevenueSummary> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data } = await admin.from('shopify_orders')
    .select('total_price, currency, channel, financial_status, processed_at')
    .eq('store_id', store.id).gte('processed_at', since).limit(5000)
  const rows: any[] = (data || []).filter((r: any) => r.financial_status !== 'voided' && r.financial_status !== 'refunded')
  const byChannel = EMPTY_CHANNELS()
  let revenue = 0
  for (const r of rows) {
    const amt = Number(r.total_price) || 0
    revenue += amt
    const ch = (r.channel || 'direct') as Channel
    if (byChannel[ch]) { byChannel[ch].revenue += amt; byChannel[ch].orders++ }
  }
  const orders = rows.length
  const organicRevenue = byChannel.organic.revenue
  return {
    windowDays: days, revenue: Math.round(revenue), orders,
    aov: orders ? Math.round(revenue / orders) : 0, currency: store.currency || (rows[0]?.currency ?? null),
    byChannel, organicRevenue: Math.round(organicRevenue),
    organicShare: revenue ? Math.round((organicRevenue / revenue) * 100) : 0,
    hasData: orders > 0, lastSync: (store as any).last_sync || null,
  }
}
