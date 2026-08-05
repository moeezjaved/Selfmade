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

/** The Studio deep-link — seeded with a competitor ad when the idea is built off one (same as "Make it mine"). */
function studioHref(ref?: CompetitorWinner | null): string {
  if (!ref) return '/studio?studio=1'
  const q = new URLSearchParams({ ad: ref.adId, brand: ref.brandName })
  if (ref.image) q.set('img', ref.image)
  if (ref.isVideo) { q.set('type', 'video'); if (ref.videoUrl) q.set('vid', ref.videoUrl) }
  return `/studio?${q.toString()}`
}

/** Deterministic ideas straight from the signals — the always-works fallback (no model). */
function fallbackIdeas(ourWinner: any, fatigue: any, rivals: CompetitorWinner[]): CreativeIdea[] {
  const ideas: CreativeIdea[] = []
  if (fatigue) {
    ideas.push({
      title: `Fresh version of “${fatigue.name}”`,
      format: 'new creative, same offer',
      why: `“${fatigue.name}” is tiring out (${fatigue.roas}x ROAS, your audience has seen it too often). A fresh creative on the same offer resets your cost before it bleeds.`,
      basedOn: 'fatigue', reference: { kind: 'ours', label: fatigue.name }, priority: 'high', studioHref: studioHref(null),
    })
  }
  if (ourWinner) {
    ideas.push({
      title: `More variants of “${ourWinner.name}”`,
      format: 'variant batch',
      why: `“${ourWinner.name}” is your best performer (${ourWinner.roas}x). Spin 3–4 variants (new hook, new opener) to scale the angle that already works for you.`,
      basedOn: 'winner', reference: { kind: 'ours', label: ourWinner.name }, priority: 'med', studioHref: studioHref(null),
    })
  }
  const r = rivals[0]
  if (r) {
    ideas.push({
      title: `Rebuild ${r.brandName}’s winning angle for your brand`,
      format: r.isVideo ? 'video' : 'static',
      why: `${r.brandName} has run this ${r.daysRunning} days${r.variants > 1 ? ` across ${r.variants} variants` : ''} — strong evidence it converts. Rebuild the concept with your product.`,
      basedOn: 'competitor', reference: { kind: 'competitor', label: r.title || 'their winning ad', brand: r.brandName, image: r.image }, priority: 'med', studioHref: studioHref(r),
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
Return ONLY JSON: {"ideas":[{"title","format","why","basedOn":"fatigue|winner|competitor","priority":"high|med|low","rivalIndex": <1-based index into the rivals list, or 0 if not based on a rival>}]}. No prose.`
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
      return {
        title: String(it.title || '').slice(0, 100),
        format: String(it.format || '').slice(0, 60),
        why: String(it.why || '').slice(0, 320),
        basedOn,
        reference: rival ? { kind: 'competitor', label: rival.title || 'their winning ad', brand: rival.brandName, image: rival.image }
          : (fatigue && basedOn === 'fatigue') ? { kind: 'ours', label: fatigue.name }
          : (ourWinner && basedOn === 'winner') ? { kind: 'ours', label: ourWinner.name } : null,
        priority: (['high', 'med', 'low'].includes(it.priority) ? it.priority : 'med') as CreativeIdea['priority'],
        studioHref: studioHref(rival),
      }
    }).filter((i: CreativeIdea) => i.title && i.why)
    return ideas.length ? ideas.slice(0, 3) : null
  } catch { return null }
}

export async function generateCreativeStrategy(admin: any, userId: string, opts: { accountId?: string; brand?: string } = {}): Promise<CreativeStrategy> {
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

  const rivals = await getCompetitorWinners(admin, userId, { poolSize: 6 })

  let brand = opts.brand || ''
  if (!brand) { try { const { data } = await admin.from('brands').select('name').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle(); brand = data?.name || '' } catch { /* ok */ } }

  const reasoned = (ourWinner || fatigue || rivals.length) ? await reasonedIdeas(ourWinner, fatigue, rivals, brand) : null
  const ideas = reasoned || fallbackIdeas(ourWinner, fatigue, rivals)

  const summary = ideas.length === 0
    ? (rivals.length === 0 ? 'Spy a competitor or two and connect your ad account — then I’ll tell you exactly what to make next.' : 'Nothing urgent to make right now — your account looks steady.')
    : `${ideas.length} idea${ideas.length === 1 ? '' : 's'} for what to make next, from your ad performance${rivals.length ? ' + what rivals are winning with' : ''}.`

  return { summary, ideas, reasoned: !!reasoned, generatedAt: new Date().toISOString() }
}
