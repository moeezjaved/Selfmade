import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { error_message, error_stack, page_url, component_stack, extra } = body

    if (!error_message) return NextResponse.json({ ok: false }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const admin = createAdminClient()
    await admin.from('error_logs').insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      error_message: String(error_message).slice(0, 2000),
      error_stack: error_stack ? String(error_stack).slice(0, 5000) : null,
      page_url: page_url ? String(page_url).slice(0, 500) : null,
      component_stack: component_stack ? String(component_stack).slice(0, 3000) : null,
      extra: extra || null,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
