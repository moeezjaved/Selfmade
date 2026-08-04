/**
 * Unipile hosted auth — let a founder connect Instagram / WhatsApp from INSIDE Selfmade (like "Add to
 * Slack"), so Unipile stays invisible. We ask Unipile for a one-time connect link; the founder logs into
 * their channel on Unipile's hosted page; Unipile calls our notify_url with the new account_id, which we
 * bind to the founder in channel_identities. That account_id is how inbound customer DMs route to them.
 */
const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
// Tolerate a pasted DSN with stray whitespace / newline / missing scheme / trailing slash — otherwise
// fetch throws "Failed to parse URL". This is the #1 cause of connect failing.
const DSN = () => {
  let d = (process.env.UNIPILE_DSN || '').trim().replace(/\/+$/, '')
  if (d && !/^https?:\/\//i.test(d)) d = `https://${d}`
  return d
}
const KEY = () => (process.env.UNIPILE_API_KEY || '').trim()

export const unipileConfigured = () => !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY)

// What each Settings button offers on Unipile's hosted page. 'all' shows everything; email/calendar
// let the founder pick their mail provider (Google brings calendar too).
const PROVIDER_MAP: Record<string, string[]> = {
  instagram: ['INSTAGRAM'], whatsapp: ['WHATSAPP'], messenger: ['MESSENGER'], telegram: ['TELEGRAM'],
  linkedin: ['LINKEDIN'], x: ['TWITTER'], email: ['GOOGLE', 'OUTLOOK', 'IMAP'], calendar: ['GOOGLE'], all: ['*'],
}

/** Map a Unipile account type → the label we store (used by the callback after reading the real type). */
export function labelForType(type: string, requested?: string): string {
  if (requested === 'calendar') return 'calendar'
  const t = String(type || '').toUpperCase()
  if (t.includes('WHATSAPP')) return 'whatsapp'
  if (t.includes('INSTAGRAM')) return 'instagram'
  if (t.includes('MESSENGER')) return 'messenger'
  if (t.includes('TELEGRAM')) return 'telegram'
  if (t.includes('LINKEDIN')) return 'linkedin'
  if (t.includes('TWITTER') || t === 'X') return 'x'
  if (t.includes('GOOGLE') || t.includes('GMAIL') || t.includes('OUTLOOK') || t.includes('IMAP') || t.includes('MAIL')) return 'email'
  return requested || 'channel'
}

/** Look up a connected account's real provider type from Unipile (so we label it right). */
export async function fetchAccountType(accountId: string): Promise<string> {
  try {
    const res = await fetch(`${DSN()}/api/v1/accounts/${encodeURIComponent(accountId)}`, {
      headers: { accept: 'application/json', 'X-API-KEY': KEY() },
    })
    const j = await res.json().catch(() => ({}))
    return String(j?.type || j?.provider || j?.account_type || '')
  } catch { return '' }
}

/** Create a hosted-auth link the founder visits to connect one channel. `name` carries userId:provider.
 *  `returnTo` is the in-app path to come back to (e.g. /inbox or /settings). */
export async function createHostedAuthLink(userId: string, provider: string, returnTo?: string): Promise<{ url: string } | { error: string }> {
  if (!unipileConfigured()) return { error: 'Channels aren’t set up on the server yet.' }
  const provs = PROVIDER_MAP[provider] || ['*']
  const back = returnTo && returnTo.startsWith('/') ? returnTo : '/settings'
  try {
    const res = await fetch(`${DSN()}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-KEY': KEY() },
      body: JSON.stringify({
        type: 'create',
        providers: provs,
        api_url: DSN(),
        expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        name: `${userId}:${provider}`,
        notify_url: `${APP}/api/channels/unipile/callback${process.env.UNIPILE_WEBHOOK_SECRET ? `?secret=${encodeURIComponent(process.env.UNIPILE_WEBHOOK_SECRET)}` : ''}`,
        success_redirect_url: `${APP}${back}?connected=${provider}`,
        failure_redirect_url: `${APP}${back}?connect_error=${provider}`,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (j?.url) return { url: j.url }
    return { error: j?.detail || j?.message || 'Could not start the connection.' }
  } catch (e: any) {
    return { error: e?.message || 'Could not reach the channel service.' }
  }
}

/** The founder's next upcoming calendar event, via Unipile's calendar API. Defensive — shapes vary by
 *  version, so any hiccup returns null and the Standup falls back to a connect/no-meeting line. */
export async function getNextEvent(accountId: string): Promise<{ title: string; start: string } | null> {
  if (!unipileConfigured() || !accountId) return null
  const H = { accept: 'application/json', 'X-API-KEY': KEY() }
  try {
    const now = new Date()
    const end = new Date(now.getTime() + 24 * 3600 * 1000)
    const qs = new URLSearchParams({ account_id: accountId, after: now.toISOString(), before: end.toISOString(), limit: '1' })
    // Try a direct events endpoint first; fall back to listing a calendar then its events.
    let items: any[] = []
    const direct = await fetch(`${DSN()}/api/v1/calendar_events?${qs}`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null)
    items = direct?.items || direct?.data || []
    if (!items.length) {
      const cals = await fetch(`${DSN()}/api/v1/calendars?account_id=${encodeURIComponent(accountId)}`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null)
      const calId = (cals?.items || cals?.data || [])[0]?.id
      if (calId) {
        const evs = await fetch(`${DSN()}/api/v1/calendars/${encodeURIComponent(calId)}/events?${qs}`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null)
        items = evs?.items || evs?.data || []
      }
    }
    const e = items[0]
    if (!e) return null
    const title = String(e.title || e.summary || e.subject || 'a meeting')
    const start = String(e.start?.date_time || e.start_time || e.start || e.when || '')
    return { title, start }
  } catch { return null }
}

// Calendar is the FOUNDER's own (for the brief/EA), never a customer channel. Email counts as a customer
// channel (support inbox → Customer Inbox), same as Instagram/WhatsApp/Messenger.
export const isFounderTool = (provider: string) => provider === 'calendar'

/** Reconcile: Unipile overwrites the hosted-auth `name` with the account's own handle, so we can't match
 *  by our userId tag. Instead we CLAIM any Unipile account not yet bound to anyone, for this founder.
 *  (The connect redirect's account_id is the precise per-founder attribution; this backfills accounts
 *  that were connected before that landed / when notify didn't fire.)
 *  NOTE: "claim unbound" is safe while onboarding one workspace at a time; a true multi-tenant setup
 *  should rely solely on the redirect account_id + notify tag, not this backfill. */
export async function reconcileUnipileAccounts(admin: any, userId: string): Promise<number> {
  if (!unipileConfigured()) return 0
  try {
    const res = await fetch(`${DSN()}/api/v1/accounts`, { headers: { accept: 'application/json', 'X-API-KEY': KEY() } })
    const j = await res.json().catch(() => ({}))
    const items: any[] = j?.items || j?.data || (Array.isArray(j) ? j : [])
    if (!items.length) return 0
    const { data: existing } = await admin.from('channel_identities').select('external_id')
    const bound = new Set((existing || []).map((r: any) => String(r.external_id)))
    let n = 0
    for (const a of items) {
      const id = a?.id || a?.account_id
      if (!id) continue
      if (!bound.has(String(id))) {
        const provider = labelForType(a?.type || a?.provider || '')
        try { await bindUnipileAccount(admin, userId, provider, String(id)); bound.add(String(id)); n++ } catch { /* skip one */ }
      }
      // First time only: pull recent unanswered chats into the inbox so it isn't empty on connect.
      try { await backfillOnce(admin, String(id)) } catch { /* best-effort */ }
    }
    return n
  } catch { return 0 }
}

/** Backfill recent UNANSWERED conversations on a just-connected account into the Customer Inbox, so the
 *  founder immediately sees who's waiting (not an empty box). Bounded + defensive; last ~14 days, most
 *  recent 20 chats, only threads where the last message is from the customer. */
async function backfillUnipileAccount(admin: any, accountId: string): Promise<number> {
  if (!unipileConfigured() || !accountId) return 0
  const H = { accept: 'application/json', 'X-API-KEY': KEY() }
  const since = Date.now() - 14 * 24 * 3600 * 1000
  const { ingestCustomerMessage } = await import('@/lib/customer/ingest')
  try {
    const res = await fetch(`${DSN()}/api/v1/chats?account_id=${encodeURIComponent(accountId)}&limit=20`, { headers: H })
    const j = await res.json().catch(() => ({}))
    const chats: any[] = j?.items || j?.data || []
    let n = 0
    for (const c of chats.slice(0, 20)) {
      const chatId = c?.id || c?.chat_id
      if (!chatId) continue
      let last: any = c?.last_message || c?.lastMessage || null
      if (!last) {
        const m = await fetch(`${DSN()}/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=1`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null)
        last = (m?.items || m?.data || [])[0] || null
      }
      if (!last) continue
      // Only UNANSWERED — skip if the last message was ours.
      const fromMe = last.is_sender === true || last.from_me === true || /out|sent/i.test(String(last.direction || ''))
      if (fromMe) continue
      const ts = Date.parse(last.timestamp || last.created_at || c.timestamp || c.updated_at || '') || 0
      if (ts && ts < since) continue
      const sender = c.attendee_provider_id || c.provider_id || last?.from?.attendee_provider_id || last?.sender?.attendee_provider_id || last?.sender_id
      const senderName = c.name || c.attendee_name || last?.from?.attendee_name
      const text = last.text || last.body || ''
      if (!sender || !text) continue
      const ok = await ingestCustomerMessage(admin, { accountId, sender: String(sender), senderName, text, chatId: String(chatId) })
      if (ok) n++
    }
    return n
  } catch { return 0 }
}

/** Run the backfill exactly once per account (marked in meta.backfilled). Idempotent — safe to call on
 *  every reconcile; only the first call actually pulls history. */
export async function backfillOnce(admin: any, accountId: string): Promise<number> {
  const { data: id } = await admin.from('channel_identities').select('id, meta').eq('external_id', accountId).maybeSingle()
  if (!id || id.meta?.backfilled) return 0
  const n = await backfillUnipileAccount(admin, accountId)
  await admin.from('channel_identities').update({ meta: { ...(id.meta || {}), backfilled: true }, updated_at: new Date().toISOString() }).eq('id', id.id).then(() => {}, () => {})
  return n
}

/** Bind a freshly-connected Unipile account to the founder (called from the notify callback). */
export async function bindUnipileAccount(admin: any, userId: string, provider: string, accountId: string, display?: string) {
  const founder = isFounderTool(provider)
  await admin.from('channel_identities').upsert({
    user_id: userId, provider, external_id: accountId, display: display || null,
    active: true, meta: { unipile_account_id: accountId, source: 'unipile', customer_channel: !founder, founder_tool: founder },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,external_id' })
}
