/**
 * Identity binding — the "text this code to the bot to connect" flow. The founder generates a code
 * in the app; when that code arrives from a Slack user or WhatsApp number, we bind that external
 * identity to their account. This is the security keystone: a channel can only act for a founder who
 * proved control of the account by pasting a code minted while logged in.
 */
const CODE_TTL_MS = 15 * 60 * 1000

// Unambiguous alphabet (no O/0/I/1) → easy to type on a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomCode(): string {
  // crypto for unguessability; SM- prefix so we can recognize a code in an inbound message.
  const bytes = require('crypto').randomBytes(6) as Buffer
  let s = ''
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return `SM-${s}`
}

/** Detect a link code inside an arbitrary inbound message ("connect SM-4F9K2A", "SM4F9K2A"). */
export function extractCode(text: string): string | null {
  const m = String(text || '').toUpperCase().match(/SM-?[A-Z0-9]{6}/)
  if (!m) return null
  const raw = m[0].replace(/^SM-?/, '')
  return `SM-${raw}`
}

export async function mintCode(admin: any, userId: string, provider?: 'slack' | 'whatsapp'): Promise<string> {
  const code = randomCode()
  await admin.from('channel_link_codes').insert({
    code, user_id: userId, provider: provider || null,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  return code
}

/**
 * Redeem a code from an inbound channel event → bind (or refresh) the identity. Returns the bound
 * user_id, or null if the code is unknown/expired/used/wrong-provider.
 */
export async function redeemCode(
  admin: any, codeRaw: string, provider: 'slack' | 'whatsapp', externalId: string,
  meta: Record<string, any> = {}, display?: string,
): Promise<string | null> {
  const code = extractCode(codeRaw)
  if (!code) return null
  const { data: row } = await admin.from('channel_link_codes').select('*').eq('code', code).maybeSingle()
  if (!row) return null
  if (row.used_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  if (row.provider && row.provider !== provider) return null

  // Bind: upsert the identity (a given external id maps to exactly one account).
  await admin.from('channel_identities').upsert({
    user_id: row.user_id, provider, external_id: externalId, display: display || null,
    meta, verified: true, active: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,external_id' })
  await admin.from('channel_link_codes').update({ used_at: new Date().toISOString() }).eq('code', code)
  return row.user_id as string
}
