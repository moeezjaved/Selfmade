/**
 * Public /pricing — the marketing pricing page (was missing; the nav's "Pricing" used to dump into
 * /signup). Server component so it's indexable, wrapping the shared <PricingSection variant="landing">
 * (real plans from src/lib/plans.ts, CTAs → /signup) with a nav + hero + footer that match the v3
 * landing (white ground, Inter, orange accent). One source of pricing truth — this never drifts from
 * billing because both render PricingSection.
 */
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PricingSection from '@/components/pricing/PricingSection'

export const dynamic = 'force-dynamic'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export const metadata: Metadata = {
  title: { absolute: 'Pricing — Selfmade' },
  description: 'Simple pricing for your AI marketing team. Start free with 75 credits, or go full-time for $49/mo — ads, SEO, website design and Shopify autopilot. Pay only for the media you make.',
  alternates: { canonical: '/pricing' },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', url: `${SITE}/pricing`, title: 'Pricing — Selfmade', description: 'Start free, or go full-time for $49/mo. Pay only for the media you make.' },
}

const CSS = `
.pg{--bg:#ffffff;--ink:#141d15;--soft:#5c6b5e;--hair:#e9ece7;--orange:#ff5a2c;--orange2:#e8461c;--sky:#f3f6fb;
  background:var(--bg);color:var(--ink);min-height:100vh;
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.pg *{box-sizing:border-box}
.pg a{color:inherit;text-decoration:none}
.pg-shell{max-width:1180px;margin:0 auto;padding:0 24px}
.pg-nav{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.86);backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid var(--hair)}
.pg-nav-in{display:flex;align-items:center;justify-content:space-between;height:64px}
.pg-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:19px;letter-spacing:-.02em}
.pg-spark{color:var(--orange)}
.pg-links{display:flex;align-items:center;gap:28px;font-size:14.5px;font-weight:600;color:var(--soft)}
.pg-links>a:hover,.pg-links>a.on{color:var(--ink)}
.pg-links>a.on{color:var(--orange)}
.pg-drop{position:relative}
.pg-dropbtn{font:inherit;font-weight:600;color:var(--soft);background:none;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.pg-drop:hover .pg-dropbtn,.pg-drop:focus-within .pg-dropbtn{color:var(--ink)}
.pg-caret{font-size:10px;transition:transform .15s}
.pg-drop:hover .pg-caret,.pg-drop:focus-within .pg-caret{transform:rotate(180deg)}
.pg-menu{position:absolute;top:calc(100% + 12px);left:-16px;width:320px;background:#fff;border:1px solid var(--hair);border-radius:14px;box-shadow:0 12px 40px -12px rgba(20,29,21,.22);padding:8px;opacity:0;visibility:hidden;transform:translateY(-6px);transition:.16s;z-index:50}
.pg-menu::before{content:"";position:absolute;top:-12px;left:0;right:0;height:12px}
.pg-drop:hover .pg-menu,.pg-drop:focus-within .pg-menu{opacity:1;visibility:visible;transform:translateY(0)}
.pg-menu a{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:9px;color:var(--ink);transition:background .12s}
.pg-menu a:hover{background:var(--sky)}
.pg-menu a b{font-size:14px;font-weight:700}
.pg-menu a span{font-size:12.5px;font-weight:500;color:var(--soft);line-height:1.35}
.pg-navr{display:flex;align-items:center;gap:14px}
.pg-login{font-size:14.5px;font-weight:600;color:var(--soft)}
.pg-btn{background:var(--orange);color:#fff;font-weight:700;font-size:14.5px;padding:10px 18px;border-radius:9px;border:1px solid var(--orange2);transition:.15s;display:inline-flex;align-items:center;gap:7px}
.pg-btn:hover{background:var(--orange2)}
.pg-hero{text-align:center;padding:72px 24px 26px}
.pg-eyebrow{font-size:12.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--orange)}
.pg-h1{font-size:clamp(34px,5vw,52px);line-height:1.05;letter-spacing:-.03em;font-weight:800;margin:14px 0 0;text-wrap:balance}
.pg-sub{font-size:18px;color:var(--soft);max-width:620px;margin:16px auto 0;line-height:1.5}
.pg-body{padding:8px 24px 80px}
.pg-foot{border-top:1px solid var(--hair);padding:34px 24px;color:var(--soft);font-size:13.5px}
.pg-foot-in{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between}
.pg-foot a:hover{color:var(--ink)}
.pg-foot-links{display:flex;gap:22px;flex-wrap:wrap}
@media(max-width:820px){.pg-links{display:none}}
`

const PRODUCT = [
  { h: '/features/ads', t: 'Ad Studio', d: 'Generate, remake & launch ads across Meta, Google & TikTok' },
  { h: '/features/seo', t: 'SEO Engine', d: 'Rank on Google with on-brand, AI-written content' },
  { h: '/features/websites', t: 'Website Design', d: 'AI builds & restyles your storefront' },
  { h: '/features/ai-visibility', t: 'AI Visibility', d: 'Get cited by ChatGPT, Perplexity & Google AI' },
  { h: '/features/shopify', t: 'Shopify Autopilot', d: '50 AI agents run your store, end to end' },
]
const SOLUTIONS = [
  { h: '/features/shopify', t: 'For Shopify stores', d: 'A full AI growth team for your store' },
  { h: '/features/ads', t: 'More sales from ads', d: 'Winning creative, launched & optimized daily' },
  { h: '/features/seo', t: 'Rank on Google', d: 'Organic traffic that compounds, hands-off' },
  { h: '/features/ai-visibility', t: 'Get found by AI', d: 'Show up when buyers ask ChatGPT' },
]

function Menu({ label, items }: { label: string; items: { h: string; t: string; d: string }[] }) {
  return (
    <div className="pg-drop">
      <button type="button" className="pg-dropbtn">{label} <span className="pg-caret">▾</span></button>
      <div className="pg-menu" role="menu">
        {items.map(i => <a key={i.h + i.t} href={i.h}><b>{i.t}</b><span>{i.d}</span></a>)}
      </div>
    </div>
  )
}

export default async function PricingPage() {
  // Logged-in users get the full account/billing surface (checkout, invite code, subscription mgmt) —
  // preserving what the old (dashboard)/pricing redirect stub did, so every "Upgrade" / "Top up" /
  // billing-email link still lands there. Logged-out visitors see the public marketing page below.
  // Fail-soft: an auth-backend hiccup (or missing env in local dev) must never 500 this public page —
  // fall through to the marketing view. `redirect()` throws NEXT_REDIRECT, so it stays OUT of the try.
  let user = null
  try {
    const supabase = await createClient()
    user = (await supabase.auth.getUser()).data.user
  } catch { /* treat as logged-out */ }
  if (user) redirect('/billing')

  return (
    <div className="pg">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav className="pg-nav"><div className="pg-shell pg-nav-in">
        <a className="pg-brand" href="/"><span className="pg-spark">✦</span> Selfmade</a>
        <div className="pg-links">
          <Menu label="Product" items={PRODUCT} />
          <Menu label="Solutions" items={SOLUTIONS} />
          <a href="/pricing" className="on">Pricing</a>
          <a href="/features/websites">Examples</a>
        </div>
        <div className="pg-navr"><a className="pg-login" href="/login">Log in</a><a className="pg-btn" href="/signup">Get started</a></div>
      </div></nav>

      <header className="pg-hero">
        <div className="pg-eyebrow">Pricing</div>
        <h1 className="pg-h1">Your AI marketing team, full-time.</h1>
        <p className="pg-sub">Start free. When you&apos;re ready, one flat plan runs your ads, SEO, website and store — and you only pay for the media you make.</p>
      </header>

      <main className="pg-body">
        <PricingSection variant="landing" />
      </main>

      <footer className="pg-foot"><div className="pg-shell pg-foot-in">
        <span>© {new Date().getFullYear()} Selfmade — Ecommerce, version two.</span>
        <div className="pg-foot-links">
          <a href="/features/ads">Product</a>
          <a href="/features/shopify">Solutions</a>
          <a href="/pricing">Pricing</a>
          <a href="/login">Log in</a>
          <a href="/signup">Get started</a>
        </div>
      </div></footer>
    </div>
  )
}
