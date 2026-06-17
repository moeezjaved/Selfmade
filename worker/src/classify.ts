/**
 * Lightweight, no-AI classification of an ad from its text + payload.
 *
 * Runs at index time so the Discovery filters (Industry / Theme / Platform) are
 * backed by real, server-filterable columns — instead of being guessed live in
 * the browser over only the 40 ads on screen.
 *
 * Mirrors the regex tables in the Discovery UI so the values match the filter
 * options exactly. Keep the two in sync.
 */

const INDUSTRY_KEYWORDS: [string, RegExp][] = [
  ['Apparel & Accessories',   /cloth|fashion|dress|shoes|apparel|outfit|hoodie|jeans|bag|purse|handbag|accessori|shirt|jacket|pants|skirt/i],
  ['Beauty & Personal Care',  /beauty|skincare|makeup|cosmetic|serum|moistur|lipstick|mascara|cream|lotion|facial|glow|anti-ag|fragrance|perfume|cleanser|toner/i],
  ['Baby, Kids & Maternity',  /baby|toddler|kids|children|infant|maternity|pregnant|nursery|diaper|stroller/i],
  ['Food & Beverage',         /food|meal|recipe|restaurant|delivery|snack|drink|coffee|tea|juice|beverage|cuisine|chef|cook|chocolate|candy/i],
  ['Health & Fitness',        /fitness|gym|workout|weight loss|exercise|yoga|pilates|health|wellness|diet|supplement|vitamin|protein|keto|testosterone|hormone|men'?s health|telehealth/i],
  ['Electronics & Technology',/tech|software|app|device|phone|laptop|computer|electronic|gadget|digital|smart|wireless|battery/i],
  ['Finance & Insurance',     /financ|insur|invest|loan|credit|banking|money|wealth|trading|crypto|tax|mortgage|fund/i],
  ['Home & Garden',           /home|furniture|decor|garden|kitchen|bedroom|clean|interior|house|living room|sofa|rug|curtain/i],
  ['Travel & Tourism',        /travel|hotel|flight|vacation|holiday|tour|destination|trip|resort|cruise|airbnb/i],
  ['Pets',                    /\bpet\b|dog|cat|puppy|kitten|animal|vet|paw|leash|collar|bird|fish tank/i],
  ['Education',               /course|learn|education|training|skill|class|university|degree|certif|bootcamp/i],
  ['Real Estate',             /real estate|property|apartment|rent|buy home|mortgage|listing|realty|condo/i],
  ['Jewelry & Watches',       /jewelry|jewellery|ring|necklace|bracelet|watch|diamond|gold|silver|gem|pendant/i],
  ['Sports & Outdoors',       /sport|outdoor|hiking|camping|running|cycling|tennis|golf|soccer|football|athletic|basketball/i],
  ['Business Services',       /\bbusiness\b|marketing|agency|consult|b2b|enterprise|saas|crm|erp|automation|lead gen/i],
  ['E-Commerce',              /shop now|add to cart|order now|free shipping|buy \d|get yours|limited stock/i],
  ['Charity & NGO',           /charity|nonprofit|donate|ngo|cause|foundation|volunteer|relief/i],
]

const THEME_PATTERNS: [string, RegExp][] = [
  ['Before & After',  /before[\s\S]{0,60}after|after[\s\S]{0,60}before|transformation|results in \d|see the results/i],
  ['Question',        /\?/],
  ['Testimonial',     /\bi (was|tried|used|am|have been|love|hate|switched|started)\b|changed my|my experience|customer says|they said|she said|he said/i],
  ['Announcement',    /introducing|we'?re launching|just dropped|announcing|now available|coming soon|new arrival|meet the new/i],
  ['Sale/Discount',   /\d+\s*%\s*off|\bsale\b|discount|bogo|deal|save \$|free shipping|limited time|offer ends|coupon|promo/i],
  ['Pain Point',      /struggling|tired of|sick of|problem|solution|fix|stop suffering|never again|hate when|can'?t sleep|hard to/i],
  ['Tutorial',        /how to|step \d|tutorial|guide|learn how|\btip\b|\btricks?\b|what happens when|watch us/i],
  ['Social Proof',    /\d[\d,]+\s*(customer|review|sold|people|order|unit)|trusted by|join \d|rated \d|#1|best seller|award/i],
  ['UGC / Review',    /unboxing|honest review|i bought|first impression|worth it|would i recommend|rating/i],
]

export function detectIndustries(text: string): string[] {
  if (!text) return []
  // Score each industry by how many keyword hits it gets, then keep only the
  // STRONGEST. A long ad mentions many words incidentally ("gold", "travel"),
  // so taking every match tagged Mars Men as Jewelry/Travel/etc. We return the
  // leader, plus a runner-up only if it's a genuine tie (within 1 hit).
  const scored = INDUSTRY_KEYWORDS
    .map(([name, re]) => {
      const m = text.match(new RegExp(re.source, 'gi'))
      return [name, m ? m.length : 0] as [string, number]
    })
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  if (scored.length === 0) return []
  const out = [scored[0][0]]
  if (scored[1] && scored[1][1] >= scored[0][1] - 1 && scored[1][1] >= 2) out.push(scored[1][0])
  return out
}

export function detectThemes(text: string): string[] {
  if (!text) return []
  return THEME_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

/** publisher_platform comes uppercase (FACEBOOK); the UI filters on lowercase. */
export function normalizePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.map((p) => String(p).toLowerCase()).filter(Boolean)))
}
