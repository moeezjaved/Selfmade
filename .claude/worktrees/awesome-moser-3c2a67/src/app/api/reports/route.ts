import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const dateRange = request.nextUrl.searchParams.get('dateRange') || 'last_7d'
    const days = parseInt(dateRange.replace('last_','').replace('d','')) || 7

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = "act_" + metaAccount.account_id
    const currency = metaAccount.currency || 'PKR'

    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const until = new Date().toISOString().split('T')[0]
    const timeRange = JSON.stringify({ since, until })

    const get = async (params: Record<string,string>) => {
      const url = "https://graph.facebook.com/" + V + "/" + adAccountId + "/insights?" +
        new URLSearchParams({ ...params, access_token: token })
      const res = await fetch(url)
      return res.json()
    }

    const parseInsight = (ins: any) => {
      const spend = parseFloat(ins.spend || '0')
      const revenue = parseFloat(ins.action_values?.find((a:any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
      const conversions = parseInt(ins.actions?.find((a:any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
      const clicks = parseInt(ins.clicks || '0')
      const impressions = parseInt(ins.impressions || '0')
      const ctr = parseFloat(ins.ctr || '0')
      const cpc = parseFloat(ins.cpc || '0')
      return {
        spend, revenue, conversions, clicks, impressions, ctr, cpc,
        roas: spend > 0 ? revenue / spend : 0,
        cpa: conversions > 0 ? spend / conversions : 0,
      }
    }

    // Overview
    const overviewRes = await get({
      fields: 'spend,action_values,actions,clicks,impressions,ctr,cpc',
      time_range: timeRange,
    })
    const overviewIns = overviewRes.data?.[0]
    const overview = overviewIns ? parseInsight(overviewIns) : {}

    // Best creatives (ad level) with ad_id for thumbnail
    const creativesRes = await get({
      fields: 'ad_name,ad_id,spend,action_values,actions,impressions,clicks,ctr,cpc',
      time_range: timeRange,
      level: 'ad',
      limit: '20',
    })
    const creativesRaw = (creativesRes.data || [])
      .map((ins:any) => ({ name: ins.ad_name, ad_id: ins.ad_id, ...parseInsight(ins) }))
      .filter((c:any) => c.spend > 0)
      .sort((a:any,b:any) => b.roas - a.roas)

    // Fetch thumbnails and preview URLs for top 10 creatives
    const creatives = await Promise.all(creativesRaw.slice(0, 10).map(async (c:any) => {
      if (!c.ad_id) return c
      try {
        const adRes = await fetch(
          `https://graph.facebook.com/${V}/${c.ad_id}?fields=creative{thumbnail_url,effective_object_story_id,object_story_spec}&access_token=${token}`
        )
        const adData = await adRes.json()
        const creative = adData.creative || {}
        const previewUrl = creative.effective_object_story_id
          ? `https://www.facebook.com/${creative.effective_object_story_id}`
          : null
        return {
          ...c,
          thumbnail_url: creative.thumbnail_url || null,
          preview_url: previewUrl,
        }
      } catch(e) {
        return c
      }
    }))
    // Add remaining without thumbnails
    creativesRaw.slice(10).forEach((c:any) => creatives.push(c))

    // Age breakdown
    const ageRes = await get({
      fields: 'spend,action_values,actions,impressions,clicks',
      time_range: timeRange,
      breakdowns: 'age',
    })
    const age = (ageRes.data || [])
      .map((ins:any) => ({ age_range: ins.age, ...parseInsight(ins) }))
      .filter((r:any) => r.spend > 0)
      .sort((a:any,b:any) => b.conversions - a.conversions)

    // Gender breakdown
    const genderRes = await get({
      fields: 'spend,action_values,actions,impressions,clicks',
      time_range: timeRange,
      breakdowns: 'gender',
    })
    const gender = (genderRes.data || [])
      .map((ins:any) => ({ gender: ins.gender, ...parseInsight(ins) }))
      .filter((r:any) => r.spend > 0)

    // Placement breakdown
    const placementRes = await get({
      fields: 'spend,action_values,actions,impressions,clicks,ctr',
      time_range: timeRange,
      breakdowns: 'publisher_platform,platform_position',
    })
    const placement = (placementRes.data || [])
      .map((ins:any) => ({
        placement: `${ins.publisher_platform} — ${ins.platform_position}`,
        ...parseInsight(ins)
      }))
      .filter((r:any) => r.spend > 0)
      .sort((a:any,b:any) => b.roas - a.roas)

    // Device breakdown
    const deviceRes = await get({
      fields: 'spend,action_values,actions,impressions,clicks,ctr',
      time_range: timeRange,
      breakdowns: 'device_platform',
    })
    const device = (deviceRes.data || [])
      .map((ins:any) => ({ device: ins.device_platform, ...parseInsight(ins) }))
      .filter((r:any) => r.spend > 0)
      .sort((a:any,b:any) => b.roas - a.roas)

    // Hourly breakdown
    const hourlyRes = await get({
      fields: 'spend,action_values,actions',
      time_range: timeRange,
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    })
    const hourly = (hourlyRes.data || [])
      .map((ins:any) => ({ hour: ins.hourly_stats_aggregated_by_advertiser_time_zone, ...parseInsight(ins) }))
      .filter((r:any) => r.spend > 0)
      .sort((a:any,b:any) => b.conversions - a.conversions)

    // Daily breakdown
    const dailyRes = await get({
      fields: 'spend,action_values,actions',
      time_range: timeRange,
      time_increment: '1',
    })
    const days_map = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const daily = (dailyRes.data || [])
      .map((ins:any) => ({
        day: days_map[new Date(ins.date_start).getDay()] + ' ' + ins.date_start,
        ...parseInsight(ins)
      }))
      .filter((r:any) => r.spend > 0)
      .sort((a:any,b:any) => b.conversions - a.conversions)

    // Geographic breakdown
    const geoRes = await get({
      fields: 'spend,action_values,actions',
      time_range: timeRange,
      breakdowns: 'region',
    })
    const geographic = (geoRes.data || [])
      .map((ins:any) => ({ region: ins.region, ...parseInsight(ins) }))
      .filter((r:any) => r.spend > 0)
      .sort((a:any,b:any) => b.conversions - a.conversions)
      .slice(0, 15)

    return NextResponse.json({
      currency, overview, creatives, age, gender,
      placement, device, hourly, daily, geographic,
    })

  } catch (err: any) {
    console.error('Reports error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
