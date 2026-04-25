import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pixelId, campaignName } = await request.json()
  if (!pixelId) return NextResponse.json({ error: 'Pixel ID required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: metaAccount } = await admin
    .from('meta_accounts')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .single()

  if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(metaAccount.access_token)
  const accountId = `act_${metaAccount.account_id}`

  const audiences = [
    {
      key: 'visitors_60d',
      name: `${campaignName} — Website Visitors 60d`,
      days: 60,
      event: 'PageView',
      description: 'People who visited your website in the last 60 days',
    },
    {
      key: 'visitors_180d',
      name: `${campaignName} — Website Visitors 180d`,
      days: 180,
      event: 'PageView',
      description: 'People who visited your website in the last 180 days',
    },
    {
      key: 'purchasers_180d',
      name: `${campaignName} — Purchasers 180d`,
      days: 180,
      event: 'Purchase',
      description: 'People who purchased from you in the last 180 days',
    },
    {
      key: 'add_to_cart_60d',
      name: `${campaignName} — Add to Cart 60d`,
      days: 60,
      event: 'AddToCart',
      description: 'People who added to cart but did not purchase in the last 60 days',
    },
  ]

  const created = []
  const errors = []

  for (const aud of audiences) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${V}/${accountId}/customaudiences`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: aud.name,
            rule: JSON.stringify({
              inclusions: {
                operator: 'or',
                rules: [{
                  event_sources: [{ id: pixelId, type: 'pixel' }],
                  retention_seconds: aud.days * 24 * 60 * 60,
                  filter: {
                    operator: 'and',
                    filters: [{ field: 'event', operator: 'eq', value: aud.event }]
                  }
                }]
              }
            }),
            prefill: true,
            access_token: token,
          })
        }
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      created.push({ key: aud.key, id: data.id, name: aud.name, description: aud.description })
    } catch (err: any) {
      errors.push({ key: aud.key, error: err.message })
    }
  }

  return NextResponse.json({ created, errors })
}
