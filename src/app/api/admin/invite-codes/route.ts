import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

function generateCode(prefix = 'SM') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = prefix + '-'
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// GET — list all codes
export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('invite_codes').select('*').order('created_at', { ascending: false })
  return NextResponse.json({ codes: data || [] })
}

// POST — generate new code
export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { trial_days = 30, max_uses = 1, note = '', expires_days } = await request.json()

  const code = generateCode()
  const expires_at = expires_days
    ? new Date(Date.now() + expires_days * 86400000).toISOString()
    : null

  const { data, error } = await admin.from('invite_codes').insert({
    code, trial_days, max_uses, note, expires_at,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ code: data })
}

// DELETE — delete a code
export async function DELETE(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await request.json()
  const admin = createAdminClient()
  await admin.from('invite_codes').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
