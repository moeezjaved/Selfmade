/**
 * POST /api/webhooks/unipile/mail — Unipile MAILING webhook (email arrives on a different stream than
 * chats). Parse the inbound email and land it in the Customer Inbox as an 'email' thread, triaged with
 * a draft. Add a "Mailing" webhook in Unipile pointing here. Ignores our own sent mail / non-inbound.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { ingestCustomerMessage } from '@/lib/customer/ingest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function authed(req: NextRequest, url: URL): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET
  if (!secret) return true
  return req.headers.get('x-unipile-secret') === secret || url.searchParams.get('secret') === secret
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!authed(req, url)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const mail = b?.email || b?.message || b?.data || b

  // Only inbound mail (skip our own sent copies / read receipts).
  const dir = b?.event || b?.type || mail?.folder || mail?.direction || ''
  if (/sent|outbound|draft/i.test(String(dir))) return NextResponse.json({ ok: true })

  const accountId = b?.account_id ?? mail?.account_id
  const fromObj = mail?.from ?? mail?.from_attendee ?? (Array.isArray(mail?.from_attendees) ? mail.from_attendees[0] : undefined)
  const sender = fromObj?.identifier ?? fromObj?.email ?? fromObj?.address ?? mail?.from_email ?? (typeof fromObj === 'string' ? fromObj : undefined)
  const senderName = fromObj?.display_name ?? fromObj?.name ?? undefined
  const subject = mail?.subject ?? ''
  const bodyText = mail?.body_plain ?? mail?.text ?? mail?.snippet ?? mail?.body ?? ''
  const text = [subject ? `Subject: ${subject}` : '', bodyText].filter(Boolean).join('\n\n').slice(0, 4000)

  if (!accountId || !sender || !text) return NextResponse.json({ ok: true })   // ack, nothing to ingest
  try {
    await ingestCustomerMessage(createAdminClient(), { accountId: String(accountId), sender: String(sender), senderName, text, channel: 'email' })
  } catch { /* best-effort */ }
  return NextResponse.json({ ok: true })
}
