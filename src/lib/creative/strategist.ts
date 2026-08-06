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
        studioHref: studioHref(seedRef, angle),
      }
    }).filter((i: CreativeIdea) => i.title && i.why)
    return ideas.length ? ideas.slice(0, 3) : null
  } catch { return null }
}

/** Winner + bleeder from STORED campaign data (campaigns + campaign_insights) — the fallback when the live
 *  Meta audit can't run (expired token / no Graph). Shapes match the audit's Graded ({ name, roas }). */
async function storedPerformance(admin: any, userId: string): Promise<{ winner: any; bleeder: any }> {
  const { data: camps } = await admin.from('campaigns').select('id, name, status').eq('user_id', userId).eq('status', 'ACTIVE').limit(300)
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

export async function generateCreativeStrategy(admin: any, userId: string, opts: { accountId?: string; brand?: string; brandId?: string | null } = {}): Promise<CreativeStrategy> {
  // Our account signal (cached server-side — no extra Graph hit on repeat opens).
  let ourWinner: any = null, fatigue: any = null
  try {
    const audit = await auditAccount(admin, userId, opts.accountId)
    if (audit) {
      ourWinner = (audit.scale || [])[0] || (audit.watch || [])[0] || null
      // "Fatigue" proxy from the audit: the pause bucket (bleeding), else the lowest-ROAS spender.
      fatigue = (audit.pause || [])[0] || [...(audit.watch || [])].sort((a: any, b: any) => a.roas - b.roas)[0] || null
      if (ourWinner && fatigue && ourWinner.name === fatigue.name) fatigue = (audit.pause || [])[1] || null
    }
  } catch { /* account signal is best-effort */ }
  // Fallback to STORED campaign performance when the live audit is empty/failing (expired token, no Graph):
  // the whole point is "your ads + rivals", so we must not silently drop the your-ads half.
  if (!ourWinner && !fatigue) {
    try {
      const stored = await storedPerformance(admin, userId)
      ourWinner = stored.winner; fatigue = stored.bleeder
    } catch { /* ok */ }
  }

  const rivals = await getCompetitorWinners(admin, userId, { poolSize: 6, brandId: opts.brandId })

  let brand = opts.brand || ''
  if (!brand) { try { const { data } = await admin.from('brands').select('name').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle(); brand = data?.name || '' } catch { /* ok */ } }

  // A representative visual for own-account ideas (no rival thumbnail) — the brand's most recent finished
  // creative, so those cards show a real image instead of the empty clapperboard.
  let ownVisual: string | null = null
  try {
    let cq = admin.from('creative_generations').select('image_url, media_type').eq('user_id', userId).eq('status', 'done').not('image_url', 'is', null).order('created_at', { ascending: false }).limit(8)
    if (opts.brandId) cq = cq.eq('brand_id', opts.brandId)
    const { data } = await cq
    ownVisual = ((data || []).find((c: any) => c.media_type !== 'video' && c.image_url)?.image_url) || null
  } catch { /* best-effort */ }

  const reasoned = (ourWinner || fatigue || rivals.length) ? await reasonedIdeas(ourWinner, fatigue, rivals, brand) : null
  let ideas = reasoned || fallbackIdeas(ourWinner, fatigue, rivals)
  // Guarantee the "your ads" half is represented when we have the signal — the model sometimes returns
  // only rival ideas. Prepend a deterministic own-account idea (replace-a-tiring / scale-a-winner) if none.
  if ((ourWinner || fatigue) && !ideas.some(i => i.basedOn === 'fatigue' || i.basedOn === 'winner')) {
    const own = fallbackIdeas(ourWinner, fatigue, []).find(Boolean)
    if (own) ideas = [own, ...ideas].slice(0, 3)
  }
  // Give own-account ideas a visual (their reference has no image) so no card is a bare clapperboard.
  if (ownVisual) ideas = ideas.map(i => (i.reference && i.reference.kind === 'ours' && !i.reference.image) ? { ...i, reference: { ...i.reference, image: ownVisual } } : i)

  const summary = ideas.length === 0
    ? (rivals.length === 0 ? 'Spy a competitor or two and connect your ad account — then I’ll tell you exactly what to make next.' : 'Nothing urgent to make right now — your account looks steady.')
    : `${ideas.length} idea${ideas.length === 1 ? '' : 's'} for what to make next, from your ad performance${rivals.length ? ' + what rivals are winning with' : ''}.`

  return { summary, ideas, reasoned: !!reasoned, generatedAt: new Date().toISOString() }
}
