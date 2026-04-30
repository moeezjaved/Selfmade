import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = 'act_' + metaAccount.account_id

    const get = async (path: string, params: Record<string, string>) => {
      const url = `https://graph.facebook.com/${V}/${path}?` + new URLSearchParams({ ...params, access_token: token })
      const res = await fetch(url)
      return res.json()
    }

    const campData = await get(adAccountId + '/campaigns', {
      fields: 'id,name,status,objective,daily_budget',
      limit: '50',
    })

    const campaigns = []
    for (const camp of (campData.data || [])) {
      const adsetData = await get(camp.id + '/adsets', {
        fields: 'id,name,status,daily_budget',
        limit: '20',
      })

      const adsets = []
      for (const adset of (adsetData.data || [])) {
        const adData = await get(adset.id + '/ads', {
          fields: 'id,name,status,creative{id,body,title,link_url,object_story_spec}',
          limit: '10',
        })

        const ads = (adData.data || []).map((ad: any) => {
          const creative = ad.creative || {}
          const spec = creative.object_story_spec?.link_data || creative.object_story_spec?.video_data || {}
          return {
            id: ad.id,
            name: ad.name,
            status: ad.status,
            creative_id: creative.id,
            primary_text: spec.message || creative.body || '',
            headline: spec.name || creative.title || '',
            link_url: spec.link || creative.link_url || '',
          }
        })

        adsets.push({ id: adset.id, name: adset.name, status: adset.status, ads })
      }

      campaigns.push({ ...camp, adsets })
    }

    return NextResponse.json({ campaigns })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const body = await request.json()

    const post = async (path: string, data: Record<string, unknown>) => {
      const url = `https://graph.facebook.com/${V}/${path}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, access_token: token })
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error.message)
      return json
    }

    if (body.action === 'toggle_status') {
      await post(body.id, { status: body.status })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'update_budget') {
      await post(body.id, { daily_budget: Math.round(body.budget * 100) })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'update_ad') {
      const creativeRes = await fetch(
        `https://graph.facebook.com/${V}/${body.creative_id}?fields=object_story_spec&access_token=${token}`
      )
      const creativeData = await creativeRes.json()
      const spec = creativeData.object_story_spec || {}

      const updatedSpec = { ...spec }
      if (spec.link_data) {
        updatedSpec.link_data = {
          ...spec.link_data,
          ...(body.primary_text && { message: body.primary_text }),
          ...(body.headline && { name: body.headline }),
          ...(body.link_url && { link: body.link_url }),
        }
      } else if (spec.video_data) {
        updatedSpec.video_data = {
          ...spec.video_data,
          ...(body.primary_text && { message: body.primary_text }),
          ...(body.headline && { title: body.headline }),
        }
      }

      const adAccountId = 'act_' + metaAccount.account_id
      const newCreative = await post(adAccountId + '/adcreatives', {
        name: 'Updated Creative',
        object_story_spec: updatedSpec,
      })

      await post(body.id, { creative: { creative_id: newCreative.id } })
      return NextResponse.json({ success: true })
    }

    if (body.action === "update_adset") {
      const targeting: Record<string,unknown> = {}
      if (body.age_min) targeting.age_min = body.age_min
      if (body.age_max) targeting.age_max = body.age_max
      if (body.genders && body.genders.length > 0) targeting.genders = body.genders
      await post(body.id, { targeting })
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
