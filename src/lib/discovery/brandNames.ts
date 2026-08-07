/**
 * Resolve human brand names for a set of Meta page_ids, checking every source we have,
 * best-name-first. A "name" that is empty or purely numeric (i.e. the page_id itself) is
 * treated as unknown and we keep looking. Returns Map(page_id → name); page_ids we can't
 * name are simply absent from the map (callers decide the fallback copy).
 *
 * Sources, in priority order:
 *   1. discovery_brand_crawl_state.brand_name  — kept fresh by the crawler
 *   2. brand_directory.name                    — the 611K imported catalog
 *   3. followed_brands.brand_name              — what a user typed when they spied it
 *   4. discovery_ads_index.page_name           — the first indexed ad's page name
 */
const clean = (s: unknown): string => {
  const t = String(s ?? '').trim()
  // drop empties, bare page_ids, AND the "Facebook page <id>" placeholder a manual add writes —
  // otherwise followed_brands.brand_name (source 3) returns the placeholder and shadows the real
  // page_name (source 4), so the brief shows "Facebook page 2446…" instead of the brand's name.
  return t && !/^\d+$/.test(t) && !/^facebook page\s+\d+$/i.test(t) ? t : ''
}

export async function resolveBrandNames(admin: any, pageIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(pageIds.map((p) => String(p ?? '')).filter((p) => p && p !== 'null')))
  const out = new Map<string, string>()
  if (!ids.length) return out
  const missing = () => ids.filter((id) => !out.has(id))

  // 1) crawl_state.brand_name
  try {
    const { data } = await admin.from('discovery_brand_crawl_state').select('page_id, brand_name').in('page_id', ids)
    for (const r of (data || []) as any[]) { const n = clean(r.brand_name); if (n && !out.has(r.page_id)) out.set(String(r.page_id), n) }
  } catch { /* non-fatal */ }

  // 2) brand_directory.name
  const m2 = missing()
  if (m2.length) try {
    const { data } = await admin.from('brand_directory').select('page_id, name').in('page_id', m2)
    for (const r of (data || []) as any[]) { const n = clean(r.name); if (n && !out.has(r.page_id)) out.set(String(r.page_id), n) }
  } catch { /* non-fatal */ }

  // 3) followed_brands.brand_name
  const m3 = missing()
  if (m3.length) try {
    const { data } = await admin.from('followed_brands').select('page_id, brand_name').in('page_id', m3)
    for (const r of (data || []) as any[]) { const n = clean(r.brand_name); if (n && !out.has(r.page_id)) out.set(String(r.page_id), n) }
  } catch { /* non-fatal */ }

  // 4) first indexed ad's page_name (one cheap lookup per still-unknown brand)
  const m4 = missing()
  await Promise.all(m4.map(async (id) => {
    try {
      const { data } = await admin.from('discovery_ads_index').select('page_name').eq('page_id', id).not('page_name', 'is', null).limit(1).maybeSingle()
      const n = clean((data as any)?.page_name); if (n) out.set(id, n)
    } catch { /* non-fatal */ }
  }))

  return out
}
