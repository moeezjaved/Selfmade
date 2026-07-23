'use client'
/**
 * Dashboard layout — a thin wrapper over the shared <AppShell>. The shell itself now
 * lives in @/components/app/AppShell so the public knowledge surfaces (Discover,
 * Playbooks, ad/brand pages) can render inside the SAME chrome for logged-in users
 * (via KnowledgeChrome) instead of feeling like they left the app.
 */
import AppShell from '@/components/app/AppShell'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
