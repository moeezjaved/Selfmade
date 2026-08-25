/**
 * Dashboard layout — a thin SERVER wrapper over the shared <AppShell>. It resolves the founder's brands
 * + active project (sf_brand cookie) on the server so the rail's ProjectSwitcher renders into the HTML
 * (survives a broken hydration from browser extensions), matching the app's "never gate first paint on
 * the client" rule. The shell itself lives in @/components/app/AppShell.
 */
import { cookies } from 'next/headers'
import AppShell from '@/components/app/AppShell'
import CompanyShell from '@/components/app/CompanyShell'
import ShellFlag from '@/components/app/ShellFlag'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { readBrandCookie } from '@/lib/brand/active'
import { brandPoolUserIds } from '@/lib/org'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let brands: { id: string; name: string }[] = []
  let activeBrand = ''
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const admin = createAdminClient()
      // Org-aware: a team member owns no brands but must see the OWNER's in the switcher (shared
      // workspace). Was .eq('user_id', self) → the member's rail had no switcher at all.
      const poolIds = await brandPoolUserIds(admin, user.id).catch(() => [user.id])
      const { data } = await admin.from('brands').select('id, name').in('user_id', poolIds).order('created_at', { ascending: true })
      brands = (data || []).map((b: any) => ({ id: String(b.id), name: String(b.name) }))
      activeBrand = await readBrandCookie()
    }
  } catch { /* rail still renders; switcher falls back to its own client fetch */ }

  // Unified Shell v2 is now the DEFAULT (Phase 5 flip). The old rail stays one step away at ?shell=v1
  // for anyone who wants it, and AppShell is kept in the codebase for rollback (flag not retired yet).
  const shellV1 = (await cookies()).get('sf_shell')?.value === 'v1'
  const Shell = shellV1 ? AppShell : CompanyShell
  return <><ShellFlag /><Shell brands={brands} activeBrand={activeBrand}>{children}</Shell></>
}
