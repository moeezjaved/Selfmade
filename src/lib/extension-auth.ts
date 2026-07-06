/**
 * Auth for the Chrome extension's API calls. The extension holds an `sk_mcp_…` token (the same
 * mcp_keys row minted by the /extension/auth handshake) and sends it as `Authorization: Bearer`.
 * We validate it here and hand back the owning user_id. Distinct from the session-cookie auth the
 * web UI uses — the extension has no cookies for tryselfmade.ai.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function userIdFromExtensionToken(request: NextRequest): Promise<string | null> {
  const h = request.headers.get('authorization') || ''
  const token = h.replace(/^Bearer\s+/i, '').trim()
  if (!token || !token.startsWith('sk_mcp_')) return null
  const admin = createAdminClient() as any
  const { data } = await admin.from('mcp_keys').select('user_id').eq('token', token).eq('revoked', false).maybeSingle()
  if (!data?.user_id) return null
  // best-effort touch; don't await/block the request
  admin.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('token', token).then(() => {}, () => {})
  return data.user_id as string
}
