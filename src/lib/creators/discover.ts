/**
 * Creator discovery — find Instagram creators by country + follower range + niche, WITHOUT ever touching
 * the founder's own IG account. We run a hosted Apify actor (afanasenko/instagram-profile-scraper by
 * default) which scrapes on Apify's own infrastructure ("no login, public data only") and can filter by
 * min/max followers + return public emails. The founder adds APIFY_TOKEN once; until then discovery is
 * disabled (the UI still supports manual / CSV add so the whole pipeline works today).
 *
 * ToS note: scraping IG is against Meta's terms; the risk sits on Apify's infra, not the founder's
 * account. We only pull public profile fields for outreach. Nothing here messages anyone.
 */

export type CreatorCandidate = {
  handle: string
  fullName?: string | null
  profileUrl?: string | null
  avatarUrl?: string | null
  followers?: number | null
  engagementRate?: number | null
  category?: string | null
  bio?: string | null
  country?: string | null
  email?: string | null
  phone?: string | null
}

export type DiscoverInput = {
  country?: string
  minFollowers?: number
  maxFollowers?: number
  niche?: string          // free text — becomes a keyword + seed hashtags
  hashtags?: string[]     // explicit seeds, e.g. ['pakistanifashion']
  limit?: number          // cap results (cost control) — default 50
  requireEmail?: boolean  // only creators with a public email (safer outreach)
}

export const APIFY_ENABLED = () => !!process.env.APIFY_TOKEN
const ACTOR = () => process.env.APIFY_ACTOR || 'afanasenko~instagram-profile-scraper'

/** Best-effort normalizer — Apify actors vary in field names, so read tolerantly. */
function normalize(row: any): CreatorCandidate | null {
  const handle = String(row.username || row.handle || row.ownerUsername || '').replace(/^@/, '').trim()
  if (!handle) return null
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  return {
    handle,
    fullName: row.fullName || row.full_name || row.name || null,
    profileUrl: row.url || row.profileUrl || (handle ? `https://instagram.com/${handle}` : null),
    avatarUrl: row.profilePicUrl || row.profile_pic_url || row.avatar || null,
    followers: num(row.followersCount ?? row.followers ?? row.edge_followed_by?.count),
    engagementRate: num(row.engagementRate ?? row.engagement_rate ?? row.engagement),
    category: row.businessCategoryName || row.category || row.categoryName || null,
    bio: row.biography || row.bio || null,
    country: row.country || null,
    email: row.email || row.publicEmail || row.public_email || (Array.isArray(row.emails) ? row.emails[0] : null) || null,
    phone: row.phone || row.publicPhoneNumber || null,
  }
}

/** Build the actor input from our search form. Field names match the default actor; override via env if
 *  you swap actors. Kept liberal so a different actor still gets the core signals. */
function actorInput(input: DiscoverInput) {
  const niche = (input.niche || '').trim()
  const seeds = (input.hashtags && input.hashtags.length ? input.hashtags : (niche ? [niche.replace(/\s+/g, '')] : []))
  return {
    search: niche || (seeds[0] || ''),
    searchType: 'hashtag',
    hashtags: seeds,
    country: input.country || undefined,
    minFollowers: input.minFollowers ?? undefined,
    maxFollowers: input.maxFollowers ?? undefined,
    onlyWithEmail: !!input.requireEmail,
    resultsLimit: Math.min(200, Math.max(1, input.limit || 50)),
  }
}

/**
 * Run discovery. Returns { needsToken:true } when APIFY_TOKEN isn't set yet, so the UI can prompt for it
 * while manual/CSV add keeps working. Otherwise runs the actor synchronously and returns candidates.
 */
export async function discoverCreators(input: DiscoverInput): Promise<{ needsToken?: boolean; candidates: CreatorCandidate[]; error?: string }> {
  if (!APIFY_ENABLED()) return { needsToken: true, candidates: [] }
  const token = process.env.APIFY_TOKEN as string
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR())}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(actorInput(input)),
      signal: AbortSignal.timeout(120000), // discovery runs can take a minute+
    })
    if (!r.ok) return { candidates: [], error: `Apify ${r.status}` }
    const rows = await r.json().catch(() => [])
    const list = Array.isArray(rows) ? rows : []
    // Normalize + apply our own follower filter too (defensive — some actors ignore min/max).
    const min = input.minFollowers ?? 0
    const max = input.maxFollowers ?? Number.MAX_SAFE_INTEGER
    const out: CreatorCandidate[] = []
    const seen = new Set<string>()
    for (const row of list) {
      const c = normalize(row)
      if (!c || seen.has(c.handle)) continue
      if (c.followers != null && (c.followers < min || c.followers > max)) continue
      if (input.requireEmail && !c.email) continue
      seen.add(c.handle)
      out.push(c)
      if (out.length >= (input.limit || 50)) break
    }
    return { candidates: out }
  } catch (e: any) {
    return { candidates: [], error: String(e?.message || e) }
  }
}
