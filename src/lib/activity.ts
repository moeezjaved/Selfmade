import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fire-and-forget audit log. Writes one row to `activity_logs` for the Activity Log page.
 * Never throws — a logging failure must not break the user action that triggered it.
 * Pass a service-role (admin) client; RLS policy "Users own their activity" lets the user
 * read their own rows back.
 */
export async function logActivity(
  admin: SupabaseClient,
  userId: string,
  actionType: string,
  description: string,
  entityType = 'brand',
  brandId?: string | null,   // brand-facing event → attach the brand; account-level (billing/auth) → null
): Promise<void> {
  try {
    await (admin as any).from('activity_logs').insert({
      user_id: userId,
      action_type: actionType,
      entity_type: entityType,
      description,
      performed_by: 'user',
      brand_id: brandId || null,
    })
  } catch { /* audit log is best-effort */ }
}
