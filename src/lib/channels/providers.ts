/**
 * Channel provider primitives — the thin send/verify layer for Slack + WhatsApp (Unipile).
 * Modeled on src/lib/email.ts: read process.env, best-effort, never throw. All app logic lives in
 * send.ts / the webhooks; this file only knows how to talk to each provider's HTTP API.
 */
import crypto from 'crypto'

// ── Slack ───────────────────────────────────────────────────────────────────
export const slackEnabled = !!process.env.SLACK_BOT_TOKEN

/** Post a message to a Slack channel/DM. Returns the message ts (id) so we can update it later.
 *  botToken lets each workspace install use ITS OWN token (multi-tenant); falls back to the env token. */
export async function slackPost(channel: string, text: string, blocks?: any[], botToken?: string): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const token = botToken || process.env.SLACK_BOT_TOKEN
  if (!token) return { ok: false, error: 'no_token' }
  try {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
    }).then((x) => x.json())
    return r?.ok ? { ok: true, ts: r.ts } : { ok: false, error: r?.error || 'slack_error' }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/** Replace an already-posted Slack card (e.g. turn the buttons into "Approved ✓"). */
export async function slackUpdate(channel: string, ts: string, text: string, blocks?: any[], botToken?: string): Promise<boolean> {
  const token = botToken || process.env.SLACK_BOT_TOKEN
  if (!token) return false
  try {
    const r = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, ts, text, ...(blocks ? { blocks } : {}) }),
    }).then((x) => x.json())
    return !!r?.ok
  } catch { return false }
}

/** Post to a Slack response_url (used to reply to an interactive action / slash command). */
export async function slackRespond(responseUrl: string, text: string, blocks?: any[], replaceOriginal = false): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(blocks ? { blocks } : {}), replace_original: replaceOriginal, response_type: 'in_channel' }),
    })
  } catch { /* best-effort */ }
}

/** Open (or reuse) a DM channel with a Slack user, returning the channel id to post into. */
export async function slackOpenDm(userId: string, botToken?: string): Promise<string | null> {
  const token = botToken || process.env.SLACK_BOT_TOKEN
  if (!token) return null
  try {
    const r = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify({ users: userId }),
    }).then((x) => x.json())
    return r?.ok ? r.channel?.id || null : null
  } catch { return null }
}

export const slackOAuthConfigured = !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET)
/** The "Add to Slack" authorize URL. state carries our one-time link code → binds to the founder. */
export function slackAuthorizeUrl(redirectUri: string, state: string): string {
  const scope = 'chat:write,commands,im:write'
  return `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(process.env.SLACK_CLIENT_ID || '')}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
}
/** Exchange the OAuth code for this workspace's bot token + the installing user's id. */
export async function slackOAuthExchange(code: string, redirectUri: string): Promise<{ ok: boolean; botToken?: string; teamId?: string; teamName?: string; authedUserId?: string; error?: string }> {
  const client_id = process.env.SLACK_CLIENT_ID, client_secret = process.env.SLACK_CLIENT_SECRET
  if (!client_id || !client_secret) return { ok: false, error: 'no_client' }
  try {
    const body = new URLSearchParams({ client_id, client_secret, code, redirect_uri: redirectUri })
    const r = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).then(x => x.json())
    if (!r?.ok) return { ok: false, error: r?.error || 'oauth_failed' }
    return { ok: true, botToken: r.access_token, teamId: r.team?.id, teamName: r.team?.name, authedUserId: r.authed_user?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/** Verify a Slack request signature (v0 HMAC). Pass the RAW body string. */
export function slackVerify(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) return true                       // unset → skip (dev); set it in prod
  if (!timestamp || !signature) return false
  // reject requests older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const base = `v0:${timestamp}:${rawBody}`
  const mine = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(signature)) } catch { return false }
}

// ── WhatsApp via Unipile ─────────────────────────────────────────────────────
// Unipile is a hosted API: base URL + port are per-account (e.g. https://apiXXXX.unipile.com:13XXX),
// auth via X-API-KEY. Set UNIPILE_DSN (the full base, no trailing slash) + UNIPILE_API_KEY +
// UNIPILE_WHATSAPP_ACCOUNT_ID (the connected WhatsApp account in your Unipile dashboard).
export const whatsappEnabled = !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY && process.env.UNIPILE_WHATSAPP_ACCOUNT_ID)

const uniBase = () => (process.env.UNIPILE_DSN || '').replace(/\/$/, '')
const uniHeaders = () => ({ 'content-type': 'application/json', 'X-API-KEY': process.env.UNIPILE_API_KEY || '', accept: 'application/json' })

export const unipileReady = () => !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY)

/**
 * Send a message from ANY connected Unipile account (WhatsApp, Instagram, …) — used for customer
 * replies where the account is dynamic (bound per-founder via hosted auth), not the env one. Reply into
 * a known chat, or start one with `toAttendee` (the customer's provider id). Same Unipile endpoints.
 */
export async function unipileSend(accountId: string, opts: { chatId?: string; toAttendee?: string; text: string }): Promise<{ ok: boolean; id?: string; chatId?: string; error?: string }> {
  if (!unipileReady()) return { ok: false, error: 'not_configured' }
  try {
    if (opts.chatId) {
      const r = await fetch(`${uniBase()}/api/v1/chats/${encodeURIComponent(opts.chatId)}/messages`, {
        method: 'POST', headers: uniHeaders(), body: JSON.stringify({ text: opts.text }),
      }).then((x) => x.json())
      return { ok: true, id: r?.id || r?.message_id, chatId: opts.chatId }
    }
    const r = await fetch(`${uniBase()}/api/v1/chats`, {
      method: 'POST', headers: uniHeaders(),
      body: JSON.stringify({ account_id: accountId, attendees_ids: [opts.toAttendee], text: opts.text }),
    }).then((x) => x.json())
    return { ok: true, id: r?.message_id || r?.id, chatId: r?.chat_id || r?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/**
 * Send a WhatsApp message. If `chatId` is known (from a prior inbound), reply into it; otherwise
 * start a new chat to `toAttendee` (the recipient's WhatsApp id / phone). Returns the message id.
 */
export async function whatsappSend(opts: { chatId?: string; toAttendee?: string; text: string }): Promise<{ ok: boolean; id?: string; chatId?: string; error?: string }> {
  if (!whatsappEnabled) return { ok: false, error: 'not_configured' }
  const accountId = process.env.UNIPILE_WHATSAPP_ACCOUNT_ID!
  try {
    if (opts.chatId) {
      const r = await fetch(`${uniBase()}/api/v1/chats/${encodeURIComponent(opts.chatId)}/messages`, {
        method: 'POST', headers: uniHeaders(), body: JSON.stringify({ text: opts.text }),
      }).then((x) => x.json())
      return { ok: true, id: r?.id || r?.message_id, chatId: opts.chatId }
    }
    // Start a new chat with the recipient on the WhatsApp account.
    const r = await fetch(`${uniBase()}/api/v1/chats`, {
      method: 'POST', headers: uniHeaders(),
      body: JSON.stringify({ account_id: accountId, attendees_ids: [opts.toAttendee], text: opts.text }),
    }).then((x) => x.json())
    return { ok: true, id: r?.message_id || r?.id, chatId: r?.chat_id || r?.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}
