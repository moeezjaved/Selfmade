import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const META_APP_ID = process.env.META_APP_ID!
const APP_URL = 'https://www.tryselfmade.ai'
const REDIRECT_URI = `${APP_URL}/api/auth/callback`

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.redirect(`${APP_URL}/login`)

  const scopes = 'ads_management,ads_read,business_management,pages_read_engagement'
  const state = encodeURIComponent(btoa(JSON.stringify({ user_id: user.id, ts: Date.now() })))
  const metaUrl = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code&state=${state}`

  const response = NextResponse.redirect(metaUrl)
  response.cookies.set('meta_connect_user_id', user.id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return response
}
