/**
 * Creative Strategist — the "what to make next" employee. It sits between two things you already track
 * and answers the question a founder asks every week:
 *   - YOUR account (Meta audit): which ad is WINNING (make more of that angle) and which is FATIGUING /
 *     bleeding (needs a fresh replacement soon).
 *   - THE MARKET (Brand Spy): the angle rivals keep paying to run (long-running + many variants = it
 *     converts).
 * It fuses both into 1–3 concrete "make this next" ideas, each grounded in a real signal, each one click
 * into the Studio. Read-only + advisory: it drafts the idea; nothing spends until the founder approves a
 * budget. Reasoned via the model with a deterministic fallback so it always returns something useful.
 */
import { auditAccount } from '@/lib/meta/audit'
import { getCompetitorWinners, type CompetitorWinner } from '@/lib/meta/competitor-winners'

export type CreativeIdea = {
  title: string          // "Testimonial video for your Summer Bundle"
  format: string         // "UGC testimonial video" | "static offer" | "founder talking-head" …
  why: string            // grounded reason — cites the real signal (your fatigue + the rival win)
  basedOn: 'fatigue' | 'winner' | 'competitor'
  reference: { kind: 'competitor' | 'ours'; label: string; brand?: string; image?: string | null } | null
  priority: 'high' | 'med' | 'low'
  studioHref: string     // one click to start making it
}
export type CreativeStrategy = {
  summary: string
  ideas: CreativeIdea[]
  reasoned: boolean
  generatedAt: string
}

/** The Studio deep-link. When the idea is a faithful rebuild of a rival ad we seed that ad (the remake
 *  flow, same as "Make it mine"). Otherwise we open the studio FRESH but carry the idea's angle so it's
 *  never blank — the angle field prefills from ?angle=. `ref` is set ONLY for a genuine clone. */
function studioHref(ref: CompetitorWinner | null, angle: string): string {
  const q = new URLSearchParams()
  if (ref) {
    q.set('ad', ref.adId); q.set('brand', ref.brandName)
    if (ref.image) q.set('img', ref.image)
    if (ref.isVideo) { q.set('type', 'video'); if (ref.videoUrl) q.set('vid', ref.videoUrl) }
  }
  const a = angle.replace(/\s+/g, ' ').trim().slice(0, 160)
  if (a) q.set('angle', a)
  const qs = q.toString()
  return qs ? `/studio?${qs}` : '/studio?studio=1'
}

/** Deterministic ideas straight from the signals — the always-works fallback (no model). */
function fallbackIdeas(ourWinner: any, fatigue: any, rivals: CompetitorWinner[]): CreativeIdea[] {
  const ideas: CreativeIdea[] = []
  if (fatigue) {
    const angle = `Fresh creative for “${fatigue.name}”, same offer`
    ideas.push({
      title: `Fresh version of “${fatigue.name}”`,
      format: 'new creative, same offer',
      why: `“${fatigue.name}” is tiring out (${fatigue.roas}x ROAS, your audience has seen it too often). A fresh creative on the same offer resets your cost before it bleeds.`,
      basedOn: 'fatigue', reference: { kind: 'ours', label: fatigue.name, image: null }, priority: 'high', studioHref: studioHref(null, angle),
    })
  }
  if (ourWinner) {
    const angle = `New variant of “${ourWinner.name}” — new hook, same winning angle`
    ideas.push({
      title: `More variants of “${ourWinner.name}”`,
      format: 'variant batch',
      why: `“${ourWinner.name}” is your best performer (${ourWinner.roas}x). Spin 3–4 variants (new hook, new opener) to scale the angle that already works for you.`,
      basedOn: 'winner', reference: { kind: 'ours', label: ourWinner.name, image: null }, priority: 'med', studioHref: studioHref(null, angle),
    })
  }
  const r = rivals[0]
  if (r) {
    // A genuine clone of THIS rival ad → seed the remake flow with it (image shown, ad seeded).
    ideas.push({
      title: `Rebuild ${r.brandName}’s winning angle for your brand`,
      format: r.isVideo ? 'video' : 'static',
      why: `${r.brandName} has run this ${r.daysRunning} days${r.variants > 1 ? ` across ${r.variants} variants` : ''} — strong evidence it converts. Rebuild the concept with your product.`,
      basedOn: 'competitor', reference: { kind: 'competitor', label: r.title || 'their winning ad', brand: r.brandName, image: r.image }, priority: 'med', studioHref: studioHref(r, `Rebuild of ${r.brandName}’s winning ad`),
    })
  }
  return ideas.slice(0, 3)
}

/** The model fuses our performance + rival angles into sharp, specific ideas. Null on any failure. */
async function reasonedIdeas(ourWinner: any, fatigue: any, rivals: CompetitorWinner[], brand: string): Promise<CreativeIdea[] | null> {
  if (!process.env.OPENAI_API_KEY) return null
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const rivalLines = rivals.slice(0, 5).map((r, i) => `${i + 1}. ${r.brandName}: "${r.title || r.hook || 'ad'}" — ${r.isVideo ? 'video' : 'static'}, live ${r.daysRunning}d, ${r.variants} variant(s)`).join('\n')
  const system = `You are the Creative Strategist for ${brand || 'a small e-commerce brand'}. Decide what ad to MAKE NEXT, grounded ONLY in the signals below. Fuse the two sides: what's working/tiring in THIS account, and the angles rivals keep paying to run.
Your account:
- Best performer: ${ourWinner ? `"${ourWinner.name}" (${ourWinner.roas}x ROAS)` : 'unknown'}
- Fatiguing / bleeding: ${fatigue ? `"${fatigue.name}" (${fatigue.roas}x ROAS)` : 'none flagged'}
Rivals' winning ads (public signal — long run + many variants ≈ it converts):
${rivalLines || '(none spied yet)'}

Give 1–3 specific, buildable ideas. For each: a concrete title, the format (UGC video, testimonial, static offer, founder talking-head…), and a WHY that cites the real signal (name the fatiguing ad or the rival). Prioritise: replacing a fatiguing winner = high; a proven rival angle = med; more variants of a winner = med.
"rivalIndex" = the 1-based index of the single rival this idea draws on, or 0 if none.
"cloneRivalAd" = true ONLY when the idea is a faithful REBUILD of that ONE specific rival ad (we'd clone it directly). Set false when it's a NEW creative in a proven format/angle (even if rivals inspired it) or an idea for your own brand — those get built fresh, not cloned.
Return ONLY JSON: {"ideas":[{"title","format","why","basedOn":"fatigue|winner|competitor","priority":"high|med|low","rivalIndex": <int>,"cloneRivalAd": <bool>}]}. No prose.`
  try {
    const resp = await openai.chat.completions.create({
      model, temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: 'What should I make next?' }],
    })
    const parsed = JSON.parse(String(resp.choices?.[0]?.message?.content || '{}'))
    const arr = Array.isArray(parsed?.ideas) ? parsed.ideas : []
    const ideas: CreativeIdea[] = arr.map((it: any) => {
      const ri = Math.round(Number(it.rivalIndex) || 0)
      const rival = ri >= 1 && ri <= rivals.length ? rivals[ri - 1] : null
      const basedOn = (['fatigue', 'winner', 'competitor'].includes(it.basedOn) ? it.basedOn : (rival ? 'competitor' : 'winner')) as CreativeIdea['basedOn']
      const title = String(it.title || '').slice(0, 100)
      const format = String(it.format || '').slice(0, 60)
      // TWO separate things (don't conflate):
      //  • seedRef → the exact rival ad we CLONE into the Studio. Only for a faithful clone, else a
      //    mismatched ad would open in the remake flow.
      //  • refRival → the rival thumbnail we SHOW on the card as inspiration. Fine for any competitor
      //    idea (matched rival, else the top rival) so the card looks alive instead of a blank clapperboard.
      const seedRef = (it.cloneRivalAd === true && rival) ? rival : null
      const refRival = rival || (basedOn === 'competitor' ? rivals[0] || null : null)
      const angle = [title, format].filter(Boolean).join(' — ')
      // Own-account ideas name YOUR ad; competitor ideas show the rival's thumbnail as the inspiration.
      const reference: CreativeIdea['reference'] =
        seedRef ? { kind: 'competitor', label: seedRef.title || 'their winning ad', brand: seedRef.brandName, image: seedRef.image }
        : (fatigue && basedOn === 'fatigue') ? { kind: 'ours', label: fatigue.name, image: null }
        : (ourWinner && basedOn === 'winner') ? { kind: 'ours', label: ourWinner.name, image: null }
        : refRival ? { kind: 'competitor', label: `inspired by ${refRival.brandName}`, brand: refRival.brandName, image: refRival.image }
        : null
      return {
        title, format, why: String(it.why || '').slice(0, 320), basedOn, reference,
        priority: (['high', 'med', 'low'].includes(it.priority) ? it.priority : 'med') as CreativeIdea['priority'],
        // Seed the rival ad for ANY competitor idea (seedRef=clone, else refRival=inspiration) so "Make it"
        // opens the Studio pre-filled with that ad's reference — not a blank studio. Own-brand ideas
        // (fatigue/winner) have no rival ref → open fresh with the angle prefilled.
        studioHref: studioHref(seedRef || refRival, angle),
      }
    }).filter((i: CreativeIdea) => i.title && i.why)
    return ideas.length ? ideas.slice(0, 3) : null
  } catch { return null }
}

/** Winner + bleeder from STORED campaign data (campaigns + campaign_insights) — the fallback when the live
 *  Meta audit can't run (expired token / no Graph). Shapes match the audit's Graded ({ name, roas }). */
async function storedPerformance(admin: any, userId: string, metaAccountRowId?: string | null): Promise<{ winner: any; bleeder: any }> {
  let cq = admin.from('campaigns').select('id, name, status').eq('user_id', userId).eq('status', 'ACTIVE')
  if (metaAccountRowId) cq = cq.eq('meta_account_id', metaAccountRowId)   // brand-scope (campaigns.meta_account_id → meta_accounts.id)
  const { data: camps } = await cq.limit(300)
  const list = (camps || []) as any[]
  if (!list.length) return { winner: null, bleeder: null }
  const byId: Record<string, any> = {}; for (const c of list) byId[c.id] = c
  const { data: ins } = await admin.from('campaign_insights').select('campaign_id, roas, spend').in('campaign_id', list.map(c => c.id))
  const rows = (ins || []).filter((r: any) => byId[r.campaign_id] && Number(r.spend) > 0)
    .map((r: any) => ({ name: byId[r.campaign_id].name, roas: Math.round((Number(r.roas) || 0) * 100) / 100, spend: Number(r.spend) || 0 }))
  if (!rows.length) return { winner: null, bleeder: null }
  const byRoas = [...rows].sort((a, b) => b.roas - a.roas)
  const winner = byRoas[0]
  const bleeder = byRoas[byRoas.length - 1]
  return { winner, bleeder: (bleeder && bleeder.name !== winner.name) ? bleeder : null }
}

/** Lenient rivals — when the scored winners engine returns nothing, pull the brand's spied competitors'
 *  top ads (with media) directly, so we still have competitor material to build ideas from. */
async function lenientRivals(admin: any, userId: string, brandId?: string | null): Promise<CompetitorWinner[]> {
  let fq = admin.from('followed_brands').select('page_id, brand_name').eq('user_id', userId).eq('spied', true)
  if (brandId) fq = fq.eq('brand_id', brandId)
  const { data: follows } = await fq.limit(10)
  const rivals = (follows || []).filter((f: any) => f.page_id)
  const out: CompetitorWinner[] = []
  for (const f of rivals) {
    try {
      const { data: ads } = await admin.from('discovery_ads_index')
        .select('ad_id, page_id, title, hook_type, days_running, is_active, discovery_creatives(asset_type, r2_url, poster_url)')
        .eq('page_id', f.page_id).order('days_running', { ascending: false, nullsFirst: false }).limit(8)
      for (const a of (ads || [])) {
        const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
        const vid = cres.find((c: any) => c?.asset_type === 'video' && c?.r2_url)
        const img = cres.find((c: any) => c?.asset_type !== 'video' && c?.r2_url)
        const isVideo = !!vid && !img
        const image = isVideo ? (vid?.poster_url || null) : (img?.r2_url || vid?.poster_url || null)
        if (!image) continue
        const days = Number(a.days_running) || 0
        out.push({ adId: String(a.ad_id), pageId: String(a.page_id), brandName: f.brand_name || 'Competitor', title: a.title || null, hook: a.hook_type || null, daysRunning: days, variants: 1, isActive: !!a.is_active, isVideo, image, videoUrl: isVideo ? (vid?.r2_url || null) : null, why: `${a.is_active ? 'Live' : 'Ran'} ${days} days — a proven angle worth rebuilding.` })
        if (out.length >= 5) break
      }
    } catch { /* skip */ }
    if (out.length >= 5) break
  }
  return out
}

/** A deterministic "rebuild this rival's winning ad" idea (seeds the Studio with that ad). */
function competitorIdea(r: CompetitorWinner): CreativeIdea {
  const angleName = r.title || r.hook || 'winning angle'
  return {
    title: `Rebuild ${r.brandName}’s “${String(angleName).slice(0, 40)}”`,
    format: r.isVideo ? 'video' : 'static',
    why: `${r.brandName} has run this ${r.daysRunning} days — strong evidence it converts. Rebuild the concept with your product.`,
    basedOn: 'competitor',
    reference: { kind: 'competitor', label: `inspired by ${r.brandName}`, brand: r.brandName, image: r.image },
    priority: 'med',
    studioHref: studioHref(r, `Rebuild of ${r.brandName}’s winning ad`),
  }
}

export async function generateCreativeStrategy(admin: any, userId: string, opts: { accountId?: string; brand?: string; brandId?: string | null } = {}): Promise<CreativeStrategy> {
  // Our account signal (cached server-side — no extra Graph hit on repeat opens).
  let ourWinner: any = null, fatigue: any = null, ownAds: any[] = []
  // When a SPECIFIC brand is active but it has no linked ad account, we must NOT borrow the primary
  // account's ads/performance — that leaked another brand's creatives (e.g. Hair ResQ showed the
  // nicotine brand's ad thumbnails + its 6.9x ROAS). In that case the "your ads" half stays empty and
  // ideas come purely from the brand's competitors.
  let brandHasNoAccount = false
  // The brand's ad-account row id (meta_accounts.id) — used to scope the STORED-campaign fallback to this
  // brand's account only, so a brand whose live audit is empty doesn't borrow another brand's campaigns.
  let brandAccountRowId: string | null = null
  try {
    // Resolve the brand's LINKED ad account (same as the Facebook card) so we audit Aura's account — not
    // just the primary — and get its real ad thumbnails to show on the your-ads ideas.
    let accountId = opts.accountId
    if (!accountId && opts.brandId) {
      const { data: acct } = await admin.from('meta_accounts').select('id, account_id').eq('user_id', userId).eq('status', 'active').eq('brand_id', opts.brandId).limit(1).maybeSingle()
      if (acct?.account_id) { accountId = acct.account_id; brandAccountRowId = acct.id }
      else brandHasNoAccount = true   // active brand with no account of its own → don't fall back to the primary
    }
    const audit = brandHasNoAccount ? null : await auditAccount(admin, userId, accountId)
    if (audit) {
      ourWinner = (audit.scale || [])[0] || (audit.watch || [])[0] || null
      // "Fatigue" proxy from the audit: the pause bucket (bleeding), else the lowest-ROAS spender.
      fatigue = (audit.pause || [])[0] || [...(audit.watch || [])].sort((a: any, b: any) => a.roas - b.roas)[0] || null
      if (ourWinner && fatigue && ourWinner.name === fatigue.name) fatigue = (audit.pause || [])[1] || null
      ownAds = Array.isArray((audit as any).ads) ? (audit as any).ads : []
    }
  } catch { /* account signal is best-effort */ }
  // Fallback to STORED campaign performance when the live audit is empty/failing (expired token, no Graph):
  // the whole point is "your ads + rivals", so we must not silently drop the your-ads half.
  if (!ourWinner && !fatigue && !brandHasNoAccount) {
    try {
      // Scope to THIS brand's account (brandAccountRowId) when a brand is active — otherwise the stored
      // fallback pulled campaigns across every account the founder owns (cross-brand leak).
      const stored = await storedPerformance(admin, userId, brandAccountRowId)
      ourWinner = stored.winner; fatigue = stored.bleeder
    } catch { /* ok */ }
  }

  let rivals = await getCompetitorWinners(admin, userId, { poolSize: 6, brandId: opts.brandId })
  // Need at least 2 rivals to compose 2 competitor ideas. getCompetitorWinners returns one hero PER brand,
  // so with a single competitor it returns 1 — supplement with that brand's other top ads (distinct adIds).
  if (rivals.length < 2) {
    try {
      const extra = await lenientRivals(admin, userId, opts.brandId)
      const seen = new Set(rivals.map(r => r.adId))
      for (const e of extra) { if (!seen.has(e.adId)) { rivals.push(e); seen.add(e.adId) } }
    } catch { /* ok */ }
  }

  // Resolve the ACTIVE brand's name (opts.brandId) so ideas are titled/grounded for the brand the
  // founder is viewing (e.g. Aura) — NOT the oldest brand (the old fallback grabbed the wrong brand,
  // e.g. 'Mars Men', while viewing Aura). Only fall back to the first brand when no brand is active.
  let brand = opts.brand || ''
  if (!brand) {
    try {
      const bq = opts.brandId
        ? admin.from('brands').select('name').eq('id', opts.brandId).maybeSingle()
        : admin.from('brands').select('name').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
      const { data } = await bq; brand = data?.name || ''
    } catch { /* ok */ }
  }

  // A representative visual for own-account ideas (no rival thumbnail) — the brand's most recent finished
  // creative, so those cards show a real image instead of the empty clapperboard.
  let ownVisual: string | null = null
  try {
    let cq = admin.from('creative_generations').select('image_url, media_type').eq('user_id', userId).eq('status', 'done').not('image_url', 'is', null).order('created_at', { ascending: false }).limit(8)
    if (opts.brandId) cq = cq.eq('brand_id', opts.brandId)
    const { data } = await cq
    ownVisual = ((data || []).find((c: any) => c.media_type !== 'video' && c.image_url)?.image_url) || null
  } catch { /* best-effort */ }

  // Race the model against a hard 35s budget. MELLO_MODEL can point at a slow reasoning model, which
  // blew the whole endpoint past its function cap (504 → the card silently vanished). On timeout we fall
  // back to deterministic competitor/own ideas — the card ALWAYS returns fast, still brand-grounded.
  const reasoned = (ourWinner || fatigue || rivals.length)
    ? await Promise.race([
        reasonedIdeas(ourWinner, fatigue, rivals, brand).catch(() => null),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 35000)),
      ])
    : null
  let ideas = reasoned || fallbackIdeas(ourWinner, fatigue, rivals)
  // Guarantee the "your ads" half is represented when we have the signal — the model sometimes returns
  // only rival ideas. Prepend a deterministic own-account idea (replace-a-tiring / scale-a-winner) if none.
  if ((ourWinner || fatigue) && !ideas.some(i => i.basedOn === 'fatigue' || i.basedOn === 'winner')) {
    const own = fallbackIdeas(ourWinner, fatigue, []).find(Boolean)
    if (own) ideas = [own, ...ideas].slice(0, 3)
  }
  // Give own-account ideas a visual: the ACTUAL ad thumbnail for that campaign (Alisba 5 → its creative),
  // else the brand's most recent creative — so no card is a bare clapperboard.
  const adThumbFor = (name?: string): string | null => {
    if (!ownAds.length) return null
    const match = name ? ownAds.find((a: any) => a.thumbnail_url && a.campaignName && String(a.campaignName).toLowerCase() === String(name).toLowerCase()) : null
    return match?.thumbnail_url || ownAds.find((a: any) => a.thumbnail_url)?.thumbnail_url || null
  }
  ideas = ideas.map(i => {
    if (i.reference && i.reference.kind === 'ours') {
      const img = i.reference.image || adThumbFor(i.reference.label) || ownVisual
      if (img) {
        // Seed the Studio with YOUR OWN winning creative so "Make it →" opens with your ad loaded to
        // riff on — not a blank create form. Uses the asset-remake path (src=asset+img), the same
        // reference-seeded flow the competitor "Make it mine" uses, but pointed at your own creative.
        const angle = new URLSearchParams((i.studioHref.split('?')[1] || '')).get('angle') || ''
        const q = new URLSearchParams({ src: 'asset', img })
        if (brand) q.set('brand', brand)
        if (angle) q.set('angle', angle)
        return { ...i, reference: { ...i.reference, image: img }, studioHref: `/studio?${q.toString()}` }
      }
    }
    return i
  })

  // Enforce the mix the founder wants: 2 competitor + 1 own when we have rival material — so it's genuinely
  // "your ads + rivals", not three variations of your own campaign.
  if (rivals.length) {
    const ownI = ideas.filter(i => i.basedOn === 'fatigue' || i.basedOn === 'winner')
    const compI = ideas.filter(i => i.basedOn === 'competitor')
    // Backfill from distinct rival ADS (by adId) — dedup by brand would stop at 1 when there's a single
    // competitor, so we could never reach 2 competitor ideas from one rival's multiple winning ads.
    const usedAdIds = new Set<string>()
    for (const r of rivals) {
      if (compI.length >= 2) break
      if (usedAdIds.has(r.adId)) continue
      usedAdIds.add(r.adId)
      compI.push(competitorIdea(r))
    }
    const composed = [...compI.slice(0, 2), ...ownI.slice(0, 1)]
    for (const extra of [...ownI.slice(1), ...compI.slice(2)]) { if (composed.length >= 3) break; composed.push(extra) }
    if (composed.length) ideas = composed.slice(0, 3)
  }

  const summary = ideas.length === 0
    ? (rivals.length === 0 ? 'Spy a competitor or two and connect your ad account — then I’ll tell you exactly what to make next.' : 'Nothing urgent to make right now — your account looks steady.')
    : `${ideas.length} idea${ideas.length === 1 ? '' : 's'} for what to make next, from your ad performance${rivals.length ? ' + what rivals are winning with' : ''}.`

  return { summary, ideas, reasoned: !!reasoned, generatedAt: new Date().toISOString() }
}
