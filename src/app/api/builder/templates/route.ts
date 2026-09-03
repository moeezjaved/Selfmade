/** GET /api/builder/templates — the templates the wizard's picker shows. */
import { NextResponse } from 'next/server'
import { templateCards } from '@/lib/builder/templates'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ templates: templateCards() })
}
