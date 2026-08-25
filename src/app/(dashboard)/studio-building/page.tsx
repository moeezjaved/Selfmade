/**
 * /studio-building — the "wow" build-and-reveal screen shown right after the website funnel + onboarding.
 * It pre-generates the whole studio (brand kit, products, competitors, and the free ad templates) against
 * the new brand's website and only reveals /ads-workspace once the visible set is ready — the rest keep
 * generating in the background (each POST caches into brands.brand_kit.adsStudio.templates, so when the
 * workspace opens its own genAll finds them already done and shows them instantly).
 *
 * Domain is resolved from the active brand's website (same as the ads-workspace page); if we can't resolve
 * one, there's nothing to build, so we send the user straight to the workspace.
 */
import { redirect } from 'next/navigation'
import StudioBuilding from '@/components/ads/StudioBuilding'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'

export default async function StudioBuildingPage() {
  let website = ''
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const admin = createAdminClient() as any
      const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
      if (brandId) {
        const { data } = await admin.from('brands').select('website').eq('id', brandId).maybeSingle()
        website = (data?.website || '').trim()
      }
    }
  } catch { /* fall through to workspace */ }

  if (!website) redirect('/ads-workspace')
  return <StudioBuilding domain={website} />
}
