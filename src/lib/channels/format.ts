/**
 * The office, in a message. Not "Mello → founder" notifications — a company where departments finish
 * the overnight shift, stay in character (Research FINDS, Creative BUILDS, Media LAUNCHES), and leave
 * ONE decision on your desk. Slack = the full office board; WhatsApp = the urgent one-liner.
 */
import { departmentForTaskKind, departmentByKey } from '@/lib/company/departments'
import type { DeptView } from '@/lib/company/status'

const STATUS: Record<string, { dot: string; label: string; live: boolean }> = {
  finished: { dot: '✅', label: 'Finished', live: true },
  waiting: { dot: '⏳', label: 'Waiting for you', live: true },
  warning: { dot: '⚠️', label: 'Needs a look', live: true },
  working: { dot: '🟢', label: 'Working…', live: true },
  idle: { dot: '🌱', label: 'All quiet', live: true },
  hiring: { dot: '○', label: 'Joining soon', live: false },
}

/** Confidence, from real evidence — qualitative + the number that justifies it (never invented). */
function confidence(task: any): string | null {
  const ev = task?.evidence || {}
  if (task?.kind === 'meta_scale' && ev.roas != null) {
    const r = Number(ev.roas)
    const level = r >= 2.5 ? 'Strong' : r >= 1.8 ? 'Worth it' : 'Early'
    return `${level} · ROAS ${r}×`
  }
  if (task?.kind === 'meta_pause' && (ev.spend != null || ev.roas != null)) {
    return `Clear · ${ev.spend != null ? `$${ev.spend} spent` : ''}${ev.roas != null ? `${ev.spend != null ? ', ' : ''}ROAS ${ev.roas}×` : ''}`
  }
  return null
}

/** A ▮▮▮/▮▮▯/▮▯▯ meter for money moves, from ROAS — visible uncertainty the founder learns to trust. */
function meter(task: any): string | null {
  const r = Number(task?.evidence?.roas)
  if (task?.kind !== 'meta_scale' || !Number.isFinite(r)) return null
  return r >= 2.5 ? '▮▮▮ high' : r >= 1.8 ? '▮▮▯ medium' : '▮▯▯ early'
}

/** A pending task → the founder-facing approval (money in the button; department in character). Money
 *  moves get the full card: the budget delta in the headline, a confidence meter, a native Slack confirm
 *  dialog so a spend can't be fat-fingered, and a "reversible for 24h" footer. The action_ids/value/
 *  block_id are UNCHANGED so the existing interactivity handler executes it verbatim. */
export function formatApproval(task: any): { text: string; slackBlocks: any[] } {
  const ev = task.evidence || {}
  const dept = departmentByKey(departmentForTaskKind(task.kind))
  const who = dept ? `${dept.emoji} ${dept.name}` : 'Mello'
  const title = task.title || 'A decision for you'
  const why = task.why || ''
  const conf = confidence(task)
  const mtr = meter(task)
  const budgeted = (task.kind === 'meta_scale' || task.kind === 'meta_audience' || task.kind === 'meta_placement') && ev.newBudget
  const isPause = task.kind === 'meta_pause'
  const approveLabel = budgeted ? `Approve · $${ev.newBudget}/day` : isPause ? 'Pause it' : 'Approve'

  // Headline carries the budget delta when we have both numbers ($40 → $48/day) — the founder sees the
  // move without reading the body.
  const delta = budgeted && ev.currentBudget ? `   $${ev.currentBudget} → *$${ev.newBudget}/day*` : ''
  const detailBits = [why ? `_${why}_` : '', conf ? `Confidence: ${conf}${mtr ? `  ${mtr}` : ''}` : (mtr ? `Confidence: ${mtr}` : '')].filter(Boolean)
  const section = [`*${who}*`, `${title}${delta}`, ...detailBits].join('\n')

  // Money & pause moves get a native confirm dialog — no accidental spend from a mis-tap.
  const approveBtn: any = { type: 'button', action_id: 'approve', style: 'primary', text: { type: 'plain_text', text: approveLabel }, value: task.id }
  if (budgeted) {
    approveBtn.confirm = {
      title: { type: 'plain_text', text: `Scale to $${ev.newBudget}/day?` },
      text: { type: 'mrkdwn', text: `Raises daily spend to *$${ev.newBudget}*. I can undo it on one tap for 24h.` },
      confirm: { type: 'plain_text', text: 'Yes, scale it' }, deny: { type: 'plain_text', text: 'Wait' },
    }
  } else if (isPause) {
    approveBtn.confirm = {
      title: { type: 'plain_text', text: 'Pause this campaign?' },
      text: { type: 'mrkdwn', text: 'Stops its spend now. You can resume it anytime.' },
      confirm: { type: 'plain_text', text: 'Yes, pause it' }, deny: { type: 'plain_text', text: 'Wait' },
    }
  }

  const slackBlocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: section } },
    { type: 'actions', block_id: `task_${task.id}`, elements: [
      approveBtn,
      { type: 'button', action_id: 'skip', text: { type: 'plain_text', text: 'Not now' }, value: task.id },
    ] },
  ]
  if (budgeted) slackBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '💸 Reversible for 24h · same approval as the web app' }] })

  const waActionHint = budgeted ? `Reply YES to approve $${ev.newBudget}/day, or NO to skip.` : 'Reply YES to approve, or NO to skip.'
  const waText = [`${who}`, title, why, conf ? `Confidence: ${conf}` : '', waActionHint].filter(Boolean).join('\n')
  return { text: waText, slackBlocks }
}

/**
 * A proposed Company Brain fact → the founder's confirm card. The founder RATIFIES memory before the
 * company reasons over it as truth. Buttons carry the mello_memory id (mirrors how a task card carries
 * task.id → `value`). Three moves: confirm (→ trusted), correct (opens an edit modal), drop (→ retired).
 */
export function formatBrainProposal(memory: any): { text: string; slackBlocks: any[] } {
  const content = String(memory.content || 'I noticed a pattern in your business.').trim()
  const catLine = memory.category ? `  ·  _${memory.category}_` : ''
  const section = [
    `*🧠 Company Brain*${catLine}`,
    `I think I've learned something about your business:`,
    `> ${content}`,
    `If that's right, I'll treat it as fact — every future brief, ad and rule will lean on it.`,
  ].join('\n')
  const slackBlocks = [
    { type: 'section', text: { type: 'mrkdwn', text: section } },
    { type: 'actions', block_id: `brain_${memory.id}`, elements: [
      { type: 'button', action_id: 'brain_confirm', style: 'primary', text: { type: 'plain_text', text: 'Yes — that’s us' }, value: memory.id },
      { type: 'button', action_id: 'brain_edit', text: { type: 'plain_text', text: 'Correct it' }, value: memory.id },
      { type: 'button', action_id: 'brain_reject', style: 'danger', text: { type: 'plain_text', text: 'No, drop it' }, value: memory.id },
    ] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Company Brain · you can change anything I remember' }] },
  ]
  const text = `Company Brain — is this true? “${content}”  ·  reply YES to confirm, NO to drop`
  return { text, slackBlocks }
}

/**
 * A competitor ad worth answering → the founder card. "Make ours like this" (value = discovery ad_id)
 * kicks off the real video clone. The ad's poster rides as an image accessory so the thumbnail sits inline.
 */
export function formatCompetitorAd(ad: any, appUrl: string): { text: string; slackBlocks: any[] } {
  const who = ad.page_name || 'A competitor'
  const days = Number(ad.days_running) || 0
  const runLine = days >= 20 ? `Running *${days} days* — a proven winner they're scaling.` : days > 0 ? `Live ${days} days.` : `Just spotted in their feed.`
  const section: any = { type: 'section', text: { type: 'mrkdwn', text: `*🎯 ${who} — an ad worth answering.*\n${runLine} This is the format to make ours before it saturates.` } }
  if (ad.poster_url && /^https?:\/\//i.test(String(ad.poster_url))) {
    section.accessory = { type: 'image', image_url: String(ad.poster_url), alt_text: `${who} ad` }
  }
  const slackBlocks = [
    section,
    { type: 'actions', block_id: `spy_${ad.ad_id}`, elements: [
      { type: 'button', action_id: 'spy_remake', style: 'primary', text: { type: 'plain_text', text: 'Make ours like this' }, value: String(ad.ad_id) },
      { type: 'button', action_id: 'open_spy', text: { type: 'plain_text', text: 'See their ads' }, url: `${appUrl}/discovery` },
    ] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Analyst · from your competitor watch · a remake is a free draft — nothing spends until you approve' }] },
  ]
  const text = `${who} has an ad worth answering — reply to make ours like it`
  return { text, slackBlocks }
}

/** The "Correct it" modal (views.open). private_metadata carries the memory id back on submit. */
export function brainEditView(memory: any): any {
  return {
    type: 'modal',
    callback_id: 'brain_edit_save',
    private_metadata: String(memory.id),
    title: { type: 'plain_text', text: 'Correct the Brain' },
    submit: { type: 'plain_text', text: 'Save to memory' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      { type: 'input', block_id: 'content', label: { type: 'plain_text', text: 'What’s actually true?' },
        element: { type: 'plain_text_input', action_id: 'val', multiline: true, initial_value: String(memory.content || '') } },
    ],
  }
}

/**
 * The overnight-shift report. departments = live status of the whole company; pending = the top
 * decision (rendered with its Approve button). Grounded entirely in real status — a department only
 * "speaks" if it actually did something.
 */
export function formatReport(brief: any, departments: DeptView[] = [], pending?: any): { text: string; slackBlocks: any[] } {
  const first = brief?.firstName ? `, ${brief.firstName}` : ''
  const live = departments.filter(d => d.live)
  const waitingCount = live.filter(d => d.status === 'waiting' || d.status === 'warning').length

  // Time-aware greeting — was hardcoded "morning" (said "morning" at 5:52pm). Founder tz via BRIEF_TZ.
  const greet = (() => { try { const hr = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: process.env.BRIEF_TZ || 'Asia/Karachi' }).format(new Date())); return hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening' } catch { return 'morning' } })()
  // ── Slack: the office board ──
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `🌙 *Overnight shift complete*${first ? ` — good ${greet}${first}` : ''}` } },
    { type: 'divider' },
  ]
  // Status board — who's done, who's blocked, who's watching.
  const board = live.map(d => `${d.emoji}  *${d.name}* — ${STATUS[d.status]?.dot || ''} ${STATUS[d.status]?.label || d.status}`).join('\n')
  const joining = departments.filter(d => !d.live).map(d => `${d.emoji} ${d.name}`).join(' · ')
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: board + (joining ? `\n\n_Joining soon: ${joining}_` : '') } })

  // In-character findings — only departments that actually did something, in their own voice.
  const spoke = live.filter(d => (d.status === 'finished' || d.status === 'waiting' || d.status === 'working') && d.detail && !/nothing needs/i.test(d.detail))
    .map(d => {
      const verb = departmentByKey(d.key)?.verb || 'did'
      return `${d.emoji}  *${d.name}* ${verb}: ${d.detail}`
    })
  if (spoke.length) { blocks.push({ type: 'divider' }); blocks.push({ type: 'section', text: { type: 'mrkdwn', text: spoke.join('\n\n') } }) }

  // The one decision on your desk.
  blocks.push({ type: 'divider' })
  if (pending) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Mello* — everything's ready. One decision needs you:` } })
    blocks.push(...formatApproval(pending).slackBlocks)
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Mello* — ${waitingCount ? `${waitingCount} thing${waitingCount === 1 ? '' : 's'} need you above.` : `everything's handled. Nothing needs you. 🌱`}` } })
  }

  // ── WhatsApp: the urgent one-liner (office fits Slack, not a phone) ──
  const boardShort = live.map(d => `${d.emoji} ${STATUS[d.status]?.dot || ''}`).join('  ')
  const waLines = [`🌙 Overnight shift done${first ? `, good ${greet}${first}` : ''}.`, boardShort]
  if (pending) { const a = formatApproval(pending); waLines.push('', a.text) }
  else waLines.push('', waitingCount ? `${waitingCount} need you — open Selfmade.` : `All handled. Nothing needs you. 🌱`)
  const text = waLines.join('\n')

  return { text, slackBlocks: blocks }
}
