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

export function _keyCount(): number {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map((s) => s.trim()).filter(Boolean).length
}

export async function GET() {
  if (!(await ok())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const keyCount = _keyCount()
  const proModel = modelFor('pro')
  const defaultModel = modelFor('default')
  const t0 = Date.now()
  const res = await generateImage('A simple flat vector illustration of a red circle centered on a plain white background.', [], 'pro', { imageSize: '1K' }).catch((e) => ({ ok: false as const, error: `threw: ${String((e as Error)?.message || e).slice(0, 200)}` }))
  return NextResponse.json({
    geminiEnabled, keyCount, proModel, defaultModel, ms: Date.now() - t0,
    result: res.ok ? { ok: true, model: (res as any).model, bytes: (res as any).dataB64?.length || 0 } : { ok: false, error: (res as any).error },
  })
}
