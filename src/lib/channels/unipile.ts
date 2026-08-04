/**
 * Unipile hosted auth — let a founder connect Instagram / WhatsApp from INSIDE Selfmade (like "Add to
 * Slack"), so Unipile stays invisible. We ask Unipile for a one-time connect link; the founder logs into
 * their channel on Unipile's hosted page; Unipile calls our notify_url with the new account_id, which we
 * bind to the founder in channel_identities. That account_id is how inbound customer DMs route to them.
 */
const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
const DSN = () => (process.env.UNIPILE_DSN || '').replace(/\/$/, '')

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
      headers: { accept: 'application/json', 'X-API-KEY': process.env.UNIPILE_API_KEY || '' },
    })
    const j = await res.json().catch(() => ({}))
    return String(j?.type || j?.provider || j?.account_type || '')
  } catch { return '' }
}

/** Create a hosted-auth link the founder visits to connect one channel. `name` carries userId:provider. */
export async function createHostedAuthLink(userId: string, provider: string): Promise<{ url: string } | { error: string }> {
  if (!unipileConfigured()) return { error: 'Channels aren’t set up on the server yet.' }
  const provs = PROVIDER_MAP[provider] || ['*']
  try {
    const res = await fetch(`${DSN()}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-KEY': process.env.UNIPILE_API_KEY || '' },
      body: JSON.stringify({
        type: 'create',
        providers: provs,
        api_url: DSN(),
        expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        name: `${userId}:${provider}`,
        notify_url: `${APP}/api/channels/unipile/callback${process.env.UNIPILE_WEBHOOK_SECRET ? `?secret=${encodeURIComponent(process.env.UNIPILE_WEBHOOK_SECRET)}` : ''}`,
        success_redirect_url: `${APP}/settings?connected=${provider}`,
        failure_redirect_url: `${APP}/settings?connect_error=${provider}`,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (j?.url) return { url: j.url }
    return { error: j?.detail || j?.message || 'Could not start the connection.' }
  } catch (e: any) {
    return { error: e?.message || 'Could not reach the channel service.' }
  }
}

/** Bind a freshly-connected Unipile account to the founder (called from the notify callback). */
export async function bindUnipileAccount(admin: any, userId: string, provider: string, accountId: string, display?: string) {
  await admin.from('channel_identities').upsert({
    user_id: userId, provider, external_id: accountId, display: display || null,
    active: true, meta: { unipile_account_id: accountId, source: 'unipile', customer_channel: true },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,external_id' })
}
