import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * POST /api/meta/scale { metaCampaignId, newDailyBudget }  — the founder-confirmed "Scale it" action.
 *
 * This is the approve→act loop, direct from the brief's opportunity card: the audit SUGGESTED scaling
 * a winner; the founder set the budget and hit confirm; we raise that ONE campaign's daily budget on
 * their own ad account. Never auto-runs — the client only calls this after an explicit confirm. Uses
 * the user's own Meta token (they can only touch their own campaigns) and we double-check the campaign
 * belongs to them. `newDailyBudget` is in MAJOR units (e.g. 6 = €6.00); scaleCampaignBudget ×100s it.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { metaCampaignId, newDailyBudget } = await req.json().catch(() => ({}))
  const id = String(metaCampaignId || '').trim()
  const budget = Number(newDailyBudget)
  if (!id) return NextResponse.json({ error: 'metaCampaignId required' }, { status: 400 })
  if (!Number.isFinite(budget) || budget <= 0) return NextResponse.json({ error: 'A daily budget above 0 is required.' }, { status: 400 })
  if (budget > 100000) return NextResponse.json({ error: 'That budget looks too high — double-check the amount.' }, { status: 400 })

  const admin = createAdminClient()

  // Defense: the campaign must belong to THIS user (it came from their own audit, but never trust the
  // client). Their token already scopes to their accounts; this stops a stray/forged id.
  const { data: owned } = await admin.from('campaigns')
    .select('meta_campaign_id, name').eq('user_id', user.id).eq('meta_campaign_id', id).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'That campaign isn’t on your connected account — refresh the brief and try again.' }, { status: 404 })

  try {
    const { createMetaClientForUser } = await import('@/lib/meta/client')
    const mc = await createMetaClientForUser(user.id)
    if (!mc) return NextResponse.json({ error: 'Meta isn’t connected (or access expired) — reconnect and try again.' }, { status: 400 })

    await mc.scaleCampaignBudget(id, budget)

    // Durable log — the same trail the approve→act tasks write, so scaling shows in Activity.
    await admin.from('activity_logs').insert({
      user_id: user.id, action_type: 'META_SCALE', entity_type: 'campaign',
      description: `Scaled “${owned.name || id}” to ${budget}/day — approved from the brief`,
      performed_by: 'mello',
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, campaign: owned.name || id, newDailyBudget: budget })
  } catch (e: any) {
    const msg = String(e?.message || 'Scaling failed')
    return NextResponse.json({ error: /budget/i.test(msg) ? 'Meta rejected that budget — it may be below the campaign minimum. Try a bit higher.' : `Couldn’t scale it: ${msg}` }, { status: 400 })
  }
}
