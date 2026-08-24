/**
 * POST /api/audit/run { domain } — the public SEO scan (lead magnet, no login). Runs the real crawl + GEO
 * checks on a raw domain and returns the structured result the theater + report render. Cached per domain
 * (in-memory) so re-opening a report is instant and we don't re-crawl on every poll.
 *
 * PREVIEW/BRANCH — not wired into production; robots-noindex on the page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runScan, normalizeDomain, type ScanResult } from '@/lib/audit/scan'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

const cache = new Map<string, { at: number; data: ScanResult }>()
const TTL = 30 * 60 * 1000

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const domain = normalizeDomain(body.domain || '')
  if (!domain || !domain.includes('.')) return NextResponse.json({ error: 'Enter a real website, like yourstore.com' }, { status: 400 })

  const hit = cache.get(domain)
  if (hit && Date.now() - hit.at < TTL && !body.fresh) return NextResponse.json(hit.data)

  const res = await runScan(domain)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 400 })
  cache.set(domain, { at: Date.now(), data: res })
  return NextResponse.json(res)
}
