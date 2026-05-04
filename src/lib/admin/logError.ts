import { createAdminClient } from '@/lib/supabase/server'

export async function logError(opts: {
  user_id: string | null
  user_email?: string | null
  error_message: string
  error_stack?: string | null
  page_url?: string | null
  extra?: Record<string, unknown>
}) {
  try {
    const admin = createAdminClient()
    await admin.from('error_logs').insert({
      user_id: opts.user_id,
      user_email: opts.user_email || null,
      error_message: String(opts.error_message).slice(0, 2000),
      error_stack: opts.error_stack ? String(opts.error_stack).slice(0, 5000) : null,
      page_url: opts.page_url || null,
      extra: opts.extra || null,
    })
  } catch {
    // never throw — logging must never break the main flow
  }
}
