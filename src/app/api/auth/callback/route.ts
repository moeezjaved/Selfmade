import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/meta/client'

const META_APP_ID = process.env.META_APP_ID!
const META_APP_SECRET = process.env.META_APP_SECRET!
const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'
const APP_URL = 'https://www.tryselfmade.ai'
const REDIRECT_URI = `${APP_URL}/api/auth/callback`

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  console.log('META CALLBACK:', { code: !!code, state: !!state, error })

  if (error) {
    return NextResponse.redirect(`${APP_URL}/connect-meta?error=${encodeURIComponent(searchParams.get('error_description') || error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${APP_URL}/connect-meta?error=no_code`)
  }

  let userId: string | null = null
  if (state) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(state)))
      userId = decoded.user_id
      console.log('USER ID FROM STATE:', userId)
    } catch (e) {
      console.log('STATE PARSE ERROR:', e)
    }
  }

  if (!userId) {
    console.log('NO USER ID - redirecting to login')
    return NextResponse.redirect(`${APP_URL}/login?redirect=/connect-meta`)
  }

  try {
    // Exchange code for token
    const tokenUrl = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({ client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: REDIRECT_URI, code })
    console.log('FETCHING TOKEN...')
    const tokenRes = await fetch(tokenUrl)
    const tokenData = await tokenRes.json()
    console.log('TOKEN RESPONSE:', JSON.stringify(tokenData).slice(0, 200))

    if (!tokenData.access_token) {
      throw new Error(tokenData.error?.message || 'Failed to get access token')
    }

    // Get long-lived token
    const llRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: tokenData.access_token })
    )
    const llData = await llRes.json()
    const longLivedToken = llData.access_token || tokenData.access_token
    console.log('LONG LIVED TOKEN:', !!longLivedToken)

    // Get ad accounts
    const accountsRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?` +
      new URLSearchParams({ fields: 'id,account_id,name,currency,timezone_name', access_token: longLivedToken })
    )
    const accountsData = await accountsRes.json()
    console.log('ACCOUNTS:', JSON.stringify(accountsData).slice(0, 300))
    const accounts = accountsData.data || []

    if (!accounts.length) {
      return NextResponse.redirect(`${APP_URL}/connect-meta?error=no_ad_accounts_found`)
    }

    const admin = createAdminClient()
    const encryptedToken = encryptToken(longLivedToken)
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i]
      const { error: upsertError } = await admin.from('meta_accounts').upsert({
        user_id: userId,
        account_id: account.account_id || account.id.replace('act_', ''),
        account_name: account.name,
        access_token: encryptedToken,
        token_expires_at: expiresAt.toISOString(),
        currency: account.currency || 'USD',
        timezone: account.timezone_name || 'America/New_York',
        status: 'active',
        is_primary: i === 0,
      }, { onConflict: 'user_id,account_id' })
      console.log('UPSERT RESULT:', upsertError ? JSON.stringify(upsertError) : 'SUCCESS')
    }

    return NextResponse.redirect(`${APP_URL}/connect-meta?success=true`)
  } catch (err) {
    console.error('META CALLBACK ERROR:', err)
    const message = err instanceof Error ? err.message : 'Connection failed'
    return NextResponse.redirect(`${APP_URL}/connect-meta?error=${encodeURIComponent(message)}`)
  }
}
