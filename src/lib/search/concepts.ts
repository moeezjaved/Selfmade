/**
 * Query-side concept expansion + match-tier ranking.
 *
 * THE GAP THIS CLOSES: we normalize synonyms when TAGGING (the classifier maps
 * thinning/regrow/balding → "hair loss"), but a free-text QUERY never reached those
 * tags — searching "thinning hair" tested topics.cs.{thinning hair}/{thinning}/{hair},
 * none of which equal the stored tag "hair loss". So hims's hair-tagged ads only
 * surfaced via the (over-reaching) semantic layer. This maps a query → its concept →
 * the actual stored tags, in the EXACT/topic tier.
 *
 * MODEL: each concept has `synonyms` (interchangeable → same tier) and `related`
 * (DIRECTED problem→solution links → ranked one tier lower). "thinning hair" → matches
 * "hair loss" tags (same concept) AND "hair growth" tags (related solution), with the
 * solution ads ranked below the on-point problem ads so recall rises without precision
 * dropping.
 *
 * GROUNDING (critical): every `key` and every `related` entry MUST be a tag the
 * classifier actually emits, or the expansion points at tags that don't exist. These
 * are grounded in the live topic audit (hair loss, hair growth, activewear, leggings,
 * gymwear, testosterone, collagen, sleep, …). `synonyms` are what USERS TYPE, so they
 * can be anything (they double as query-recognition); only keys/related must be real tags.
 *
 * SINGLE-SOURCE NOTE: the tag-side spelling/plural map (CANONICAL_TOPICS in the worker's
 * classify-core) and this query-side concept map serve DIFFERENT jobs (normalize vs
 * relate) and live in different packages, so they aren't one file — but the keys here
 * are deliberately kept equal to the canonical tags that map produces. Re-run the topic
 * audit when adding concepts to confirm the keys still exist in the data.
 */
type Concept = { synonyms: string[]; related?: string[] }

export const CONCEPTS: Record<string, Concept> = {
  'hair loss':    { synonyms: ['thinning hair', 'hair thinning', 'balding', 'hair fall', 'receding', 'hair loss'], related: ['hair growth'] },
  'hair growth':  { synonyms: ['regrow', 'regrowth', 'hair regrowth', 'thicker hair'] },
  'activewear':   { synonyms: ['active wear', 'gym wear', 'gymwear', 'athleisure', 'workout clothes', 'athletic wear', 'athleticwear', 'sportswear'], related: ['leggings'] },
  'leggings':     { synonyms: ['legging', 'yoga pants'] },
  'weight loss':  { synonyms: ['fat loss', 'slimming', 'lose weight', 'weight management', 'glp-1'], related: ['fitness'] },
  'testosterone': { synonyms: ['low testosterone', 'low t', 'test booster', 'testosterone booster'], related: ['energy'] },
  'erectile dysfunction': { synonyms: ['ed', 'erectile', 'sexual performance'], related: ['testosterone', 'intimacy'] },
  'supplement':   { synonyms: ['supplements', 'vitamins', 'vitamin', 'capsules', 'gummies'] },
  'sleep':        { synonyms: ['insomnia', 'sleep aid', 'better sleep'], related: ['recovery'] },
  'skincare':     { synonyms: ['skin care', 'serum', 'moisturizer', 'skin routine'], related: ['collagen', 'anti-aging'] },
  'anti-aging':   { synonyms: ['antiaging', 'wrinkles', 'fine lines', 'aging skin'], related: ['collagen'] },
  "men's health": { synonyms: ['mens health'], related: ['testosterone', 'hair loss', 'erectile dysfunction'] },
  "women's health": { synonyms: ['womens health'], related: ['intimacy'] },
  'protein':      { synonyms: ['protein powder', 'protein shake'] },
  'gut health':   { synonyms: ['bloating', 'digestion', 'digestive'], related: ['supplement'] },
}

// Reverse index: any synonym OR canonical key → its canonical concept name.
const SYN_TO_CANON: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [canon, c] of Object.entries(CONCEPTS)) {
    m[canon] = canon
    for (const s of c.synonyms) m[s] = canon
  }
  return m
})()

const norm = (s: string) => s.replace(/[,(){}]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

export type Expansion = {
  synonymTags: Set<string>  // same concept (canonical + its synonyms) → ranked tier 2
  relatedTags: Set<string>  // related concepts (canonical + their synonyms) → ranked tier 4
  hit: boolean              // did the query map to any known concept?
}

/** Map a free-text query to its same-concept and related-concept tag sets. */
export function expandQuery(q: string): Expansion {
  const synonymTags = new Set<string>()
  const relatedTags = new Set<string>()
  const lc = norm(q)
  const compound = lc.replace(/\s+/g, '')

  const concepts = new Set<string>()
  for (const [key, canon] of Object.entries(SYN_TO_CANON)) {
    const keyCompound = key.replace(/\s+/g, '')
    if (key === lc || keyCompound === compound) concepts.add(canon)
  }

  Array.from(concepts).forEach(canon => {
    synonymTags.add(canon)
    for (const s of CONCEPTS[canon].synonyms) synonymTags.add(s)
    for (const rel of CONCEPTS[canon].related || []) {
      relatedTags.add(rel)
      for (const s of (CONCEPTS[rel]?.synonyms || [])) relatedTags.add(s)
    }
  })
  // related shouldn't also live in the same-concept set
  Array.from(relatedTags).forEach(t => { if (synonymTags.has(t)) relatedTags.delete(t) })
  return { synonymTags, relatedTags, hit: concepts.size > 0 }
}

/**
 * Match-tier weight for the 'recommended' sort. Large gaps so the TIER dominates,
 * with qualityScore (≈0–11) ordering WITHIN a tier. Checked high→low so the
 * strongest applicable tier wins:
 *   literal copy 400 > exact tag 350 > same-concept tag 300 > keyword tag 200
 *   > misc OR-match 150 > related-concept tag 100 > semantic 0
 * Related (problem→solution union) sits LOW on purpose: solution ads surface but
 * never crowd out the on-point problem ads.
 */
function adTags(ad: any): string[] {
  return [...(ad.topics || []), ...(ad.brand_categories || []), ...(ad.industries || [])].map((t: any) => String(t).toLowerCase())
}
function inCopy(ad: any, lcQuery: string): boolean {
  return [ad.body, ad.title, ad.description, ad.page_name].some((f: any) => String(f || '').toLowerCase().includes(lcQuery))
}

export function matchTierWeight(ad: any, lcQuery: string, exp: Expansion): number {
  if (ad._semantic) return 0
  if (inCopy(ad, lcQuery)) return 400
  const tags = adTags(ad)
  if (tags.some(t => t === lcQuery)) return 350
  if (tags.some(t => exp.synonymTags.has(t))) return 300
  if (tags.some(t => t.includes(lcQuery) || lcQuery.includes(t))) return 200
  if (tags.some(t => exp.relatedTags.has(t))) return 100
  return 150  // matched the DB OR some other way (per-word) — between keyword and related
}

export function matchTierReason(ad: any, lcQuery: string, exp: Expansion):
  'literal' | 'exact_tag' | 'synonym' | 'keyword' | 'related' | 'semantic' {
  if (ad._semantic) return 'semantic'
  if (inCopy(ad, lcQuery)) return 'literal'
  const tags = adTags(ad)
  if (tags.some(t => t === lcQuery)) return 'exact_tag'
  if (tags.some(t => exp.synonymTags.has(t))) return 'synonym'
  if (tags.some(t => t.includes(lcQuery) || lcQuery.includes(t))) return 'keyword'
  if (tags.some(t => exp.relatedTags.has(t))) return 'related'
  return 'keyword'
}
