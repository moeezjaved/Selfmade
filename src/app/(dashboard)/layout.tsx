/**
 * Dashboard layout — a thin SERVER wrapper over the shared <AppShell>. It resolves the founder's brands
 * + active project (sf_brand cookie) on the server so the rail's ProjectSwitcher renders into the HTML
 * (survives a broken hydration from browser extensions), matching the app's "never gate first paint on
 * the client" rule. The shell itself lives in @/components/app/AppShell.
 */
import AppShell from '@/components/app/AppShell'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { readBrandCookie } from '@/lib/brand/active'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let brands: { id: string; name: string }[] = []
  let activeBrand = ''
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const admin = createAdminClient()
      const { data } = await admin.from('brands').select('id, name').eq('user_id', user.id).order('created_at', { ascending: true })
      brands = (data || []).map((b: any) => ({ id: String(b.id), name: String(b.name) }))
      activeBrand = await readBrandCookie()
    }
  } catch { /* rail still renders; switcher falls back to its own client fetch */ }
  return <AppShell brands={brands} activeBrand={activeBrand}>{children}</AppShell>
}
