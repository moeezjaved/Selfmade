/**
 * Mint / list / revoke MCP access keys (tokens for the /api/mcp server). Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient() as any
  const { data } = await db.from('mcp_keys').select('id, label, token, created_at, last_used_at, revoked').order('created_at', { ascending: false })
  return NextResponse.json({ keys: data || [] })
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { label } = await request.json().catch(() => ({}))
  const token = 'sk_mcp_' + randomBytes(24).toString('hex')
  const db = createAdminClient() as any
  const { data, error } = await db.from('mcp_keys').insert({ label: label || 'MCP key', token }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ key: data })
}

export async function DELETE(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient() as any
  await db.from('mcp_keys').update({ revoked: true }).eq('id', id)
  return NextResponse.json({ ok: true })
}
