/**
 * GET /api/audit/stream?domain=… — Server-Sent Events stream of the SEO scan. Emits each section as it
 * completes so the theater shows REAL numbers mid-scan (spam %, catalog count, Google ranks, AI reads).
 * PREVIEW/BRANCH — no login (lead magnet).
 */
import { NextRequest } from 'next/server'
import { scanStream, normalizeDomain, saveScan } from '@/lib/audit/scan'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const domain = normalizeDomain(req.nextUrl.searchParams.get('domain') || '')
  const rival = normalizeDomain(req.nextUrl.searchParams.get('rival') || '') || undefined
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        for await (const ev of scanStream(domain, rival)) {
          send(ev)
          // Persist the finished scan so it carries into the logged-in product (theater → dashboard).
          if (ev.type === 'done') { try { await saveScan(createAdminClient() as any, ev.result) } catch { /* best-effort */ } }
        }
      } catch (e: any) {
        send({ type: 'error', error: String(e?.message || e).slice(0, 160) })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } })
}
