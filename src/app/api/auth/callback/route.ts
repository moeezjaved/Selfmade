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

  console.log('CALLBACK - code:', !!code, 'state:', !!state, 'error:', error)

  if (error) {
    const desc = searchParams.get('error_description') || searchParams.get('error_reason') || error
    console.log('FACEBOOK ERROR:', error, desc)
    return NextResponse.redirect(`${APP_URL}/connect-meta?error=${encodeURIComponent(desc)}`)
  }
  if (!code) {
    // Log all params to debug
    const allParams = Object.fromEntries(searchParams.entries())
    console.log('NO CODE - all params:', JSON.stringify(allParams))
    return NextResponse.redirect(`${APP_URL}/connect-meta?error=no_code`)
  }

  const admin = createAdminClient()
  let userId: string | null = null

  // Try state param
  if (state) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(state)))
      userId = decoded.user_id
      console.log('USER FROM STATE:', userId)
    } catch (e) {
      console.log('State parse error:', e)
    }
  }

  // Fallback: look up from activity_logs using nonce
  if (!userId && state) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(state)))
      const nonce = decoded.nonce
      if (nonce) {
        const { data } = await admin.from('activity_logs')
          .select('description')
          .eq('action_type', 'META_OAUTH_STARTED')
          .eq('entity_type', nonce)
          .single()
        if (data) {
          userId = data.description
          console.log('USER FROM DB LOOKUP:', userId)
        }
      }
    } catch (e) {
      console.log('DB lookup error:', e)
    }
  }

  console.log('FINAL USER ID:', userId)
  if (!userId) return NextResponse.redirect(`${APP_URL}/connect-meta?error=session_lost`)

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({ client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: REDIRECT_URI, code })
    )
    const tokenData = await tokenRes.json()
    console.log('TOKEN:', tokenData.access_token ? 'OK' : tokenData.error?.message)
    if (!tokenData.access_token) throw new Error(tokenData.error?.message || 'No access token')

    const llRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: tokenData.access_token })
    )
    const llData = await llRes.json()
    const longLivedToken = llData.access_token || tokenData.access_token

    // Collect ad accounts from EVERY source, not just /me/adaccounts:
    //  - /me/adaccounts            → personal + directly-assigned accounts
    //  - /me/businesses → owned_ad_accounts / client_ad_accounts
    // Business-owned accounts (e.g. under a Business Manager) do NOT reliably
    // appear in /me/adaccounts, so a perfectly valid account came back empty.
    const acctFields = 'account_id,name,currency,timezone_name'
    const byId = new Map<string, any>()
    const addAccounts = (arr: any[]) => {
      for (const a of (arr || [])) {
        const accId = a.account_id || (a.id ? String(a.id).replace('act_', '') : null)
        if (accId && !byId.has(accId)) byId.set(accId, a)
      }
    }

    const meAcctRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?` +
      new URLSearchParams({ fields: acctFields, limit: '200', access_token: longLivedToken })
    )
    const meAcctData = await meAcctRes.json()
    console.log('ME/ADACCOUNTS:', JSON.stringify(meAcctData).slice(0, 300))
    addAccounts(meAcctData.data)

    try {
      const bizRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/me/businesses?` +
        new URLSearchParams({ fields: 'id,name', limit: '100', access_token: longLivedToken })
      )
      const bizData = await bizRes.json()
      console.log('ME/BUSINESSES:', JSON.stringify(bizData).slice(0, 300))
      for (const biz of (bizData.data || [])) {
        for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
          try {
            const r = await fetch(
              `https://graph.facebook.com/${META_API_VERSION}/${biz.id}/${edge}?` +
              new URLSearchParams({ fields: acctFields, limit: '200', access_token: longLivedToken })
            )
            addAccounts((await r.json()).data)
          } catch (e) { console.log(`biz ${biz.id} ${edge} err:`, e) }
        }
      }
    } catch (e) {
      console.log('businesses fetch error:', e)
    }

    const accounts = Array.from(byId.values())
    console.log('MERGED ACCOUNTS:', accounts.length, accounts.map(a => a.account_id).join(','))

    if (!accounts.length) return NextResponse.redirect(`${APP_URL}/connect-meta?error=no_ad_accounts_found`)

    const encryptedToken = encryptToken(longLivedToken)
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)

    const activeIds: string[] = []
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i]
      const accId = account.account_id || String(account.id).replace('act_', '')
      activeIds.push(accId)
      const { error: upsertError } = await admin.from('meta_accounts').upsert({
        user_id: userId,
        account_id: accId,
        account_name: account.name,
        access_token: encryptedToken,
        token_expires_at: expiresAt.toISOString(),
        currency: account.currency || 'USD',
        timezone: account.timezone_name || 'America/New_York',
        status: 'active',
        is_primary: i === 0,
      }, { onConflict: 'user_id,account_id' })
      console.log('UPSERT:', upsertError ? JSON.stringify(upsertError) : 'SUCCESS')
    }

    // Prune accounts this user can no longer access on Meta (e.g. removed after
    // an account change/hack) so the picker only shows currently-valid accounts.
    if (activeIds.length) {
      const inList = `(${activeIds.map(id => `"${id}"`).join(',')})`
      const { error: pruneErr } = await admin.from('meta_accounts')
        .update({ status: 'inactive', is_primary: false })
        .eq('user_id', userId)
        .not('account_id', 'in', inList)
      console.log('PRUNE:', pruneErr ? JSON.stringify(pruneErr) : 'OK')
    }

    return NextResponse.redirect(`${APP_URL}/connect-meta?success=true`)
  } catch (err) {
    console.error('ERROR:', err)
    const message = err instanceof Error ? err.message : 'Connection failed'
    return NextResponse.redirect(`${APP_URL}/connect-meta?error=${encodeURIComponent(message)}`)
  }
}
