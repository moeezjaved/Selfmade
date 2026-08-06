/**
 * The Brief — SERVER-RENDERED so the content lands in the HTML and shows even when the client never
 * hydrates (e.g. a browser extension breaks React). The server assembles the brief and hands it to
 * BriefClient as initialBrief; the client only adds interactivity (chat, approve/kill), never the
 * first paint. This kills the "pulling the room together…" hang caused by hydration failures.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { assembleBrief, type Brief } from '@/lib/brief/assemble'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { getBalance } from '@/lib/credits'
import BriefClient from './BriefClient'

export const dynamic = 'force-dynamic'

export default async function BriefPage({ searchParams }: { searchParams?: { view?: string; brand?: string; welcome?: string } }) {
  // The view AND the selected brand are resolved on the SERVER and rendered into the HTML. Reading
  // either in a useEffect meant a failed hydration (broken extensions) silently fell back to the
  // default — same class of bug as the studio's mode/source seeding. Never gate first paint on the
  // client: the switcher is interactivity, but the scoped content it produces is server-rendered.
  // The scan (4-column) IS the brief now — it's the default for everyone. The old single-column
  // standup and the desk variant stay reachable at ?view=standup / ?view=desk (kept, not deleted).
  const v = searchParams?.view
  const welcome = searchParams?.welcome === '1'
  const initialView: 'standup' | 'desk' | 'scan' = v === 'desk' ? 'desk' : v === 'standup' ? 'standup' : 'scan'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // The (dashboard) layout + middleware already gate auth; if somehow unauthenticated, render the
  // client with no brief (it shows the retry state) rather than crash the server component.
  let initialBrief: Brief | null = null
  let brands: { id: string; name: string }[] = []
  let activeBrandId: string | null = null
  // Plan + credits resolved on the SERVER so the right-rail card ("Hire Mello full-time" for free vs
  // "Buy credits"/balance for subscribers) is correct on first paint — no flash of the upsell for a
  // paying founder while a client fetch loads the plan.
  let initialPlan: string | null = null
  let initialCredits: number | null = null
  if (user) {
    try {
      const admin = createAdminClient()
      const { data: bs } = await admin.from('brands').select('id, name').eq('user_id', user.id).order('created_at', { ascending: true })
      brands = (bs || []).map((b: any) => ({ id: String(b.id), name: String(b.name) }))
      // The active project: explicit ?brand= (deep link) wins, else the app-wide `sf_brand` cookie set by
      // the rail's ProjectSwitcher. Validated against the user's own brands.
      activeBrandId = await resolveActiveBrandId(admin, user.id, searchParams?.brand || null)
      initialBrief = await assembleBrief(admin, user.id, { ...(user.user_metadata || {}), email: user.email }, { brandId: activeBrandId })
      try { const bal = await getBalance(admin, user.id); initialPlan = String(bal.plan || 'free'); initialCredits = typeof bal.balance === 'number' ? bal.balance : null } catch { /* card falls back to client fetch */ }
    } catch { initialBrief = null }
  }
  return <BriefClient initialBrief={initialBrief} initialView={initialView} brands={brands} activeBrandId={activeBrandId} initialPlan={initialPlan} initialCredits={initialCredits} welcome={welcome} />
}
