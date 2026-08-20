/**
 * Google Search Console access — shared helper. Same service-account JWT flow the /admin/seo metrics
 * route uses, extracted so the rank-history snapshot cron can reuse it without duplicating the signing.
 * Configure with GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GSC_PROPERTY (e.g. "sc-domain:tryselfmade.ai").
 */
import crypto from 'crypto'

export function gscProperty(): string | null {
  return process.env.GSC_PROPERTY || null
}

/** Mint a short-lived read-only Search Console access token from the service account. Null if unset. */
export async function gscToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SA_EMAIL
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (!email || !key) return null
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`
  try {
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
    })
    if (!r.ok) return null
    return (await r.json()).access_token || null
  } catch { return null }
}

/**
 * Run a Search Analytics query. Defaults to a 7-day window ending 2 days ago (GSC data lags ~2 days),
 * which is the smoothed position we snapshot daily. Returns the raw rows, or null if unconfigured/failed.
 */
export async function gscQuery(
  body: { dimensions?: string[]; rowLimit?: number; dimensionFilterGroups?: any[] },
  range?: { startDate: string; endDate: string },
): Promise<Array<{ keys?: string[]; position: number; clicks: number; impressions: number; ctr: number }> | null> {
  const property = gscProperty()
  const token = await gscToken()
  if (!property || !token) return null
  const endDate = range?.endDate || new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
  const startDate = range?.startDate || new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10)
  try {
    const r = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, ...body }),
      },
    )
    if (!r.ok) return null
    return (await r.json())?.rows || []
  } catch {
    return null
  }
}
