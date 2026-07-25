/**
 * The Brief — SERVER-RENDERED so the content lands in the HTML and shows even when the client never
 * hydrates (e.g. a browser extension breaks React). The server assembles the brief and hands it to
 * BriefClient as initialBrief; the client only adds interactivity (chat, approve/kill), never the
 * first paint. This kills the "pulling the room together…" hang caused by hydration failures.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { assembleBrief, type Brief } from '@/lib/brief/assemble'
import BriefClient from './BriefClient'

export const dynamic = 'force-dynamic'

export default async function BriefPage({ searchParams }: { searchParams?: { view?: string; brand?: string; welcome?: string } }) {
  // The view AND the selected brand are resolved on the SERVER and rendered into the HTML. Reading
  // either in a useEffect meant a failed hydration (broken extensions) silently fell back to the
  // default — same class of bug as the studio's mode/source seeding. Never gate first paint on the
  // client: the switcher is interactivity, but the scoped content it produces is server-rendered.
  // The scan (4-column) is the real brief now. First arrival from onboarding (?welcome=1) opens it,
  // not the old single-column standup — that mismatch is what read as "the old welcome page".
  const v = searchParams?.view
  const welcome = searchParams?.welcome === '1'
  const initialView: 'standup' | 'desk' | 'scan' = v === 'desk' ? 'desk' : v === 'scan' ? 'scan' : v === 'standup' ? 'standup' : welcome ? 'scan' : 'standup'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // The (dashboard) layout + middleware already gate auth; if somehow unauthenticated, render the
  // client with no brief (it shows the retry state) rather than crash the server component.
  let initialBrief: Brief | null = null
  let brands: { id: string; name: string }[] = []
  let activeBrandId: string | null = null
  if (user) {
    try {
      const admin = createAdminClient()
      const { data: bs } = await admin.from('brands').select('id, name').eq('user_id', user.id).order('created_at', { ascending: true })
      brands = (bs || []).map((b: any) => ({ id: String(b.id), name: String(b.name) }))
      // Only honour ?brand= if it's really one of the user's brands (no scoping to someone else's id).
      activeBrandId = searchParams?.brand && brands.some(b => b.id === searchParams.brand) ? searchParams.brand! : null
      initialBrief = await assembleBrief(admin, user.id, { ...(user.user_metadata || {}), email: user.email }, { brandId: activeBrandId })
    } catch { initialBrief = null }
  }
  return <BriefClient initialBrief={initialBrief} initialView={initialView} brands={brands} activeBrandId={activeBrandId} welcome={welcome} />
}
