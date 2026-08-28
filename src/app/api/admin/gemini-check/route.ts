/**
 * GET /api/admin/gemini-check — admin diagnostic for the image engine. Reports how many Gemini keys are
 * actually loaded, the resolved Pro model, and the RAW result of a tiny Pro text-to-image gen (so a
 * "busy" is revealed as its real cause: 503 high-demand vs 404 bad-model vs quota vs keys-not-read).
 * Temporary — remove once the image-engine issue is resolved.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'
import { generateImage, modelFor, geminiEnabled } from '@/lib/gemini/image'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function ok(): Promise<boolean> {
  try { const { data: { user } } = await (await createClient()).auth.getUser(); if (user) return true } catch { /* ignore */ }
  return isAdminToken()
}

function keyCountOf(): number {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map((s) => s.trim()).filter(Boolean).length
}

export async function GET() {
  if (!(await ok())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const keyCount = keyCountOf()
  const proModel = modelFor('pro')
  const defaultModel = modelFor('default')
  const t0 = Date.now()
  const res = await generateImage('A simple flat vector illustration of a red circle centered on a plain white background.', [], 'pro', { imageSize: '1K' }).catch((e) => ({ ok: false as const, error: `threw: ${String((e as Error)?.message || e).slice(0, 200)}` }))

  // RAW probe: hit the Pro model ONCE directly so we see the exact HTTP status + body Google returns
  // (generateImage collapses 429/503/etc. into "pro_model_busy", which hides quota-vs-overload).
  let raw: any = null
  try {
    const key = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map((s) => s.trim()).filter(Boolean)[0]
    const rr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${proModel}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'a red circle on white' }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
    })
    raw = { status: rr.status, body: (await rr.text().catch(() => '')).slice(0, 400) }
  } catch (e: any) { raw = { status: 0, body: String(e?.message || e).slice(0, 200) } }

  return NextResponse.json({
    geminiEnabled, keyCount, proModel, defaultModel, ms: Date.now() - t0,
    result: res.ok ? { ok: true, model: (res as any).model, bytes: (res as any).dataB64?.length || 0 } : { ok: false, error: (res as any).error },
    raw,
  })
}
