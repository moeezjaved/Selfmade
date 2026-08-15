/**
 * runTask — the ONE executor for an approved mello_task, callable from anywhere with a resolved
 * user id (the web route, a Slack button, a WhatsApp "yes", a cron). It was extracted verbatim from
 * /api/mello/tasks/run so every channel acts through the exact same path — no parallel executor, no
 * drift. The route still resolves auth + persists the task; this runs it.
 *
 *   research → the flagship competitor report (charges credits)
 *   creative → clones the competitor's top image ad onto the user's product (needs the user's cookie
 *              for the internal clone-image call → channel approvals can't run this yet)
 *   video    → editable storyboard (free; also needs the cookie)
 *   meta_pause / meta_scale → act on the user's own Meta account (needs only user id → channel-safe)
 *
 * Kinds that require `cookie` (creative/video) fail cleanly with `needsApp:true` when it's absent, so
 * a channel can deep-link the founder into the web app instead of half-running.
 */
import { authorCompetitorReport } from '@/lib/mello/tools'
import { sendEmail } from '@/lib/email'
import { recordLearning, departmentForKind } from '@/lib/brain'

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

export type RunTaskCtx = { userId: string; email?: string | null; cookie?: string; source?: string }

/**
 * Execute an already-persisted mello_task row. Sets it running → done/failed, writes result, emails
 * the founder on success, and returns the updated task (with `.needsApp` when a cookie-only kind was
 * invoked without one). Mirrors the original route behavior exactly.
 */
export async function runTask(admin: any, ctx: RunTaskCtx, task: any): Promise<any> {
  const { userId, email, cookie = '', source = 'app' } = ctx

  await admin.from('mello_tasks').update({ status: 'running', error: null, updated_at: new Date().toISOString() }).eq('id', task.id)

  let result: any = null
  let failed: string | null = null
  let needsApp = false
  try {
    const ev = task.evidence || {}
    if (task.kind === 'research') {
      const r = await authorCompetitorReport(userId, ev.competitor || task.title, undefined)
      if (r?.error) failed = r.error === 'insufficient_credits' ? 'Not enough credits (50) for the report.' : (r.error || 'Report failed')
      else result = { docId: r.document_id, url: r.url, title: r.title, groundedOnAds: r.grounded_on_ads, cta: 'Open the report →', emailNoun: 'report' }

    } else if (task.kind === 'creative') {
      if (!cookie) { needsApp = true; failed = 'Open this one in the app — I need your session to build the ad.' }
      else {
        const productImages = await brandProductImages(admin, ev.brandId || task.brand_id)
        const start = await fetch(`${APP}/api/discovery/clone-image`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ adId: ev.sourceAdId, brandId: ev.brandId || task.brand_id, productImages, productType: ev.productType || 'physical', look: 'match', aspectRatio: 'original', imageSize: '2K' }),
        }).then((r) => r.json()).catch((e) => ({ error: String(e?.message || e) }))
        if (!start?.jobId) failed = start?.error === 'insufficient_credits' ? 'Not enough credits for the ad.' : (start?.error || 'Could not start the ad.')
        else {
          const p = await pollJob(admin, start.jobId, userId, ['done'])
          if (p.failed) failed = 'The ad generation failed — your credits were refunded. Try again.'
          else if (p.timedOut) failed = 'The ad is taking longer than usual — it’ll appear in My Creatives shortly.'
          else result = { jobId: start.jobId, url: (p.row as any).image_url, title: task.title, cta: 'Open the ad →', emailNoun: 'ad' }
        }
      }

    } else if (task.kind === 'video') {
      if (!cookie) { needsApp = true; failed = 'Open this one in the app — I need your session to build the storyboard.' }
      else {
        const productImages = await brandProductImages(admin, ev.brandId || task.brand_id)
        if (!productImages.length) { failed = 'Add a product photo to your brand first, then I can rebuild the video around it.' }
        else {
          const start = await fetch(`${APP}/api/discovery/clone-video`, {
            method: 'POST', headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ sourceAdId: ev.sourceAdId, sourceVideoUrl: ev.sourceVideoUrl || undefined, brandId: ev.brandId || task.brand_id, productImages, tier: 'premium', productType: ev.productType || 'physical', language: 'en', voice: 'nova' }),
          }).then((r) => r.json()).catch((e) => ({ error: String(e?.message || e) }))
          if (!start?.jobId) failed = start?.error || 'Could not start the storyboard.'
          else {
            const p = await pollJob(admin, start.jobId, userId, ['review'])
            if (p.failed) failed = 'The storyboard analysis failed — please try again.'
            else if (p.timedOut) failed = 'The storyboard is taking longer than usual — check the storyboard page shortly.'
            else result = { jobId: start.jobId, url: `/studio/storyboard?jobId=${start.jobId}`, title: task.title, cta: 'Review the storyboard →', emailNoun: 'storyboard' }
          }
        }
      }

    } else if (task.kind === 'meta_pause' || task.kind === 'meta_scale') {
      // The approve→act loop: the audit SUGGESTED this; the founder's approval (web click, Slack tap,
      // WhatsApp "yes") IS the authorization; execute against their own ad account and log it durably.
      const { createMetaClientForUser } = await import('@/lib/meta/client')
      let mc: any = null
      try { mc = await createMetaClientForUser(userId) } catch { /* handled below */ }
      if (!mc) failed = 'Meta isn’t connected (or access expired) — reconnect and I can act on your account.'
      else if (!ev.metaCampaignId) failed = 'This suggestion is missing its campaign — refresh the brief for a new one.'
      else if (task.kind === 'meta_pause') {
        await mc.pauseCampaign(String(ev.metaCampaignId))
        result = { url: '/m4', title: task.title, cta: 'See your campaigns →', emailNoun: 'campaign pause', campaign: ev.campaignName }
      } else {
        const nb = Number(ev.newBudget)
        if (!nb || nb <= 0) failed = 'No target budget on this suggestion — refresh the brief for a new one.'
        else {
          await mc.scaleCampaignBudget(String(ev.metaCampaignId), nb)
          result = { url: '/m4', title: task.title, cta: 'See your campaigns →', emailNoun: 'budget scale', campaign: ev.campaignName, newBudget: nb }
        }
      }
      if (!failed) {
        await admin.from('activity_logs').insert({
          user_id: userId, action_type: task.kind.toUpperCase(), entity_type: 'campaign',
          description: `${task.kind === 'meta_pause' ? 'Paused' : `Scaled to $${ev.newBudget}/day`} “${ev.campaignName || ev.metaCampaignId}” — approved via ${source}`,
          performed_by: 'mello',
        }).then(() => {}, () => {})
      }

    } else if (task.kind === 'meta_audience' || task.kind === 'meta_placement') {
      // "Target them" / "Review placements" — approve→act. Same safe duplicate-and-tune as the brief:
      // copy the winner into a focused campaign at the founder's budget, tune only the copy. Original
      // untouched (no learning-phase reset). The founder's approval IS the authorization.
      const { applyTune } = await import('@/lib/meta/tune')
      const r = await applyTune(admin, userId, { metaCampaignId: ev.metaCampaignId, apply: ev.apply, newDailyBudget: Number(ev.newBudget) })
      if (!r.ok) failed = r.error
      else result = { url: '/m4', title: task.title, cta: 'See your campaigns →', emailNoun: task.kind === 'meta_audience' ? 'audience focus' : 'placement focus', campaign: r.newCampaign, newBudget: r.newDailyBudget }
      if (!failed) {
        await admin.from('activity_logs').insert({
          user_id: userId, action_type: task.kind.toUpperCase(), entity_type: 'campaign',
          description: `Duplicated a winner into a focused campaign (${ev.apply?.label || 'best segment'}) at $${ev.newBudget}/day — approved via ${source}`,
          performed_by: 'mello',
        }).then(() => {}, () => {})
      }

    } else {
      failed = `Task kind "${task.kind}" isn't runnable yet.`
    }
  } catch (e: any) { failed = String(e?.message || e).slice(0, 200) }

  if (failed) {
    // A needs-app failure is NOT a real failure — leave the task suggested so the app can still run it.
    if (!needsApp) await admin.from('mello_tasks').update({ status: 'failed', error: failed, updated_at: new Date().toISOString() }).eq('id', task.id)
    else await admin.from('mello_tasks').update({ status: 'suggested', updated_at: new Date().toISOString() }).eq('id', task.id)
    return { ...task, status: needsApp ? 'suggested' : 'failed', error: failed, needsApp }
  }

  await admin.from('mello_tasks').update({ status: 'done', result, updated_at: new Date().toISOString() }).eq('id', task.id)

  // ── Company Brain (L4): the action just happened + why — write it to the learning log. The OUTCOME
  // (did the scale hold? did the report convert?) is appended later by the audit; this seeds the fact
  // with the signal that justified it, so the department starts compounding what it does. Best-effort.
  {
    const ev = task.evidence || {}
    const metric: Record<string, any> = {}
    if (ev.roas != null) metric.roas = ev.roas
    if (result?.newBudget != null) metric.newBudget = result.newBudget
    if (ev.spend != null) metric.spend = ev.spend
    recordLearning(admin, {
      userId, brandId: task.brand_id, department: departmentForKind(task.kind),
      event: task.title, result: `approved via ${source}`, metric,
      confidence: 65, source: 'auto',
    })
  }

  // Email the founder that Mello finished (proof of labor + a link straight to the work).
  if (email && result?.url) {
    const link = result.url.startsWith('http') ? result.url : `${APP}${result.url}`
    const noun = result.emailNoun || 'work'
    const grounded = task.kind === 'research' && result.groundedOnAds ? `<p style="color:#6f6d5a;font-size:13px">Grounded on ${result.groundedOnAds} competitor ads.</p>` : ''
    sendEmail(email, `Mello finished: ${result.title || task.title}`,
      `<p>Done — I finished the ${noun} you kicked off:</p><p style="font-size:16px;font-weight:600">${result.title || task.title}</p>` +
      `<p><a href="${link}" style="background:#ef4a1e;color:#ffffff;padding:11px 20px;border-radius:100px;text-decoration:none;font-weight:700">${result.cta || 'Open it →'}</a></p>${grounded}`
    ).catch(() => {})
  }

  return { ...task, status: 'done', result }
}
