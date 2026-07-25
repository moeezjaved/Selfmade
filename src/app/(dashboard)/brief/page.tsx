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

export default async function BriefPage({ searchParams }: { searchParams?: { view?: string } }) {
  // The view is resolved on the SERVER and rendered into the HTML. Reading ?view= in a useEffect
  // meant a failed hydration (broken extensions) silently fell back to the standup — same class of
  // bug as the studio's mode/source seeding. Never gate first paint on the client.
  const v = searchParams?.view
  const initialView: 'standup' | 'desk' | 'scan' = v === 'desk' ? 'desk' : v === 'scan' ? 'scan' : 'standup'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // The (dashboard) layout + middleware already gate auth; if somehow unauthenticated, render the
  // client with no brief (it shows the retry state) rather than crash the server component.
  let initialBrief: Brief | null = null
  if (user) {
    try {
      const admin = createAdminClient()
      initialBrief = await assembleBrief(admin, user.id, { ...(user.user_metadata || {}), email: user.email })
    } catch { initialBrief = null }
  }
  return <BriefClient initialBrief={initialBrief} initialView={initialView} />
}
