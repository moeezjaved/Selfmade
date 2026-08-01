import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runMetaAudit } from '@/lib/meta/audit'

/**
 * POST /api/meta/reaudit — re-run the nightly audit NOW, on demand.
 *
 * Why it exists: the stored brief_event (what the Facebook card + "What Mello would do" render on load,
 * zero live calls) is only as fresh as the last nightly run. After the founder pins a new primary
 * account (★ Set as main), the stored data is for the OLD account — so the brief flashes the wrong
 * numbers then self-heals, and the opportunity cards lag behind. Re-running the audit here rewrites the
 * stored event for the CORRECT primary, so the very next load is clean: no flash, everything one account.
 *
 * Cheap enough for an explicit tap (a handful of Graph calls), never on page load. Best-effort.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const admin = createAdminClient()
    // syncFirst:false — we don't need to re-pull the whole campaign history, just re-grade + re-store
    // the audit + opportunities for the (now correct) primary account.
    await runMetaAudit(admin, user.id, { syncFirst: false })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'reaudit failed' }, { status: 200 })
  }
}
