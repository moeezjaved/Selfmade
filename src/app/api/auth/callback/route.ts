import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/meta/client'

const META_APP_ID = process.env.META_APP_ID!
const META_APP_SECRET = process.env.META_APP_SECRET!
const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/connect-meta?error=${encodeURIComponent(searchParams.get('error_description') || error)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/connect-meta?error=no_code`)
  }

  try {
    // Use the same origin as the request for redirect_uri
    const redirectUri = `${appUrl}/api/auth/callback`

    const tokenRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      })
    )

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      throw new Error(tokenData.error?.message || 'Failed to get access token')
    }

    // Get long-lived token
    const llRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: tokenData.access_token,
      })
    )
    const llData = await llRes.json()
    const longLivedToken = llData.access_token || tokenData.access_token

    // Get ad accounts
    const accountsRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?` +
      new URLSearchParams({
        fields: 'id,account_id,name,currency,timezone_name,account_status',
        access_token: longLivedToken,
      })
    )
    const accountsData = await accountsRes.json()
    const accounts = accountsData.data || []

    if (!accounts.length) {
      return NextResponse.redirect(`${appUrl}/connect-meta?error=no_accounts`)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${appUrl}/login`)

    const { encryptToken: encrypt } = await import('@/lib/meta/client')
    const encryptedToken = encrypt(longLivedToken)
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i]
      await supabase.from('meta_accounts').upsert({
        user_id: user.id,
        account_id: account.account_id || account.id.replace('act_', ''),
        account_name: account.name,
        access_token: encryptedToken,
        token_expires_at: expiresAt.toISOString(),
        currency: account.currency || 'USD',
        timezone: account.timezone_name || 'America/New_York',
        status: 'active',
        is_primary: i === 0,
      }, { onConflict: 'user_id,account_id' })
    }

    await supabase.from('activity_logs').insert({
      user_id: user.id,
      action_type: 'META_CONNECTED',
      entity_type: 'system',
      description: `Connected ${accounts.length} Meta ad account(s)`,
      performed_by: 'user',
    })

    return NextResponse.redirect(`${appUrl}/connect-meta?success=true`)
  } catch (err) {
    console.error('Meta OAuth error:', err)
    const message = err instanceof Error ? err.message : 'Connection failed'
    return NextResponse.redirect(
      `${appUrl}/connect-meta?error=${encodeURIComponent(message)}`
    )
  }
}
