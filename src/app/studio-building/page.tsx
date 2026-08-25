/**
 * /studio-building — the "wow" full-screen build-and-reveal shown right after the website funnel +
 * onboarding. Deliberately TOP-LEVEL (not in the (dashboard) group) so it renders full-bleed with no
 * sidebar chrome — the app chrome only appears at the reveal. Pre-generates the whole studio against the
 * new brand's website and reveals /ads-workspace once the visible set is ready (see StudioBuilding).
 *
 * Auth is handled here (this path isn't in the middleware PROTECTED list): no session → /login; no
 * resolvable brand website → straight to /ads-workspace (nothing to pre-build). Redirects run OUTSIDE
 * the try/catch — next/navigation redirect() throws a control-flow signal that a catch would swallow.
 */
import { redirect } from 'next/navigation'
import StudioBuilding from '@/components/ads/StudioBuilding'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'

export default async function StudioBuildingPage() {
  let authed = false
  let website = ''
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      authed = true
      const admin = createAdminClient() as any
      const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
      if (brandId) {
        const { data } = await admin.from('brands').select('website').eq('id', brandId).maybeSingle()
        website = (data?.website || '').trim()
      }
    }
  } catch { /* handled by the redirects below */ }

  if (!authed) redirect('/login')
  if (!website) redirect('/ads-workspace')
  return <StudioBuilding domain={website} />
}
