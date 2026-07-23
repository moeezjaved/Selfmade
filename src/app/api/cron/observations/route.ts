/**
 * Nightly observations — Mello writes one note per active brand, like an employee closing out the day.
 * For each user who watches competitors, it gathers the day's signal (competitor drops + the rising
 * angle in their niche + their own remembered rules) and has gpt-4o-mini write ONE grounded, first-
 * person observation with an optional action → daily_observations (mig 110). The Morning Brief then
 * speaks these back as "insight" turns. Idempotent per (user, brand, day).
 *
 * GET /api/cron/observations  (CRON_SECRET or an authed session). Runs nightly via vercel.json crons.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) return true } catch { /* ignore */ }
  return false
}

const soft = async <T,>(p: Promise<T>, f: T): Promise<T> => { try { return await p } catch { return f } }

// gpt-4o-mini writes ONE observation from the day's signal. Returns null if nothing worth noting —
// an employee that only speaks when there's something to say. Fail-soft everywhere.
async function writeObservation(ctx: { brand: string; niche: string | null; drops: string[]; risingTag: string | null; rules: string[] }): Promise<{ observation: string; action: string | null; confidence: number } | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const signal = [
    ctx.drops.length ? `Competitor moves today: ${ctx.drops.join('; ')}.` : 'No notable competitor moves today.',
    ctx.risingTag ? `Rising angle in ${ctx.niche || 'their market'}: "${ctx.risingTag}".` : '',
    ctx.rules.length ? `Things I must respect about this brand: ${ctx.rules.join('; ')}.` : '',
  ].filter(Boolean).join('\n')
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 180, temperature: 0.4, response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: `You are Mello, an AI marketer closing out the day for the brand "${ctx.brand}". From tonight's signal, write ONE short observation in your own first-person voice — what you noticed and, if warranted, one concrete next step. Ground it in the signal; never invent numbers. If there is genuinely nothing worth the founder's attention, return {"skip":true}.

TONIGHT'S SIGNAL:
${signal}

Return ONLY JSON: {"skip":false,"observation":"one or two sentences, first person","action":"one short next step or null","confidence":0-100}`,
        }],
      }),
    })
    if (!r.ok) return null
    const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
    if (out.skip || !out.observation) return null
    return { observation: String(out.observation).slice(0, 500), action: out.action ? String(out.action).slice(0, 200) : null, confidence: Math.max(0, Math.min(100, Number(out.confidence) || 70)) }
  } catch { return null }
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const today = new Date().toISOString().slice(0, 10)
  const H24 = new Date(Date.now() - 24 * 3600e3).toISOString()
  const D7 = new Date(Date.now() - 7 * 86400e3).toISOString()

  // Active users = anyone who watches at least one brand. (Cap per run; cron repeats nightly.)
  const { data: follows } = await admin.from('followed_brands').select('user_id, page_id, brand_name').limit(4000)
  if (!follows?.length) return NextResponse.json({ ok: true, users: 0, written: 0 })
  const byUser = new Map<string, any[]>()
  for (const f of follows) { const a = byUser.get(f.user_id) || []; a.push(f); byUser.set(f.user_id, a) }

  // Skip users who already have an observation today (idempotent).
  const userIds = Array.from(byUser.keys())
  const { data: existing } = await admin.from('daily_observations').select('user_id').eq('obs_date', today).in('user_id', userIds)
  const done = new Set<string>((existing || []).map((r: any) => r.user_id))

  let written = 0, processed = 0
  for (const userId of userIds) {
    if (done.has(userId)) continue
    if (processed >= 300) break   // per-run cap; the rest get theirs tomorrow
    processed++
    const watched = byUser.get(userId) || []
    const pageIds = watched.map((w: any) => w.page_id).filter(Boolean).slice(0, 60)
    const [prof, drops, rulesRows] = await Promise.all([
      soft(admin.from('user_profiles').select('niche').eq('user_id', userId).maybeSingle().then((r: any) => r.data), null),
      soft(admin.from('notifications').select('brand_name, ad_count').eq('user_id', userId).eq('type', 'new_ad').gte('created_at', H24).order('created_at', { ascending: false }).limit(5).then((r: any) => r.data || []), []),
      soft(admin.from('mello_memory').select('content').eq('user_id', userId).in('kind', ['rule', 'scar']).is('retired_at', null).limit(4).then((r: any) => r.data || []), []),
    ])
    const niche = (prof as any)?.niche || null
    // Rising angle among the freshest ads from watched pages this week.
    const trendAds = await soft((async () => {
      let q = admin.from('discovery_ads_index').select('topics').gte('created_at', D7).order('created_at', { ascending: false }).limit(200)
      if (pageIds.length) q = q.in('page_id', pageIds)
      return (await q).data || []
    })(), [] as any[])
    const counts = new Map<string, number>()
    for (const a of trendAds) for (const t of (a.topics || [])) counts.set(t, (counts.get(t) || 0) + 1)
    const risingTag = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 3)[0]?.[0] || null

    const dropList = (drops as any[]).map((d: any) => `${d.brand_name && !/^\d+$/.test(String(d.brand_name)) ? d.brand_name : 'a watched brand'} launched ${Math.max(1, d.ad_count || 1)} new ad${(d.ad_count || 1) > 1 ? 's' : ''}`)
    if (!dropList.length && !risingTag) continue   // nothing to say → say nothing (silence is a service)

    const brandName = watched[0]?.brand_name && !/^\d+$/.test(String(watched[0].brand_name)) ? watched[0].brand_name : 'your brand'
    const obs = await writeObservation({ brand: brandName, niche, drops: dropList, risingTag, rules: (rulesRows as any[]).map((r: any) => r.content) })
    if (!obs) continue
    await soft(admin.from('daily_observations').insert({ user_id: userId, obs_date: today, observation: obs.observation, action: obs.action, confidence: obs.confidence, source: 'mello' }).then(() => {}), undefined)
    written++
  }
  return NextResponse.json({ ok: true, users: userIds.length, processed, written })
}
