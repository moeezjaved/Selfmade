/**
 * POST /api/mello/tasks/run  { suggestion } | { id }
 * The one click that makes Mello WORK. Persists the task as 'running', executes the matching engine,
 * marks done/failed with the result, and emails the user when it lands. This is what turns the CEO
 * desk from analytics into decisions-acted-on.
 *
 *   research → the flagship competitor report (authorCompetitorReport, charges credits)
 *   creative → clones the competitor's top image ad onto the user's product (clone-image, one image)
 *   video    → analyzes the competitor's top video into an editable STORYBOARD (free); the user
 *              approves the plan (and spends video credits) themselves — Mello never auto-burns them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { authorCompetitorReport } from '@/lib/mello/tools'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const APP = (process.env.APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The reader's product photos for this brand — swapped into the cloned ad. */
async function brandProductImages(admin: any, brandId: string | null): Promise<string[]> {
  if (!brandId) return []
  const { data } = await admin.from('brand_products').select('image_urls').eq('brand_id', brandId)
  return ((data || []) as any[]).flatMap((p) => p.image_urls || [])
    .filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 4)
}

/** Poll a creative_generations job until it reaches one of `until` (or fails/times out). */
async function pollJob(admin: any, jobId: string, userId: string, until: string[], maxMs = 250_000) {
  const iters = Math.ceil(maxMs / 4000)
  for (let i = 0; i < iters; i++) {
    await sleep(4000)
    const { data } = await admin.from('creative_generations')
      .select('status, image_url, clone_meta').eq('id', jobId).eq('user_id', userId).maybeSingle()
    if (!data) continue
    const st = (data as any).status
    if (st === 'failed') return { failed: (data as any).clone_meta?.error || 'generation failed', row: data }
    if (until.includes(st)) return { row: data }
  }
  return { timedOut: true }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const cookie = req.headers.get('cookie') || ''   // forwarded so s2s gen calls run as this user

  const b = await req.json().catch(() => ({}))

  // Resolve to a persisted 'running' task row — from an existing id, or by persisting a suggestion.
  let task: any = null
  if (b?.id) {
    const { data } = await admin.from('mello_tasks').select('*').eq('id', String(b.id)).eq('user_id', user.id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (data.status === 'done') return NextResponse.json({ task: data })   // already done — no double-charge
    task = data
  } else if (b?.suggestion?.kind) {
    const s = b.suggestion
    // Dedupe: if this suggestion was already persisted (unique suggested_key), reuse it.
    if (s.suggested_key) {
      const { data: existing } = await admin.from('mello_tasks').select('*').eq('user_id', user.id).eq('suggested_key', s.suggested_key).maybeSingle()
      if (existing) { if (existing.status === 'done') return NextResponse.json({ task: existing }); task = existing }
    }
    if (!task) {
      const { data: ins, error } = await admin.from('mello_tasks').insert({
        user_id: user.id, brand_id: s.brand_id || null, kind: s.kind, title: s.title, why: s.why || null,
        evidence: s.evidence || {}, credits: s.credits ?? null, suggested_key: s.suggested_key || null, status: 'running',
      }).select('*').maybeSingle()
      if (error || !ins) return NextResponse.json({ error: error?.message || 'could not create task' }, { status: 500 })
      task = ins
    }
  } else {
    return NextResponse.json({ error: 'id or suggestion required' }, { status: 400 })
  }

  await admin.from('mello_tasks').update({ status: 'running', error: null, updated_at: new Date().toISOString() }).eq('id', task.id)

  // ── Execute by kind ──
  let result: any = null
  let failed: string | null = null
  try {
    const ev = task.evidence || {}
    if (task.kind === 'research') {
      const r = await authorCompetitorReport(user.id, ev.competitor || task.title, undefined)
      if (r?.error) failed = r.error === 'insufficient_credits' ? 'Not enough credits (50) for the report.' : (r.error || 'Report failed')
      else result = { docId: r.document_id, url: r.url, title: r.title, groundedOnAds: r.grounded_on_ads, cta: 'Open the report →', emailNoun: 'report' }

    } else if (task.kind === 'creative') {
      const productImages = await brandProductImages(admin, ev.brandId || task.brand_id)
      const start = await fetch(`${APP}/api/discovery/clone-image`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ adId: ev.sourceAdId, brandId: ev.brandId || task.brand_id, productImages, productType: ev.productType || 'physical', look: 'match', aspectRatio: 'original', imageSize: '2K' }),
      }).then((r) => r.json()).catch((e) => ({ error: String(e?.message || e) }))
      if (!start?.jobId) failed = start?.error === 'insufficient_credits' ? 'Not enough credits for the ad.' : (start?.error || 'Could not start the ad.')
      else {
        const p = await pollJob(admin, start.jobId, user.id, ['done'])
        if (p.failed) failed = 'The ad generation failed — your credits were refunded. Try again.'
        else if (p.timedOut) failed = 'The ad is taking longer than usual — it’ll appear in My Creatives shortly.'
        else result = { jobId: start.jobId, url: (p.row as any).image_url, title: task.title, cta: 'Open the ad →', emailNoun: 'ad' }
      }

    } else if (task.kind === 'video') {
      const productImages = await brandProductImages(admin, ev.brandId || task.brand_id)
      if (!productImages.length) { failed = 'Add a product photo to your brand first, then I can rebuild the video around it.' }
      else {
        const start = await fetch(`${APP}/api/discovery/clone-video`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ sourceAdId: ev.sourceAdId, sourceVideoUrl: ev.sourceVideoUrl || undefined, brandId: ev.brandId || task.brand_id, productImages, tier: 'premium', productType: ev.productType || 'physical', language: 'en', voice: 'nova' }),
        }).then((r) => r.json()).catch((e) => ({ error: String(e?.message || e) }))
        if (!start?.jobId) failed = start?.error || 'Could not start the storyboard.'
        else {
          // Analysis runs free → job lands in 'review' with a beat sheet + script (the storyboard).
          const p = await pollJob(admin, start.jobId, user.id, ['review'])
          if (p.failed) failed = 'The storyboard analysis failed — please try again.'
          else if (p.timedOut) failed = 'The storyboard is taking longer than usual — check the storyboard page shortly.'
          else result = { jobId: start.jobId, url: `/studio/storyboard?jobId=${start.jobId}`, title: task.title, cta: 'Review the storyboard →', emailNoun: 'storyboard' }
        }
      }

    } else {
      failed = `Task kind "${task.kind}" isn't runnable yet.`
    }
  } catch (e: any) { failed = String(e?.message || e).slice(0, 200) }

  if (failed) {
    await admin.from('mello_tasks').update({ status: 'failed', error: failed, updated_at: new Date().toISOString() }).eq('id', task.id)
    return NextResponse.json({ task: { ...task, status: 'failed', error: failed } })
  }

  await admin.from('mello_tasks').update({ status: 'done', result, updated_at: new Date().toISOString() }).eq('id', task.id)

  // Email the founder that Mello finished (proof of labor + a link straight to the work).
  if (user.email && result?.url) {
    const link = result.url.startsWith('http') ? result.url : `${APP}${result.url}`
    const noun = result.emailNoun || 'work'
    const grounded = task.kind === 'research' && result.groundedOnAds ? `<p style="color:#68756b;font-size:13px">Grounded on ${result.groundedOnAds} competitor ads.</p>` : ''
    sendEmail(user.email, `Mello finished: ${result.title || task.title}`,
      `<p>Done — I finished the ${noun} you kicked off:</p><p style="font-size:16px;font-weight:600">${result.title || task.title}</p>` +
      `<p><a href="${link}" style="background:#17251c;color:#dffe95;padding:11px 20px;border-radius:100px;text-decoration:none;font-weight:700">${result.cta || 'Open it →'}</a></p>${grounded}`
    ).catch(() => {})
  }

  return NextResponse.json({ task: { ...task, status: 'done', result } })
}
