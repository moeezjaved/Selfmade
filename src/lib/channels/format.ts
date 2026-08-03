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

/** A pending task → the founder-facing approval (money in the button; department in character). */
export function formatApproval(task: any): { text: string; slackBlocks: any[] } {
  const ev = task.evidence || {}
  const dept = departmentByKey(departmentForTaskKind(task.kind))
  const who = dept ? `${dept.emoji} ${dept.name}` : 'Mello'
  const title = task.title || 'A decision for you'
  const why = task.why || ''
  const conf = confidence(task)
  const approveLabel = task.kind === 'meta_scale' && ev.newBudget ? `Approve $${ev.newBudget}/day` : task.kind === 'meta_pause' ? 'Pause it' : 'Approve'

  const lines = [`*${who}*`, title]
  if (why) lines.push(`_${why}_`)
  if (conf) lines.push(`Confidence: ${conf}`)
  const slackBlocks = [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    { type: 'actions', block_id: `task_${task.id}`, elements: [
      { type: 'button', action_id: 'approve', style: 'primary', text: { type: 'plain_text', text: approveLabel }, value: task.id },
      { type: 'button', action_id: 'skip', text: { type: 'plain_text', text: 'Not now' }, value: task.id },
    ] },
  ]
  const waActionHint = task.kind === 'meta_scale' && ev.newBudget ? `Reply YES to approve $${ev.newBudget}/day, or NO to skip.` : 'Reply YES to approve, or NO to skip.'
  const waText = [`${who}`, title, why, conf ? `Confidence: ${conf}` : '', waActionHint].filter(Boolean).join('\n')
  return { text: waText, slackBlocks }
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

  // ── Slack: the office board ──
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `🌙 *Overnight shift complete*${first ? ` — morning${first}` : ''}` } },
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
  const waLines = [`🌙 Overnight shift done${first ? `, morning${first}` : ''}.`, boardShort]
  if (pending) { const a = formatApproval(pending); waLines.push('', a.text) }
  else waLines.push('', waitingCount ? `${waitingCount} need you — open Selfmade.` : `All handled. Nothing needs you. 🌱`)
  const text = waLines.join('\n')

  return { text, slackBlocks: blocks }
}
