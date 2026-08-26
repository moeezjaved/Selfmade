import Link from 'next/link'
import { COMPANY } from '@/lib/company'
import { createClient } from '@/lib/supabase/server'

/**
 * LegalShell — one premium chrome for every public legal / info page (privacy, terms, refund,
 * contact). Matches the landing: Inter, sticky blurred nav, lime "Hire Mello" CTA, soft editorial
 * hero, and a dark footer with the legal links. Content is styled through the scoped `.legal`
 * stylesheet so pages just write plain <h2>/<p>/<ul> and read consistently.
 */
const INK = '#0e1b12', GREEN = '#16a34a', LIME = '#ff5a2c'

export default async function LegalShell({ eyebrow = 'Legal', title, updated, intro, children }: {
  eyebrow?: string; title: string; updated?: string; intro?: React.ReactNode; children: React.ReactNode
}) {
  // Auth-aware chrome: a logged-in user reaching these pages (e.g. via in-app "Support & feedback")
  // should get in-app nav + a logo that returns to the app, not the logged-out marketing home.
  let signedIn = false
  try { const s = await createClient(); signedIn = !!(await s.auth.getUser()).data.user } catch { /* treat as logged out */ }
  const home = signedIn ? '/hq' : '/'
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif", color: INK, background: '#fff', overflowX: 'hidden' }}>
      {/* ── Nav — mirrors the landing ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', height: 66, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href={home} style={{ display: 'flex', alignItems: 'center' }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)' }} /></Link>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {signedIn ? (
              <Link href="/hq" style={{ background: '#ef4a1e', color: '#fff', padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Dashboard →</Link>
            ) : (
              <>
                <Link href="/login" className="ls-hide-sm" style={{ fontSize: 14.5, fontWeight: 700, color: INK, textDecoration: 'none' }}>Log in</Link>
                <Link href="/signup" style={{ background: '#ef4a1e', color: '#fff', padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Hire Mello →</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero band — soft lime wash, editorial ── */}
      <header style={{ background: 'radial-gradient(120% 100% at 50% -20%, #eef8dd 0%, #f7faf3 45%, #ffffff 100%)', borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 24px 46px', textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: GREEN, textTransform: 'uppercase', letterSpacing: '.14em' }}>{eyebrow}</div>
          <h1 style={{ fontSize: 'clamp(32px,5.5vw,52px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.08, margin: '12px 0 0', textWrap: 'balance' as any }}>{title}</h1>
          {updated && <p style={{ fontSize: 13.5, color: '#9ca3af', margin: '14px 0 0' }}>Last updated {updated}</p>}
          {intro && <p style={{ fontSize: 'clamp(15px,1.8vw,17px)', color: '#4b5563', lineHeight: 1.65, margin: '18px auto 0', maxWidth: 600 }}>{intro}</p>}
        </div>
      </header>

      {/* ── Content ── */}
      <main className="legal" style={{ maxWidth: 720, margin: '0 auto', padding: '52px 24px 90px' }}>{children}</main>

      {/* ── Footer — compact, dark, on-brand ── */}
      <footer style={{ background: INK, color: 'rgba(255,255,255,.72)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 13.5, fontWeight: 600 }}>
            {[['About', '/about'], ['Contact', '/contact'], ['Privacy', '/privacy'], ['Terms', '/terms'], ['Refund Policy', '/refund']].map(([l, h]) => (
              <Link key={h} href={h} style={{ color: 'rgba(255,255,255,.72)', textDecoration: 'none' }} className="ls-flink">{l}</Link>
            ))}
          </div>
          <Link href="/signup" style={{ background: '#ef4a1e', color: '#fff', padding: '9px 18px', borderRadius: 100, fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>Start free →</Link>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 24px', fontSize: 12.5, color: 'rgba(255,255,255,.5)' }}>
            © {COMPANY.brand} · operated by {COMPANY.legalName}. All rights reserved.
          </div>
        </div>
      </footer>

      <style>{`
        .ls-flink:hover { color: #fff !important; }
        @media (max-width: 560px) { .ls-hide-sm { display: none; } }
        .legal { font-size: 15.5px; line-height: 1.78; color: #374151; }
        .legal > p:first-child { font-size: 16.5px; color: #2c3a2e; }
        .legal h2 { font-size: 20px; font-weight: 800; letter-spacing: -.01em; color: ${INK}; margin: 34px 0 12px; padding-top: 4px; }
        .legal h2:first-child { margin-top: 0; }
        .legal p { margin: 0 0 16px; }
        .legal ul { margin: 0 0 16px; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .legal li { position: relative; padding-left: 26px; }
        .legal li::before { content: ''; position: absolute; left: 6px; top: 9px; width: 6px; height: 6px; border-radius: 50%; background: ${GREEN}; }
        .legal a { color: ${GREEN}; font-weight: 600; text-decoration: none; }
        .legal a:hover { text-decoration: underline; }
        .legal strong, .legal b { color: ${INK}; font-weight: 700; }
        .legal dl { margin: 0; }
        .legal dt { font-weight: 800; color: ${INK}; }
        .legal hr { border: none; border-top: 1px solid #eef0ee; margin: 32px 0; }
      `}</style>
    </div>
  )
}
