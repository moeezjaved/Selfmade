/**
 * Mello Ads Actions — "run your ads by typing." A typed request + the founder's LIVE account → a
 * structured action → a confirm card → (on approval) a real write to Meta. NOTHING writes without the
 * founder approving the card, and every launch lands PAUSED. This is the brain; the API + UI are thin.
 *
 *   planAction()    parse intent, resolve the target against real campaigns/ads, build the confirm card
 *                   (or ask a clarifying question). No writes.
 *   executeAction() the founder approved → perform the write via MetaClient, log a Win.
 */
import { createMetaClientForUser, MetaClient } from '@/lib/meta/client'
import { createAdminClient } from '@/lib/supabase/server'
import { llm } from '@/lib/llm'

export type AdAction =
  | { kind: 'scale'; metaCampaignId: string; campaignName: string; currentBudget: number | null; newBudget: number }
  | { kind: 'pause'; metaCampaignId: string; campaignName: string }
  | { kind: 'resume'; metaCampaignId: string; campaignName: string }
  | { kind: 'pause_ad'; adId: string; adName: string; resume?: boolean }
  | {
      kind: 'launch'
      creativeUrl: string
      campaignName: string
      dailyBudget: number
      description: string
      copyWinnerId?: string | null       // clone this winning campaign's targeting
      interests?: { id: string; name: string }[]
      headline: string
      primaryText: string
      cta: string
      linkUrl: string
      mode?: 'new' | 'refresh' | 'carousel'   // creative→FB bridge variants
      targetCampaignId?: string           // for refresh/carousel/add-to-campaign
      pauseAdId?: string                  // ad to pause when refreshing
      extraImageUrls?: string[]           // carousel: existing card images to keep
    }

export type ActionCard = {
  title: string
  summary: string
  lines?: string[]
  confirmLabel: string
  currency: string
  action: AdAction
}
export type PlanResult = { ok: true; card: ActionCard } | { clarify: string } | { error: string }

const CTA_DEFAULT = 'SHOP_NOW'

async function accountCtx(userId: string) {
  const admin = createAdminClient() as any
  const { data: acct } = await admin.from('meta_accounts').select('account_id, page_id, currency').eq('user_id', userId).eq('is_primary', true).maybeSingle()
  const { data: prof } = await admin.from('user_profiles').select('plan_id').eq('user_id', userId).maybeSingle()
  return { pageId: acct?.page_id as string | undefined, currency: (acct?.currency as string) || 'USD', hasAcct: !!acct }
}

/** Live campaigns (for scale/pause/resume + winner-targeting) — id, name, status, daily budget. */
async function liveCampaigns(mc: MetaClient) {
  try {
    const rows = await mc.getCampaigns('id,name,status,effective_status,daily_budget')
    return (rows || []).map((c: any) => ({
      id: String(c.id), name: String(c.name || ''),
      status: String(c.effective_status || c.status || ''),
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
    }))
  } catch { return [] }
}

const money = (n: number, cur: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n) } catch { return `${Math.round(n)} ${cur}` } }

/**
 * Parse a typed request into a confirm card. `attach` optionally carries a creative the founder is
 * launching (from My Creatives / Ad Studio), which biases intent toward launch/refresh/carousel.
 */
export async function planAction(
  userId: string,
  input: { message: string; attach?: { creativeUrl: string; brandName?: string; website?: string } },
): Promise<PlanResult> {
  const mc = await createMetaClientForUser(userId).catch(() => null)
  if (!mc) return { error: 'Meta isn’t connected (or access expired). Reconnect Meta and I can run your ads.' }
  const { currency, pageId } = await accountCtx(userId)
  const camps = await liveCampaigns(mc)

  // ── LLM intent parse, grounded on the REAL campaign list (so "the retargeting one" resolves to an id) ──
  const campList = camps.map((c: any) => `- id=${c.id} · "${c.name}" · ${c.status} · ${c.daily_budget != null ? money(c.daily_budget, currency) + '/day' : 'no daily budget'}`).join('\n') || '(no campaigns)'
  const prompt = `You turn a founder's plain-English ads request into ONE structured action. Their LIVE campaigns:
${campList}
${input.attach ? `They also attached a creative to launch/attach (image URL present). Brand: ${input.attach.brandName || ''} ${input.attach.website || ''}` : ''}

Request: "${input.message}"

Return ONLY JSON, one of:
{"kind":"scale","campaignId":"<id>","newBudget":<number in ${currency}/day>}
{"kind":"pause","campaignId":"<id>"}
{"kind":"resume","campaignId":"<id>"}
{"kind":"launch","campaignName":"<short name>","dailyBudget":<number>,"description":"<who to target, in their words>","copyWinnerId":"<id or null>"}
{"clarify":"<one short question>"}  // if the target or a required number is ambiguous/missing

Rules: match the campaign by name loosely. If they say scale/increase/raise budget → scale. Stop/turn off/pause → pause. Turn on/resume/restart → resume. Launch/run/create/start an ad or campaign → launch. If a launch has no budget, ask for it. If a target campaign is ambiguous, ask which. Never invent a campaignId not in the list.`
  let parsed: any = {}
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 300, temperature: 0.1, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    parsed = JSON.parse((t.match(/\{[\s\S]*\}/) || ['{}'])[0])
  } catch { return { error: 'I couldn’t read that request — try rephrasing (e.g. "scale ROY 1 to €80/day").' } }

  if (parsed.clarify) return { clarify: String(parsed.clarify) }
  const byId = (id: string) => camps.find((c: any) => c.id === String(id))

  if (parsed.kind === 'scale') {
    const c = byId(parsed.campaignId); if (!c) return { clarify: 'Which campaign should I scale?' }
    const nb = Number(parsed.newBudget); if (!nb || nb <= 0) return { clarify: `What daily budget should I set for “${c.name}”?` }
    return { ok: true, card: {
      title: `Scale “${c.name}” to ${money(nb, currency)}/day`,
      summary: `${c.daily_budget != null ? `${money(c.daily_budget, currency)}/day → ` : ''}${money(nb, currency)}/day`,
      lines: c.daily_budget != null ? [`Extra spend: ${money(Math.max(0, nb - c.daily_budget), currency)}/day`] : [],
      confirmLabel: `Approve — scale to ${money(nb, currency)}/day`, currency,
      action: { kind: 'scale', metaCampaignId: c.id, campaignName: c.name, currentBudget: c.daily_budget, newBudget: nb },
    } }
  }
  if (parsed.kind === 'pause' || parsed.kind === 'resume') {
    const c = byId(parsed.campaignId); if (!c) return { clarify: `Which campaign should I ${parsed.kind}?` }
    const resume = parsed.kind === 'resume'
    return { ok: true, card: {
      title: `${resume ? 'Resume' : 'Pause'} “${c.name}”`,
      summary: resume ? 'This campaign will start spending again.' : 'This campaign will stop spending today.',
      confirmLabel: `Approve — ${resume ? 'resume' : 'pause'} “${c.name}”`, currency,
      action: { kind: resume ? 'resume' : 'pause', metaCampaignId: c.id, campaignName: c.name },
    } }
  }
  if (parsed.kind === 'launch') {
    if (!input.attach?.creativeUrl) return { clarify: 'Pick the creative you want to launch (from My Creatives or Ad Studio), then tell me the campaign.' }
    if (!pageId) return { error: 'Your Facebook Page isn’t linked to this ad account — reconnect Meta with a Page to launch ads.' }
    const nb = Number(parsed.dailyBudget); if (!nb || nb <= 0) return { clarify: 'What daily budget should this campaign run at?' }
    const description = String(parsed.description || input.message).slice(0, 240)
    const winner = parsed.copyWinnerId ? byId(String(parsed.copyWinnerId)) : null

    // Build the audience: clone a winner's targeting, else resolve interests from the description.
    let interests: { id: string; name: string }[] = []
    if (!winner) {
      const kw = await interestKeywords(description, input.attach.brandName)
      const found = (await Promise.all(kw.slice(0, 4).map((q) => mc.searchInterests(q)))).flat()
      const seen = new Set<string>(); interests = found.filter((i) => !seen.has(i.id) && seen.add(i.id)).slice(0, 6)
    }
    const copy = await launchCopy(description, input.attach.brandName)
    const linkUrl = input.attach.website ? (input.attach.website.startsWith('http') ? input.attach.website : `https://${input.attach.website}`) : 'https://'
    const audienceLine = winner ? `Same audience as “${winner.name}”` : interests.length ? `Interests: ${interests.map((i) => i.name).join(', ')}` : 'Broad audience'
    return { ok: true, card: {
      title: `Launch “${parsed.campaignName || copy.headline}” — ${money(nb, currency)}/day`,
      summary: `${audienceLine}. Launches PAUSED for your review.`,
      lines: [`Headline: ${copy.headline}`, `Body: ${copy.primaryText.slice(0, 90)}${copy.primaryText.length > 90 ? '…' : ''}`, `CTA: ${copy.cta}`],
      confirmLabel: `Approve — create (paused)`, currency,
      action: {
        kind: 'launch', creativeUrl: input.attach.creativeUrl, campaignName: String(parsed.campaignName || copy.headline).slice(0, 60),
        dailyBudget: nb, description, copyWinnerId: winner?.id || null, interests,
        headline: copy.headline, primaryText: copy.primaryText, cta: copy.cta, linkUrl, mode: 'new',
      },
    } }
  }
  return { clarify: 'Tell me what to do — e.g. "scale ROY 1 to €80/day", "pause the retargeting campaign", or attach a creative and say "launch this at €30/day".' }
}

async function interestKeywords(description: string, brand?: string): Promise<string[]> {
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 120, temperature: 0.3, messages: [{ role: 'user', content: `Give 4 Facebook ad-interest keywords to target this audience: "${description}"${brand ? ` (brand: ${brand})` : ''}. Real interest names people would have on Facebook. Return ONLY JSON {"kw":["...","...","...","..."]}` }] })
    const j = JSON.parse((res.content?.[0]?.text?.match(/\{[\s\S]*\}/) || ['{}'])[0])
    return Array.isArray(j.kw) ? j.kw.map(String) : []
  } catch { return [] }
}

async function launchCopy(description: string, brand?: string): Promise<{ headline: string; primaryText: string; cta: string }> {
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 220, temperature: 0.5, messages: [{ role: 'user', content: `Write Facebook ad copy${brand ? ` for ${brand}` : ''} for this campaign: "${description}". Return ONLY JSON {"headline":"<=40 chars","primaryText":"<=125 chars","cta":"SHOP_NOW|LEARN_MORE|SIGN_UP|GET_OFFER"}` }] })
    const j = JSON.parse((res.content?.[0]?.text?.match(/\{[\s\S]*\}/) || ['{}'])[0])
    return { headline: String(j.headline || 'Shop now').slice(0, 40), primaryText: String(j.primaryText || '').slice(0, 125), cta: /LEARN_MORE|SIGN_UP|GET_OFFER|SHOP_NOW/.test(j.cta) ? j.cta : CTA_DEFAULT }
  } catch { return { headline: 'Shop now', primaryText: '', cta: CTA_DEFAULT } }
}

/** The founder approved the card → perform the write. Returns a human result + logs a Win. */
export async function executeAction(userId: string, action: AdAction): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const mc = await createMetaClientForUser(userId).catch(() => null)
  if (!mc) return { ok: false, error: 'Meta isn’t connected — reconnect and try again.' }
  const admin = createAdminClient() as any
  const win = async (title: string, detail: string, meta: any = {}) => {
    try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin, { userId, brandId: null, category: 'ads', title, detail, meta }) } catch { /* optional */ }
  }
  try {
    if (action.kind === 'scale') {
      await mc.scaleCampaignBudget(action.metaCampaignId, action.newBudget)
      await win(`Scaled “${action.campaignName}”`, `Daily budget → ${action.newBudget}`, { metaCampaignId: action.metaCampaignId, newBudget: action.newBudget })
      return { ok: true, message: `Done — “${action.campaignName}” is now running at ${action.newBudget}/day.` }
    }
    if (action.kind === 'pause') { await mc.pauseCampaign(action.metaCampaignId); await win(`Paused “${action.campaignName}”`, 'Stopped spend', { metaCampaignId: action.metaCampaignId }); return { ok: true, message: `Paused “${action.campaignName}”.` } }
    if (action.kind === 'resume') { await mc.activateCampaign(action.metaCampaignId); await win(`Resumed “${action.campaignName}”`, 'Restarted spend', { metaCampaignId: action.metaCampaignId }); return { ok: true, message: `Resumed “${action.campaignName}”.` } }
    if (action.kind === 'pause_ad') { await mc.setAdStatus(action.adId, action.resume ? 'ACTIVE' : 'PAUSED'); return { ok: true, message: `${action.resume ? 'Resumed' : 'Paused'} “${action.adName}”.` } }
    if (action.kind === 'launch') {
      const { pageId } = await accountCtx(userId)
      if (!pageId) return { ok: false, error: 'No Facebook Page linked — reconnect Meta with a Page.' }
      const img = await mc.uploadAdImage(action.creativeUrl)
      const imageHash = img?.images?.[Object.keys(img.images || {})[0]]?.hash || img?.hash
      if (!imageHash) return { ok: false, error: 'Couldn’t upload the creative to Meta — try again.' }
      // Targeting: clone a winner, else interests, else broad.
      let targeting: Record<string, unknown> = { geo_locations: { countries: ['US'] } }
      if (action.copyWinnerId) { const t = await mc.firstAdSetTargeting(action.copyWinnerId); if (t) targeting = t }
      else if (action.interests?.length) targeting = { geo_locations: { countries: ['US'] }, flexible_spec: [{ interests: action.interests.map((i) => ({ id: i.id, name: i.name })) }] }
      const launched = await mc.launchFullCampaign({
        campaignName: action.campaignName, objective: 'OUTCOME_SALES', targeting, dailyBudget: action.dailyBudget,
        startTime: new Date(Date.now() + 60_000).toISOString(), pageId,
        creative: { imageHash, headline: action.headline, primaryText: action.primaryText, cta: action.cta, linkUrl: action.linkUrl },
      })
      // Refresh: pause the old ad so the new creative replaces it.
      if (action.mode === 'refresh' && action.pauseAdId) { try { await mc.setAdStatus(action.pauseAdId, 'PAUSED') } catch { /* best-effort */ } }
      await win(`Launched “${action.campaignName}”`, `New ad · ${action.dailyBudget}/day · PAUSED for review`, { campaignId: launched?.campaign_id, mode: action.mode })
      return { ok: true, message: `“${action.campaignName}” is created and PAUSED — review it in Meta, then set it live when you're ready.` }
    }
    return { ok: false, error: 'Unknown action.' }
  } catch (e: any) {
    return { ok: false, error: `Meta rejected that: ${String(e?.response?.data?.error?.message || e?.message || e).slice(0, 180)}` }
  }
}
