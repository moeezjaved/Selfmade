/**
 * Claim + read a scan after signup — the bridge from the free theater into the logged-in product.
 *   GET  /api/audit/claim            → the scan for the sf_scan_domain cookie (or ?domain=), claiming it
 *   POST { domain }                  → claim + return a specific domain's scan
 * Claiming stamps audit_scans.claimed_by so the SEO surfaces know this founder came from the theater and
 * can show their starting state (score, ranks, findings) with no re-scan.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { loadScanForDomain, normalizeDomain } from '@/lib/audit/scan'

export const dynamic = 'force-dynamic'

async function claim(req: NextRequest, domainRaw: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const domain = normalizeDomain(domainRaw)
  if (!domain) return NextResponse.json({ scan: null })
  const admin = createAdminClient() as any
  const scan = await loadScanForDomain(admin, domain)
  if (scan) { try { await admin.from('audit_scans').update({ claimed_by: user.id, updated_at: new Date().toISOString() }).eq('domain', domain) } catch { /* best-effort */ } }
  return NextResponse.json({ scan })
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get('sf_scan_domain')?.value || req.nextUrl.searchParams.get('domain') || ''
  return claim(req, decodeURIComponent(cookie))
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  return claim(req, String(body.domain || ''))
}
