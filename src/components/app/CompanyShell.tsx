'use client'
/**
 * CompanyShell — Unified Shell v2 (flat, always-visible sidebar; Result/Lapis pattern), behind the
 * `sf_shell=v2` flag. Phase 1: the chrome only — every existing page renders inside it, nav links to the
 * real routes. Light + our orange, matching the ads-studio sidebar. Home/Company/Ads are the lit primary
 * groups; SEO + Intel sit dimmed under a "Grows with your stage" divider (stage logic lands later).
 * The old AppShell is untouched (rollback at ?shell=v1). See docs/…/unified-shell-v2-design.md.
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, Inbox, Users, Brain, FileText, Wand2, Image as ImageIcon, BarChart2, Rocket, Plug, Radar, Eye, Bookmark, Store, Menu, X, Settings, CreditCard, LogOut, LifeBuoy, ClipboardList, ChevronsUpDown } from 'lucide-react'
import { useIsMobile } from '@/lib/useIsMobile'
import { useCredits, CreditCounter } from '@/components/credits/CreditCounter'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import ProjectSwitcher from '@/components/app/ProjectSwitcher'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', ORANGE = '#e02f06', ORANGE_WASH = '#fdeee9', MUTED = '#b9b1a3'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'
// Sidebar nav font — match Lapis, which uses "Die Grotesk" (a licensed grotesque; their own fallback is
// Arial). We can't ship Die Grotesk, but it's Helvetica-adjacent, so a neutral Helvetica/Arial grotesque
// at medium weight reads the same. Kept to the rail only.
const NAV_FONT = "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif"

type Item = { href: string; label: string; icon?: React.ElementType }
type Group = { label?: string; stage?: boolean; items: Item[] }

const NAV: Group[] = [
  { items: [{ href: '/hq', label: 'Home', icon: Home }, { href: '/inbox', label: 'Inbox', icon: Inbox }] },
  { label: 'Ads', items: [
    { href: '/ads-workspace', label: 'Ad Studio', icon: Wand2 },
    { href: '/ads-workspace/competitors', label: 'My Competitors', icon: Eye },
    { href: '/discovery', label: 'Discover', icon: Radar },
    { href: '/ads-workspace/products', label: 'Products', icon: Store },
    { href: '/ads-workspace/brand', label: 'Brand Hub', icon: Wand2 },
    { href: '/ads-workspace/audiences', label: 'Audiences', icon: Users },
    { href: '/reports', label: 'Reports', icon: BarChart2 },
    { href: '/m4', label: 'Launch Ads', icon: Rocket },
  ] },
  { label: 'SEO', items: [
    { href: '/grow', label: 'Overview', icon: BarChart2 },
    { href: '/mission/catalog', label: 'Store', icon: Store },
    { href: '/mission/seo', label: 'SEO', icon: Radar },
    { href: '/mission/blog', label: 'Content', icon: FileText },
    { href: '/mission/programmatic', label: 'Pages at scale', icon: FileText },
    { href: '/mission/geo', label: 'AI Search', icon: Brain },
    { href: '/mission/competitors', label: 'SEO Competitors', icon: Eye },
  ] },
]

// The account/settings menu that opens from the bottom of the sidebar. Same destinations the old
// AppShell avatar carried (Settings · Billing · Connectors · Team · Activity · Support · Log out).
const ACCT: { href: string; label: string; icon: React.ElementType; external?: boolean }[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/billing', label: 'Billing & plan', icon: CreditCard },
  { href: '/brands', label: 'My Brands', icon: Bookmark },
  { href: '/connect/meta', label: 'Connect Meta', icon: Plug },
  { href: '/connect/shopify', label: 'Connect Shopify', icon: Store },
  { href: '/team', label: 'Team & members', icon: Users },
  { href: '/activity', label: 'Activity log', icon: ClipboardList },
  { href: '/contact', label: 'Support & feedback', icon: LifeBuoy },
]

export default function CompanyShell({ brands, activeBrand, children }: { brands: { id: string; name: string }[]; activeBrand: string; children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const { plan } = useCredits()
  const isPaid = !!plan && plan !== 'free'

  const supabase = createClient()
  useEffect(() => {
    let on = true
    supabase.auth.getSession().then(({ data: { session } }) => { if (on) setUser(session?.user ?? null) })
    return () => { on = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => {
    try { document.cookie = 'sm_onb=; path=/; max-age=0; samesite=lax' } catch { /* ignore */ }
    await supabase.auth.signOut(); router.push('/login')
  }

  const initials = (user?.user_metadata?.full_name as string)?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    || user?.email?.[0]?.toUpperCase() || 'A'
  const displayName = (user?.user_metadata?.full_name as string) || user?.email || 'Your account'
  const planLabel = isPaid ? `${(plan || '').replace(/^\w/, (c) => c.toUpperCase())} plan` : 'Free plan'

  // Most-specific match wins, so /ads-workspace/competitors lights "My Competitors", not "Ad Studio".
  const bestMatch = NAV.flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0]
  const isActive = (href: string) => href === bestMatch || (href === '/mission' && pathname === '/' && !bestMatch)

  const Sidebar = (
    <aside style={{ width: isMobile ? '82%' : 248, maxWidth: 300, flex: 'none', background: '#fff', borderRight: `1px solid ${LINE}`, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2, minHeight: '100dvh', boxSizing: 'border-box', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 6px 12px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: SERIF, fontWeight: 800, fontSize: 17, flex: 'none' }}>S</div>
        <div style={{ minWidth: 0, flex: 1 }}><ProjectSwitcher initialBrands={brands} initialActive={activeBrand} /></div>
        {isMobile && <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: SUB, padding: 4 }}><X size={20} /></button>}
      </div>

      {NAV.map((g, gi) => (
        <div key={gi} style={{ marginTop: g.label ? 12 : 0 }}>
          {g.stage && gi === NAV.findIndex((x) => x.stage) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '14px 4px 4px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }}>
              <span style={{ height: 1, flex: 1, background: LINE }} />Grows with your stage<span style={{ height: 1, flex: 1, background: LINE }} />
            </div>
          )}
          {g.label && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: SUB, opacity: .7, padding: '4px 10px 5px', fontFamily: NAV_FONT }}>{g.label}</div>}
          {g.items.map((it) => {
            const on = isActive(it.href)
            const Icon = it.icon
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, textDecoration: 'none', background: on ? ORANGE_WASH : 'transparent', color: on ? ORANGE : '#43403a', fontWeight: on ? 600 : 500, fontSize: 14.5, fontFamily: NAV_FONT, opacity: g.stage && !on ? 0.55 : 1, transition: 'background .12s' }}>
                {Icon && <Icon size={16} style={{ flex: 'none', color: on ? ORANGE : SUB }} />}{it.label}
              </Link>
            )
          })}
        </div>
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 14, position: 'relative' }}>
        {/* Credits — always visible in the rail (tap to top up / manage plan). */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <CreditCounter />
        </div>
        {!isPaid && <a href="/hire" style={{ display: 'block', background: ORANGE, color: '#fff', borderRadius: 11, padding: '9px 12px', fontSize: 12.5, fontWeight: 800, textAlign: 'center', textDecoration: 'none', marginBottom: 8 }}>Hire the team →</a>}

        {/* Account row — click to open the settings/billing/connectors menu above it. */}
        <button onClick={() => setAcctOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 11, border: `1px solid ${LINE}`, background: acctOpen ? ORANGE_WASH : '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: SANS }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: ORANGE, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12.5, flex: 'none' }}>{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
            <div style={{ fontSize: 10.5, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{planLabel}</div>
          </div>
          <ChevronsUpDown size={15} style={{ flex: 'none', color: SUB }} />
        </button>

        {acctOpen && (
          <>
            <div onClick={() => setAcctOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 59 }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(100% - 6px)', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, boxShadow: '0 14px 44px rgba(20,20,16,.16)', zIndex: 60, overflow: 'hidden', padding: '6px' }}>
              {ACCT.map((it) => {
                const Icon = it.icon
                const row = { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, textDecoration: 'none', color: '#43403a', fontWeight: 600, fontSize: 13, fontFamily: SANS } as const
                return it.external
                  ? <a key={it.href} href={it.href} target="_blank" rel="noreferrer" onClick={() => setAcctOpen(false)} style={row}><Icon size={16} style={{ flex: 'none', color: SUB }} />{it.label}</a>
                  : <Link key={it.href} href={it.href} onClick={() => { setAcctOpen(false); setOpen(false) }} style={row}><Icon size={16} style={{ flex: 'none', color: SUB }} />{it.label}</Link>
              })}
              <div style={{ height: 1, background: LINE, margin: '5px 6px' }} />
              <button onClick={signOut} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, border: 'none', background: 'none', cursor: 'pointer', color: '#c23b1c', fontWeight: 700, fontSize: 13, fontFamily: SANS, textAlign: 'left' }}><LogOut size={16} style={{ flex: 'none' }} />Log out</button>
            </div>
          </>
        )}
      </div>
    </aside>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: '#fff', fontFamily: SANS, color: INK }}>
      {!isMobile && Sidebar}
      {isMobile && open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex' }}>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
          <div style={{ position: 'relative', zIndex: 61, display: 'flex' }}>{Sidebar}</div>
        </div>
      )}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${LINE}`, background: '#fff', position: 'sticky', top: 0, zIndex: 40 }}>
            <button onClick={() => setOpen(true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: INK, padding: 2 }}><Menu size={22} /></button>
            <span style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 17 }}>Selfmade</span>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </main>
    </div>
  )
}
