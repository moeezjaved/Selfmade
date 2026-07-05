/**
 * Step 1 of the Assets upload (spec §10.4): validate + issue a short-lived presigned R2 PUT URL.
 * The app never streams the bytes — the client PUTs straight to R2, then confirms via POST /api/assets.
 * THE STORAGE CAP LIVES HERE: sum(size_bytes) for the org + this file must fit plan.assetsGb, else 402.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { getPlanId } from '@/lib/entitlements'
import { planEntitlements, nextPlan } from '@/lib/plans'
import { presignPut, isR2Configured } from '@/lib/r2'
import { randomUUID } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Only real media — block SVG/HTML/exe (XSS + malware vectors).
const MIME: Record<string, { cat: 'image' | 'video' | 'audio'; ext: string; cap: number }> = {
  'image/png': { cat: 'image', ext: 'png', cap: 25e6 }, 'image/jpeg': { cat: 'image', ext: 'jpg', cap: 25e6 },
  'image/webp': { cat: 'image', ext: 'webp', cap: 25e6 }, 'image/gif': { cat: 'image', ext: 'gif', cap: 25e6 },
  'video/mp4': { cat: 'video', ext: 'mp4', cap: 500e6 }, 'video/quicktime': { cat: 'video', ext: 'mov', cap: 500e6 },
  'video/webm': { cat: 'video', ext: 'webm', cap: 500e6 },
  'audio/mpeg': { cat: 'audio', ext: 'mp3', cap: 50e6 }, 'audio/wav': { cat: 'audio', ext: 'wav', cap: 50e6 }, 'audio/mp4': { cat: 'audio', ext: 'm4a', cap: 50e6 },
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isR2Configured()) return NextResponse.json({ error: 'not_configured', message: 'R2 storage is not configured.' }, { status: 503 })

  const { fileType, sizeBytes } = await req.json().catch(() => ({}))
  const spec = MIME[String(fileType || '')]
  if (!spec) return NextResponse.json({ error: 'unsupported_type', message: 'Only images, videos and audio can be uploaded.' }, { status: 400 })
  const size = Math.floor(Number(sizeBytes))
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'bad_size' }, { status: 400 })
  if (size > spec.cap) return NextResponse.json({ error: 'file_too_large', message: `${spec.cat} files must be under ${Math.round(spec.cap / 1e6)} MB.` }, { status: 400 })

  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)

  // ── STORAGE CAP by plan.assetsGb (Free 0.5 / Starter 5 / Pro 50 / Business 250 / Enterprise ∞) ──
  const plan = await getPlanId(admin, org.ownerId)
  const limitGb = planEntitlements(plan).assetsGb   // null = uncapped (enterprise)
  if (limitGb != null) {
    const { data: rows } = await admin.from('assets').select('size_bytes').eq('org_id', org.orgId)
    const used = (rows || []).reduce((s: number, r: any) => s + Number(r.size_bytes || 0), 0)
    const limitBytes = limitGb * 1e9
    if (used + size > limitBytes) {
      return NextResponse.json({
        error: 'storage_limit',
        usedGb: Math.round(used / 1e9 * 100) / 100, limitGb,
        upgradeTo: nextPlan(plan) || 'business',
        message: `Storage full (${(used / 1e9).toFixed(2)} / ${limitGb} GB). Upgrade for more space.`,
      }, { status: 402 })
    }
  }

  const assetId = randomUUID()
  const key = `orgs/${org.orgId}/assets/${assetId}.${spec.ext}`
  const uploadUrl = await presignPut(key, fileType, size)
  if (!uploadUrl) return NextResponse.json({ error: 'presign_failed' }, { status: 500 })

  return NextResponse.json({ uploadUrl, key, assetId, fileType, cat: spec.cat, expiresIn: 300 })
}
