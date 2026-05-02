import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const META_APP_ID = process.env.META_APP_ID!
const APP_URL = 'https://www.tryselfmade.ai'
const REDIRECT_URI = `${APP_URL}/api/auth/callback`

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.redirect(`${APP_URL}/login`)

  const scopes = 'ads_management,ads_read,business_management,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish'
  const nonce = Math.random().toString(36).slice(2)
  const state = encodeURIComponent(btoa(JSON.stringify({ user_id: user.id, nonce, ts: Date.now() })))

  // Store nonce → user_id mapping in activity_logs temporarily
  const admin = createAdminClient()
  await admin.from('activity_logs').insert({
    user_id: user.id,
    action_type: 'META_OAUTH_STARTED',
    entity_type: nonce,
    description: user.id,
    performed_by: 'system',
  })

  const metaUrl = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code&state=${state}`
  return NextResponse.redirect(metaUrl)
}
