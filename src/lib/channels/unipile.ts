/**
 * Unipile hosted auth — let a founder connect Instagram / WhatsApp from INSIDE Selfmade (like "Add to
 * Slack"), so Unipile stays invisible. We ask Unipile for a one-time connect link; the founder logs into
 * their channel on Unipile's hosted page; Unipile calls our notify_url with the new account_id, which we
 * bind to the founder in channel_identities. That account_id is how inbound customer DMs route to them.
 */
const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
const DSN = () => (process.env.UNIPILE_DSN || '').replace(/\/$/, '')

export const unipileConfigured = () => !!(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY)

const PROVIDER_MAP: Record<string, string> = { instagram: 'INSTAGRAM', whatsapp: 'WHATSAPP', messenger: 'MESSENGER' }

/** Create a hosted-auth link the founder visits to connect one channel. `name` carries userId:provider. */
export async function createHostedAuthLink(userId: string, provider: string): Promise<{ url: string } | { error: string }> {
  if (!unipileConfigured()) return { error: 'Channels aren’t set up on the server yet.' }
  const prov = PROVIDER_MAP[provider]
  if (!prov) return { error: 'Unsupported channel.' }
  try {
    const res = await fetch(`${DSN()}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-KEY': process.env.UNIPILE_API_KEY || '' },
      body: JSON.stringify({
        type: 'create',
        providers: [prov],
        api_url: DSN(),
        expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        name: `${userId}:${provider}`,
        notify_url: `${APP}/api/channels/unipile/callback`,
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
