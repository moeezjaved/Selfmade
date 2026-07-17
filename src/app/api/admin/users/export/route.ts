/**
 * Admin: export EVERY user as CSV — your follow-up / marketing list. Every signup's email is already
 * captured in auth.users; this just hands you the whole list in one file. Includes marketing-consent
 * (email_confirmed_at) so you can segment who opted in vs not.
 *
 * GET /api/admin/users/export  → text/csv attachment. Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import type { User } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const csvCell = (v: any) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  // Walk every page of auth users (Supabase caps perPage; loop until a short page).
  const authUsers: User[] = []
  for (let page = 1; page <= 200; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    const batch = data?.users || []
    authUsers.push(...batch)
    if (batch.length < 1000) break
  }

  const ids = authUsers.map((u) => u.id)
  const profileMap: Record<string, any> = {}
  // Chunk the profile lookup so a huge IN() doesn't blow up.
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin.from('user_profiles')
      .select('user_id, full_name, plan_id, subscription_status, created_at, email_confirmed_at')
      .in('user_id', ids.slice(i, i + 500))
    for (const p of (data || []) as any[]) profileMap[p.user_id] = p
  }

  const header = ['email', 'full_name', 'plan', 'status', 'marketing_opted_in', 'signed_up_at', 'last_sign_in_at']
  const rows = authUsers.map((u) => {
    const p = profileMap[u.id] || {}
    return [
      u.email || '', p.full_name || '', p.plan_id || 'free', p.subscription_status || '',
      p.email_confirmed_at ? 'yes' : 'no', p.created_at || u.created_at || '', u.last_sign_in_at || '',
    ].map(csvCell).join(',')
  })
  const csv = [header.join(','), ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="selfmade-users.csv"`,
    },
  })
}
