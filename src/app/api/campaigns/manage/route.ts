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
    const accountId = request.nextUrl.searchParams.get('account_id')

    let accountQuery = admin.from('meta_accounts').select('*').eq('user_id', user.id)
    if (accountId) {
      accountQuery = accountQuery.eq('account_id', accountId)
    } else {
      accountQuery = accountQuery.eq('is_primary', true)
    }
    const { data: metaAccount } = await accountQuery.single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = 'act_' + metaAccount.account_id

    // Fetch campaigns with effective_status filter - only ACTIVE and PAUSED
    const params = new URLSearchParams({
      fields: 'id,name,status,effective_status,objective,daily_budget,adsets{id,name,status,daily_budget,targeting,ads{id,name,status,creative{id,body,title,link_url,object_story_spec}}}',
      effective_status: '["ACTIVE","PAUSED"]',
      limit: '50',
      access_token: token,
    })

    const url = `https://graph.facebook.com/${V}/${adAccountId}/campaigns?${params}`
    const res = await fetch(url)
    const campData = await res.json()

    console.log('Total campaigns from Meta:', campData.data?.length, 'statuses:', campData.data?.map((c:any) => c.status + '/' + c.effective_status))
    if (campData.error) return NextResponse.json({ error: campData.error.message }, { status: 400 })

    const campaigns = (campData.data || [])
      .filter((camp: any) => camp.effective_status === 'ACTIVE' || camp.effective_status === 'PAUSED' || camp.status === 'ACTIVE' || camp.status === 'PAUSED')
      .map((camp: any) => {
        const adsets = (camp.adsets?.data || []).map((adset: any) => {
          const targeting = adset.targeting || {}
          const ads = (adset.ads?.data || []).map((ad: any) => {
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
          return {
            id: adset.id,
            name: adset.name,
            status: adset.status,
            age_min: targeting.age_min || 18,
            age_max: targeting.age_max || 65,
            genders: targeting.genders || [],
            ads,
          }
        })
        return {
          id: camp.id,
          name: camp.name,
          status: camp.status,
          effective_status: camp.effective_status,
          objective: camp.objective,
          daily_budget: camp.daily_budget,
          created_time: camp.created_time,
          adsets
        }
      })

    // Sort: ACTIVE first, then by created_time newest first
    campaigns.sort((a: any, b: any) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1
      if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1
      // Both same status - sort by created_time newest first
      const dateA = new Date(a.created_time || 0).getTime()
      const dateB = new Date(b.created_time || 0).getTime()
      return dateB - dateA
    })

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

    if (body.action === 'update_adset') {
      const targeting: Record<string, unknown> = {}
      if (body.age_min) targeting.age_min = body.age_min
      if (body.age_max) targeting.age_max = body.age_max
      if (body.genders && body.genders.length > 0) targeting.genders = body.genders
      await post(body.id, { targeting })
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

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
