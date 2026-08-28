/**
 * /ads-workspace/[section] — the ads-studio workspace mounted INSIDE the app shell (Phase 2). Each ADS
 * sidebar item deep-links here (…/competitors, …/products, …/brand, …/audiences); AdsStudio renders in
 * `embedded` mode (no internal sidebar), driven by the section, with the domain taken from the active
 * brand's website. The standalone /ads-studio?domain=… (audit-funnel landing) is unchanged.
 */
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import AdsStudio from '@/components/ads/AdsStudio'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { isGrandfathered } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'

type Key = 'home' | 'search' | 'ads' | 'competitors' | 'discover' | 'products' | 'calendar' | 'brand' | 'audiences' | 'google'
const SEG_TO_SECTION: Record<string, Key> = {
  '': 'home', competitors: 'competitors', discover: 'discover', products: 'products',
  'brand-kit': 'brand', brand: 'brand', audiences: 'audiences', 'your-ads': 'ads', ads: 'ads',
  calendar: 'calendar', search: 'search', google: 'google',
}

export default async function AdsWorkspacePage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<{ built?: string }> }) {
  const { section: segs } = await params
  const sp = await searchParams
  const seg = (segs?.[0] || '').toLowerCase()
  const section: Key = SEG_TO_SECTION[seg] || 'home'

  let website = ''
  let warmed = false
  let needsAgreement = false
  let brandId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // Signup → SIGN the agreement → workspace. Gate until signed. Three signals count as signed:
      //   • user_metadata.hire_agreement_accepted_at (durable, once JWT refreshes)
      //   • sf_hired cookie (/welcome just recorded it)
      //   • sf_scan_signer cookie — they ALREADY signed the SAME Employment Agreement in the scan funnel
      //     (AuditTheater "Fix all problems" screen). Without this, funnel signers were asked to sign a
      //     SECOND time at /welcome after onboarding — the double-sign QA hit.
      const jar = await cookies()
      const scanSigner = jar.get('sf_scan_signer')?.value || ''
      const admin = createAdminClient() as any
      let signed = !!(user.user_metadata as any)?.hire_agreement_accepted_at || jar.get('sf_hired')?.value === '1'
      if (!signed && scanSigner) {
        // Persist the funnel signature so it's durable and never re-prompts (best-effort).
        try { await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata || {}), hire_agreement_accepted_at: new Date().toISOString(), hire_agreement_name: decodeURIComponent(scanSigner).slice(0, 120) } }) } catch { /* best-effort */ }
        signed = true
      }
      if (!signed && !isGrandfathered(user.created_at)) needsAgreement = true
      brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
      if (brandId) {
        const { data } = await admin.from('brands').select('website, brand_kit').eq('id', brandId).maybeSingle()
        website = (data?.website || '').trim()
        warmed = !!(data?.brand_kit as any)?.adsStudio?.warmedAt
      }
    }
  } catch { /* AdsStudio falls back to the sf_scan_domain cookie */ }

  // Must sign Mello's employment agreement before entering the workspace (redirect outside try so
  // Next's redirect signal isn't swallowed by the catch).
  if (needsAgreement) redirect('/welcome')

  // First arrival with a known store but nothing built yet → run the "Building your studio" screen so the
  // whole workspace (brand kit, products, audiences, competitors, templates) is ready on reveal. `built=1`
  // (set when that screen finishes) renders straight through, so there's no redirect loop.
  if (website && !warmed && sp?.built !== '1') redirect('/studio-building')

  // No specific brand selected (switcher on "All brands") → the workspace can't show one brand's hub;
  // tell the user to pick a brand instead of falling through to the "What's your website?" setup prompt.
  return <AdsStudio embedded section={section} domainOverride={website || undefined} allBrands={!brandId} />
}
