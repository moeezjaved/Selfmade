/**
 * The off-Meta ear for Brand Guardian — public conversation about you and your market. Reddit has a free
 * public search (no key), which is the highest-value, lowest-friction source: someone asking "is [you]
 * legit?", a complaint you can defuse, or people shopping AWAY from a rival ("[rival] alternative") — warm
 * buyers. Best-effort: any failure returns []. YouTube optional behind YOUTUBE_API_KEY. X is paid-only now,
 * so we skip it rather than fake it.
 */

export type Mention = { source: 'reddit' | 'youtube'; title: string; url: string; where: string; kind: 'you' | 'shoppers' }

async function redditSearch(query: string, kind: Mention['kind']): Promise<Mention[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=6&t=month`
    const r = await fetch(url, { headers: { 'user-agent': 'selfmade-guardian/1.0 (brand monitoring)' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return []
    const j = await r.json().catch(() => null)
    const children = j?.data?.children || []
    return children.map((c: any) => c?.data).filter(Boolean).map((d: any) => ({
      source: 'reddit' as const,
      title: String(d.title || '').slice(0, 160),
      url: `https://reddit.com${d.permalink}`,
      where: `r/${d.subreddit}`,
      kind,
    })).slice(0, 4)
  } catch { return [] }
}

/** YouTube — OPTIONAL, only with a free Google Data API key. New videos reviewing you / your rivals =
 *  where category demand concentrates. No key → skipped (never fabricated). */
async function youtubeSearch(query: string, kind: Mention['kind']): Promise<Mention[]> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return []
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=2&q=${encodeURIComponent(query)}&key=${key}`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return []
    const j = await r.json().catch(() => null)
    return (j?.items || []).filter((it: any) => it?.id?.videoId).map((it: any) => ({
      source: 'youtube' as const,
      title: String(it.snippet?.title || '').slice(0, 160),
      url: `https://youtube.com/watch?v=${it.id.videoId}`,
      where: String(it.snippet?.channelTitle || 'YouTube'),
      kind,
    })).slice(0, 2)
  } catch { return [] }
}

/**
 * Watch: your own brand (reputation) + the top rival's "alternative" search (shoppers leaving them), across
 * Reddit and — if a key is set — YouTube. `rivals` = a few competitor names to check for switch-intent.
 */
export async function scanMentions(brand: string, rivals: string[] = []): Promise<Mention[]> {
  const jobs: Promise<Mention[]>[] = []
  if (brand) { jobs.push(redditSearch(`"${brand}"`, 'you')); jobs.push(youtubeSearch(`${brand} review`, 'you')) }
  const rival = rivals.find(Boolean)
  if (rival) { jobs.push(redditSearch(`${rival} alternative`, 'shoppers')); jobs.push(youtubeSearch(`best ${rival} alternative`, 'shoppers')) }
  const all = (await Promise.all(jobs)).flat()
  // Dedup by url.
  const seen = new Set<string>()
  return all.filter(m => (seen.has(m.url) ? false : (seen.add(m.url), true))).slice(0, 6)
}
