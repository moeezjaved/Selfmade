/**
 * Message grammar → concrete Slack blocks + WhatsApp text.
 * The rule (from the design docs): title · why · expected/risk, then the decision. On Slack the
 * money is IN the button ("Approve $200/day") — one tap is the approval AND the budget consent.
 * WhatsApp has no buttons, so we spell out "Reply YES to approve".
 */

/** A pending mello_task → the founder-facing approval message. */
export function formatApproval(task: any): { text: string; slackBlocks: any[] } {
  const ev = task.evidence || {}
  const title = task.title || 'A decision for you'
  const why = task.why || ''
  // Money-bearing label: a scale names the daily budget so approving IS the budget consent.
  const approveLabel =
    task.kind === 'meta_scale' && ev.newBudget ? `Approve $${ev.newBudget}/day` :
    task.kind === 'meta_pause' ? 'Pause it' :
    'Approve'

  const lines = [`*${title}*`]
  if (why) lines.push(why)
  if (task.kind === 'meta_scale' && ev.roas) lines.push(`_ROAS ${ev.roas} · ${ev.campaignName || ''}_`.trim())
  if (task.kind === 'meta_pause' && (ev.spend || ev.roas)) lines.push(`_${ev.campaignName || ''}${ev.spend ? ` · $${ev.spend} spent` : ''}${ev.roas != null ? ` · ROAS ${ev.roas}` : ''}_`.trim())
  const text = lines.join('\n')

  const slackBlocks = [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', block_id: `task_${task.id}`, elements: [
      { type: 'button', action_id: 'approve', style: 'primary', text: { type: 'plain_text', text: approveLabel }, value: task.id },
      { type: 'button', action_id: 'skip', text: { type: 'plain_text', text: 'Not now' }, value: task.id },
    ] },
  ]

  // WhatsApp: same content, spelled-out reply instruction (no buttons on the personal API).
  const waActionHint =
    task.kind === 'meta_scale' && ev.newBudget ? `Reply YES to approve $${ev.newBudget}/day, or NO to skip.` :
    'Reply YES to approve, or NO to skip.'
  const waText = [title, why, waActionHint].filter(Boolean).join('\n\n')

  return { text: waText, slackBlocks }
}

/** A Brief (from assembleBrief) → a compact report message for Slack + WhatsApp. */
export function formatReport(brief: any): { text: string; slackBlocks: any[] } {
  const hi = brief?.headline
  const items: any[] = (brief?.items || []).slice(0, 5)
  const greeting = brief?.firstName ? `Morning, ${brief.firstName}.` : 'Morning.'
  const head = hi?.title ? `${greeting} ${String(hi.title)}` : greeting

  // summary can be a string OR a stats object ({adsScanned, brandsWatched, …}). Render either cleanly.
  const s = brief?.summary
  let summaryLine = ''
  if (typeof s === 'string') summaryLine = s.trim()
  else if (s && typeof s === 'object') {
    const parts: string[] = []
    if (s.adsScanned) parts.push(`${s.adsScanned} ads scanned`)
    if (s.brandsWatched) parts.push(`${s.brandsWatched} brands watched`)
    if (s.spiedBrands) parts.push(`${s.spiedBrands} spied`)
    if (s.creativesReady) parts.push(`${s.creativesReady} creatives ready`)
    summaryLine = parts.join(' · ')
  }

  const bullets = items.map((it) => `• ${String(it.title || '')}${it.why ? ` — ${String(it.why)}` : ''}`)
  const text = [head, summaryLine, ...bullets].filter(Boolean).join('\n')

  const slackBlocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${head}*${summaryLine ? `\n${summaryLine}` : ''}` } },
  ]
  if (bullets.length) slackBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: bullets.join('\n') } })
  if (brief?.quiet) slackBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Quiet day — nothing needs you. 🌱' }] })

  return { text, slackBlocks }
}
