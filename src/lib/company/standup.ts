/**
 * The Morning Standup — one line from each department, the way a founder would hear it walking in:
 * "Research: 3 competitors launched. Creative: 4 concepts finished. Media: scale Campaign A. Customer:
 * 17 asked about pricing. Calendar: meeting at 2 PM." It reads the live company status we already
 * compute + the Customer inbox, so every line is grounded (never invented). The Calendar line is a
 * placeholder until Google Calendar is connected; "Prepare everything" surfaces the queued approvals.
 */
import { computeCompanyStatus } from '@/lib/company/status'

export type StandupLine = { key: string; emoji: string; name: string; text: string; connect?: boolean }
export type ConnectPrompt = { key: string; emoji: string; label: string }
export type Standup = { greeting: string; dateLabel: string; lines: StandupLine[]; pendingCount: number; pendingTitles: string[]; calendarConnected: boolean; connectPrompts: ConnectPrompt[] }

export async function assembleStandup(admin: any, userId: string, firstName?: string | null, brandId?: string | null): Promise<Standup> {
  const now = new Date()
  const hr = now.getUTCHours()
  const part = hr < 11 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'
  const greeting = `${part}${firstName ? `, ${firstName}` : ''}.`
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

  const { departments, tasks } = await computeCompanyStatus(admin, userId, brandId)
  const lines: StandupLine[] = []

  // Live departments that actually have something to report today (skip the ones sitting idle so the
  // standup stays a signal, not a wall of "all quiet").
  for (const d of departments) {
    if (!d.live) continue
    if (d.key === 'customer') continue // handled with real inbox numbers below
    if (d.status === 'idle') continue
    if (!d.detail || /nothing needs|all quiet/i.test(d.detail)) continue
    lines.push({ key: d.key, emoji: d.emoji, name: d.name, text: d.detail })
  }

  // Customer — grounded in the real inbox: what came in over the last 24h, and the top thing they want.
  try {
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
    const { data: msgs } = await admin.from('customer_messages').select('intent,direction,created_at')
      .eq('user_id', userId).eq('direction', 'in').gte('created_at', since)
    const inbound = (msgs || []) as any[]
    if (inbound.length) {
      const by: Record<string, number> = {}
      for (const m of inbound) if (m.intent) by[m.intent] = (by[m.intent] || 0) + 1
      const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0]
      const cust = departments.find(d => d.key === 'customer')
      // When one thing clearly dominates (a real trend, not a single stray message), append the fix —
      // "12 about shipping → add delivery times to your FAQ" — the Customer Success trends signal, in one line.
      const { quickFixShort } = await import('@/lib/customer/insights')
      const fix = top && top[1] >= 3 ? quickFixShort(top[0]) : ''
      const text = top
        ? `${inbound.length} message${inbound.length === 1 ? '' : 's'} — mostly about ${top[0]} (${top[1]})${fix ? ` → ${fix}` : ''}.`
        : `${inbound.length} new message${inbound.length === 1 ? '' : 's'} to handle.`
      lines.push({ key: 'customer', emoji: cust?.emoji || '💬', name: cust?.name || 'Customer', text })
    }
  } catch { /* inbox is best-effort */ }

  // Calendar — only shows as a department line when CONNECTED (with the real next meeting). If not
  // connected, it becomes a small chip in connectPrompts instead of a big line.
  const connectPrompts: ConnectPrompt[] = []
  let calendarConnected = false
  try {
    const { data: cal } = await admin.from('channel_identities').select('external_id, meta, provider')
      .eq('user_id', userId).eq('provider', 'calendar').eq('active', true).limit(1).maybeSingle()
    const acct = cal?.meta?.unipile_account_id || cal?.external_id
    if (acct) {
      calendarConnected = true
      const { getNextEvent } = await import('@/lib/channels/unipile')
      const ev = await getNextEvent(String(acct))
      if (ev) {
        const t = ev.start ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : ''
        lines.push({ key: 'calendar', emoji: '📅', name: 'Calendar', text: `${ev.title}${t ? ` at ${t}` : ''}.` })
      } else {
        lines.push({ key: 'calendar', emoji: '📅', name: 'Calendar', text: 'No meetings on your calendar today.' })
      }
    }
  } catch { /* calendar is best-effort */ }
  if (!calendarConnected) connectPrompts.push({ key: 'calendar', emoji: '📅', label: 'Add your calendar' })

  // Founder comms for the brief itself — Slack (teams) or WhatsApp (solo). Small chip if neither linked.
  try {
    const { data: comms } = await admin.from('channel_identities').select('provider, meta')
      .eq('user_id', userId).in('provider', ['slack', 'whatsapp']).eq('active', true)
    const hasFounderComms = (comms || []).some((c: any) => !c?.meta?.customer_channel)
    if (!hasFounderComms) connectPrompts.push({ key: 'comms', emoji: '💬', label: 'Get briefs on Slack or WhatsApp' })
  } catch { /* best-effort */ }

  const pending = (tasks as any[]).filter(t => t.status === 'suggested')
  return {
    greeting, dateLabel, lines,
    pendingCount: pending.length,
    pendingTitles: pending.slice(0, 6).map(t => String(t.title || 'A decision')),
    calendarConnected, connectPrompts,
  }
}
