'use client'
/**
 * THE QUIET SHELL (Ploy-inspired, 2026-07-24). One slim 72px icon rail — the content
 * owns the screen. No permanent panel, no badges, no promos: sub-pages appear as a
 * hover flyout per destination; credits + account + extension live in the avatar
 * menu; the bell sits at the rail's foot. Five destinations: Home · Discover ·
 * Playbooks · Library · Workspace (+ Mello pinned, Settings + avatar at bottom).
 * Every pre-existing route is still reachable — regrouped, never deleted.
 */
import { useEffect, useState } from 'react'
import { CreditCounter, useCredits } from '@/components/credits/CreditCounter'
import { PLANS, normalizePlan } from '@/lib/plans'
import { CreditModal } from '@/components/credits/CreditModal'
import { NotificationBell } from '@/components/NotificationBell'
import UpsellModalHost from '@/components/UpsellModal'
import ConfirmHost, { confirmAction } from '@/components/ConfirmDialog'
import toast from 'react-hot-toast'
import MelloFace from '@/components/MelloFace'
import RemakeStarter from '@/components/RemakeStarter'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'
import {
  Settings, LogOut, Menu, X, LifeBuoy, Zap, Sparkles, CreditCard, Users, Plus,
  Eye, TrendingUp, Star, Bookmark, Image as ImageIcon, Heart, Radar,
  Rocket, Megaphone, LineChart, BarChart2, Wand2, Store, LayoutDashboard, ClipboardList, Trophy, Camera, Sun, Newspaper, BookOpen, FileText, Plug, Brain, Inbox,
} from 'lucide-react'
import SearchPalette from '@/components/SearchPalette'
import ProjectSwitcher from '@/components/app/ProjectSwitcher'
import ProductTour from '@/components/app/ProductTour'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
import BootMotion from '@/components/motion/BootMotion'

type NavItem = { href?: string; icon?: React.ElementType; label?: string; badge?: string | null; section?: string }
const AREAS: { key: string; label: string; railLabel: string; railIcon: React.ElementType; defaultHref: string; items: NavItem[] }[] = [
  {
    key: 'home', label: 'Home', railLabel: 'Home', railIcon: Sun, defaultHref: '/mission',
    items: [
      { href: '/mission', icon: Sun, label: 'Mission' },
      { href: '/mission/journey', icon: TrendingUp, label: 'Journey' },
      { href: '/company', icon: Users, label: 'Your Team' },
      { href: '/brain', icon: Brain, label: 'Company Brain' },
      { href: '/documents', icon: FileText, label: 'Documents' },
    ],
  },
  {
    // GROW — the organic growth engine: the retention journey + every SEO/GEO/Shopify content agent.
    key: 'grow', label: 'Grow', railLabel: 'Grow', railIcon: TrendingUp, defaultHref: '/mission/journey',
    items: [
      { href: '/mission/journey',      icon: TrendingUp,      label: 'Journey' },
      { href: '/mission/plan',         icon: ClipboardList,   label: 'Growth plan' },
      { href: '/mission/catalog',      icon: Store,           label: 'Store catalog' },
      { href: '/mission/blog',         icon: Newspaper,       label: 'Content' },
      { href: '/mission/programmatic', icon: LayoutDashboard, label: 'Pages at scale' },
      { href: '/mission/seo',          icon: LineChart,       label: 'SEO' },
      { href: '/mission/geo',          icon: Sparkles,        label: 'AI search' },
      { href: '/mission/competitors',  icon: Eye,             label: 'Competitors' },
    ],
  },
  {
    // Customer Employee — the founder's unified inbox (customers in) + proactive nudges (Mello out).
    key: 'inbox', label: 'Inbox', railLabel: 'Inbox', railIcon: Inbox, defaultHref: '/inbox',
    items: [
      { href: '/inbox', icon: Inbox, label: 'Customer Inbox' },
      { href: '/creators', icon: Camera, label: 'UGC Creators' },
    ],
  },
  {
    // Competitor spying — where you watch brands and find ads to remake. (Renamed 'Ads'→'Spy' so it
    // no longer collides with the 'Ads' performance area below.)
    key: 'library', label: 'Spy', railLabel: 'Spy', railIcon: Radar, defaultHref: '/discovery',
    items: [
      { href: '/discovery',           icon: Radar,    label: 'All ads' },
      { href: '/discovery/brand-spy', icon: Eye,      label: 'Spy a brand' },
      { href: '/discovery/following', icon: Heart,    label: 'Following' },
      { href: '/discovery/saved',     icon: Bookmark, label: 'Boards' },
    ],
  },
  {
    // STUDIO — the making half of the old 'Work' tab: create creatives + manage brands/assets.
    key: 'studio', label: 'Studio', railLabel: 'Studio', railIcon: Wand2, defaultHref: '/studio',
    items: [
      { href: '/studio',                   icon: Wand2,    label: 'Create Ad' },
      { href: '/creative-studio',          icon: Sparkles, label: 'My Creatives' },
      { href: '/brands',                   icon: Store,    label: 'My Brands' },
      { href: '/assets',                   icon: ImageIcon,label: 'Assets' },
    ],
  },
  {
    // ADS — the running/measuring half: your live Meta ads. Reports is the ONE analytics home (Scale &
    // Insights / Leaderboard / Snapshots are folded IN as tabs on /reports, not separate nav items).
    key: 'ads', label: 'Ads', railLabel: 'Ads', railIcon: BarChart2, defaultHref: '/reports',
    items: [
      { href: '/reports',     icon: BarChart2, label: 'Reports' },
      { href: '/campaigns',   icon: Megaphone, label: 'Campaigns' },
      { href: '/m4',          icon: Rocket,    label: 'Launch Ads' },
      { href: '/connect/meta', icon: Plug,     label: 'Connect Meta' },
    ],
  },
]

// Analytics pages folded into Reports (reachable via the Reports tab strip, not the rail) — but they
// still belong to the 'ads' area for rail highlighting when visited directly.
const ADS_AREA_EXTRA_PATHS = ['/insights', '/leaderboard', '/snapshots', '/dashboard']

const RAIL_W = 72

function RailIcon({ href, active, title, accent, label, children, dataTour }: {
  href: string; active: boolean; title: string; accent?: boolean; label?: string; children: React.ReactNode; dataTour?: string
}) {
  return (
    <Link href={href} title={title} aria-label={title} data-tour={dataTour}
      className={cn('rail-icon', accent && 'accent', active && 'active')}>
      {children}
      {label && <span className="rail-label">{label}</span>}
    </Link>
  )
}

const ACCT_ITEM: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, textDecoration: 'none' }
function AcctItem({ href, icon: Icon, label, accent, external }: { href: string; icon: React.ElementType; label: string; accent?: boolean; external?: boolean }) {
  const style = { ...ACCT_ITEM, color: accent ? '#ef4a1e' : '#333d35', fontSize: 13, fontWeight: accent ? 700 : 500 }
  if (external) return <a href={href} target="_blank" rel="noopener noreferrer" className="sm-acct-item" style={style}><Icon size={16} style={{ flexShrink: 0 }} /><span>{label}</span></a>
  return <Link href={href} className="sm-acct-item" style={style}><Icon size={16} style={{ flexShrink: 0 }} /><span>{label}</span></Link>
}

// One nav row (flyout + mobile drawer share it)
function ItemLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  if (!item.href || !item.icon) return null
  const Icon = item.icon
  return (
    <Link href={item.href} onClick={onClick} className={cn('sidebar-link', active && 'active')}
      data-nav={item.href === '/creative-studio' ? 'creatives' : undefined}>
      <Icon size={18} strokeWidth={1.9} className="flex-shrink-0" />
      <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
      {item.badge === 'SOON' && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.04em', padding: '2px 6px', borderRadius: 99, background: '#eef1ec', color: '#8b978d', flexShrink: 0 }}>SOON</span>}
    </Link>
  )
}

export default function AppShell({ children, brands = [], activeBrand = '' }: { children: React.ReactNode; brands?: { id: string; name: string }[]; activeBrand?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const activeHref = AREAS.flatMap(s => s.items.map(i => i.href).filter((h): h is string => !!h))
    .filter(h => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0]
  const melloActive = pathname === '/mello' || pathname.startsWith('/mello/')
  // Reports-folded analytics pages have no nav item but belong to the 'ads' area → keep it highlighted.
  const inAdsExtra = ADS_AREA_EXTRA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const activeArea = inAdsExtra ? AREAS.find(a => a.key === 'ads') : AREAS.find(a => a.items.some(i => i.href === activeHref))

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const { plan: effectivePlan, canceled: planCanceled, isOwner: planIsOwner } = useCredits()
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const [flyout, setFlyout] = useState<string | null>(null)

  useEffect(() => { setNavOpen(false); setAcctOpen(false); setFlyout(null) }, [pathname])
  useEffect(() => {
    if (!acctOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAcctOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [acctOpen])

  useEffect(() => {
    let mounted = true
    // getSession() reads local storage (no network) so the shell paints instantly;
    // real auth is enforced server-side by APIs + middleware. Display only.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (!session?.user) { router.push('/login'); return }
      setUser(session.user)
      supabase.from('user_profiles').select('*').eq('user_id', session.user.id).single()
        .then(({ data }) => { if (mounted) setProfile(data) })
    })
    return () => { mounted = false }
  }, [])

  const handleSignOut = async () => {
    // Clear the onboarding-gate cookie — otherwise it carries over to the NEXT account signed in on
    // this browser, and that new user skips the onboarding interview (the middleware trusts sm_onb=1).
    try { document.cookie = 'sm_onb=; path=/; max-age=0; samesite=lax' } catch { /* ignore */ }
    await supabase.auth.signOut(); router.push('/login')
  }
  // Cancel plan — one tap from the account menu (paid users only). Keeps access until period end,
  // then the renewals cron downgrades to Free. Confirms first.
  const cancelPlan = async () => {
    if (!(await confirmAction({ title: 'Cancel your subscription?', body: 'You keep full access until the end of your current billing period, then move to Free.', confirmLabel: 'Cancel plan', cancelLabel: 'Keep plan' }))) return
    try {
      const r = await fetch('/api/billing/cancel', { method: 'POST' }).then((x) => x.json()).catch(() => ({}))
      if (r?.ok) { toast.success('Subscription cancelled — access continues until the end of this period.'); router.push('/billing') }
      else toast.error(r?.error || 'Could not cancel — please contact support.')
    } catch { toast.error('Could not cancel — please try again.') }
  }

  const initials = user?.user_metadata?.full_name
    ? user.user_metadata.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0].toUpperCase() || 'A'
  const displayName = user?.user_metadata?.full_name || user?.email || 'User'
  // Trials were removed in pricing-v2 — a stale subscription_status='trialing' (legacy default) must
  // not surface as a "Trial" plan. Always show the real plan label.
  const planLabel = PLANS[normalizePlan(effectivePlan)]?.label || 'Free'

  // ── the account menu (desktop + mobile): credits live HERE now, not in a panel ──
  const AcctMenu = ({ style }: { style: React.CSSProperties }) => (
    <>
      <div onClick={() => setAcctOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 59 }} />
      <div style={{ ...style, width: 264, background: '#fff', border: '1px solid #efece2', borderRadius: 14, boxShadow: '0 14px 44px rgba(20,29,21,0.16)', zIndex: 60, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 12px', borderBottom: '1px solid #eef1ec' }}>
          <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-white text-sm font-black flex-shrink-0">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#161c17', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
            <div style={{ fontSize: 11, color: '#7d877e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{planLabel} plan · {user?.email}</div>
          </div>
        </div>
        <div style={{ padding: '10px 12px 4px' }}><CreditCounter /></div>
        <div style={{ padding: '4px 8px 8px' }}>
          {/* "Dashboard" → the Meta ads cockpit (KPIs / Scale & Insights / Deep Reports). */}
          <AcctItem href="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <AcctItem href="/activity" icon={ClipboardList} label="Activity log" />
          <button onClick={() => { setAcctOpen(false); window.dispatchEvent(new Event('sf:starttour')) }} className="sm-acct-item"
            style={{ ...ACCT_ITEM, width: '100%', border: 'none', background: 'none', cursor: 'pointer', color: '#161c17', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' }}>
            <Sparkles size={16} style={{ flexShrink: 0 }} /><span>Take a tour</span>
          </button>
          <AcctItem href="/mcp" icon={Sparkles} label="API & MCP" />
          <AcctItem href="/team" icon={Users} label="Team & members" />
          <AcctItem href="/billing" icon={CreditCard} label="Billing & plan" />
          {/* Billing actions reflect the OWNER-resolved plan + subscription status (a member never sees
              Cancel/Reactivate — only the owner manages billing). Free → Upgrade. Paid+active → Cancel.
              Paid+canceled (still in the paid period) → Reactivate. */}
          {normalizePlan(effectivePlan) === 'free' && <AcctItem href="/billing" icon={Zap} label="Upgrade plan" accent />}
          {normalizePlan(effectivePlan) !== 'free' && planIsOwner !== false && planCanceled && (
            <AcctItem href="/billing" icon={Zap} label="Reactivate plan" accent />
          )}
          {normalizePlan(effectivePlan) !== 'free' && planIsOwner !== false && !planCanceled && (
            <button onClick={cancelPlan} className="sm-acct-item"
              style={{ ...ACCT_ITEM, width: '100%', border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' }}>
              <X size={16} style={{ flexShrink: 0 }} /><span>Cancel plan</span>
            </button>
          )}
          <AcctItem href="https://chromewebstore.google.com/detail/selfmade-%E2%80%94-save-winning-a/eekbcgdoonpmhoojoaggpfmfgcplaefi" icon={Bookmark} label="Chrome extension" external />
          <AcctItem href="/contact" icon={LifeBuoy} label="Support & feedback" />
          <div style={{ height: 1, background: '#eef1ec', margin: '6px 0' }} />
          <button onClick={handleSignOut} className="sm-acct-item" style={{ ...ACCT_ITEM, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#d64545', fontFamily: 'inherit' }}>
            <LogOut size={16} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Log out</span>
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen" style={{ background: '#f7f8f6' }}>
      <BootMotion />
      <SearchPalette />

      {/* ── MOBILE TOP BAR ── */}
      {isMobile && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 52, zIndex: 45, background: '#f7f8f6', borderBottom: '1px solid #e9ece8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
          <button onClick={() => setNavOpen(true)} aria-label="Open menu" style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#141d15', background: 'transparent', border: 'none', borderRadius: 9 }}>
            <Menu size={22} />
          </button>
          <Link href="/brief" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#ef4a1e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, fontStyle: 'italic', fontFamily: 'Georgia,serif' }}>S</div>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center' }}><NotificationBell /></div>
        </div>
      )}
      {isMobile && navOpen && (
        <div onClick={() => setNavOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,29,21,0.35)', backdropFilter: 'blur(2px)', zIndex: 49 }} />
      )}

      {isMobile ? (
        /* ── MOBILE DRAWER: one flat list of everything ── */
        <aside style={{ width: 290, position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50, background: '#f7f8f6', borderRight: '1px solid #e9ece8', display: 'flex', flexDirection: 'column', transform: navOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.25s ease', boxShadow: navOpen ? '0 0 40px rgba(0,0,0,0.4)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
            <div style={{ fontWeight: 850, fontSize: 16, letterSpacing: '-.02em', color: '#161c17' }}>Selfmade</div>
            <button onClick={() => setNavOpen(false)} aria-label="Close menu" style={{ background: 'transparent', border: 'none', color: '#141d15', padding: 6 }}><X size={18} /></button>
          </div>
          <div style={{ padding: '0 16px 6px' }}><RemakeStarter /></div>
          <nav className="flex-1 overflow-y-auto" style={{ padding: '2px 10px 12px' }}>
            <ItemLink item={{ href: '/mello', icon: () => <MelloFace size={18} />, label: 'Ask Mello' }} active={melloActive} onClick={() => setNavOpen(false)} />
            {AREAS.map(a => (
              <div key={a.key}>
                <div style={{ padding: '14px 8px 4px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: '#a2aca2' }}>{a.label}</div>
                {a.items.map((item, i) => item.section
                  ? <div key={`s:${item.section}`} style={{ padding: '8px 8px 2px', fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#b8c0b6' }}>{item.section}</div>
                  : <ItemLink key={item.href || i} item={item} active={item.href === activeHref} onClick={() => setNavOpen(false)} />)}
              </div>
            ))}
            {/* Settings — lives on the desktop rail; the mobile drawer was missing it entirely. */}
            <div style={{ padding: '14px 8px 4px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: '#a2aca2' }}>Account</div>
            <ItemLink item={{ href: '/settings', icon: Settings, label: 'Settings' }} active={activeHref === '/settings'} onClick={() => setNavOpen(false)} />
          </nav>
          <div style={{ padding: 12, borderTop: '1px solid #e9ece8', position: 'relative' }}>
            <button onClick={() => setAcctOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', borderRadius: 10, padding: 6, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-white text-sm font-black flex-shrink-0">{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#161c17', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                <div style={{ fontSize: 11, color: '#7d877e' }}>{planLabel}</div>
              </div>
            </button>
            {acctOpen && <AcctMenu style={{ position: 'absolute', bottom: '100%', left: 8, marginBottom: 8 }} />}
          </div>
        </aside>
      ) : (
        /* ── DESKTOP: the quiet rail — 72px, nothing else ── */
        <aside
          onMouseLeave={() => setFlyout(null)}
          style={{ width: RAIL_W, position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50, background: '#f7f8f6', borderRight: '1px solid #e9ece8', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0 12px', gap: 3 }}>
          <Link href="/brief" title="Home" style={{ marginBottom: 8 }} onMouseEnter={() => setFlyout(null)}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: '#ef4a1e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, fontStyle: 'italic', fontFamily: 'Georgia,serif' }}>S</div>
          </Link>

          {/* Create — the ONE bold thing on the rail; opens the full 3-way chooser */}
          <div data-tour="rail-create" onMouseEnter={() => setFlyout(null)} style={{ marginBottom: 6 }}>
            <RemakeStarter variant="icon" />
          </div>

          <div onMouseEnter={() => setFlyout(null)}>
            <RailIcon href="/mello" active={melloActive} title="Ask Mello" accent label="Mello" dataTour="nav-mello"><MelloFace size={22} /></RailIcon>
          </div>

          <div style={{ width: 30, height: 1, background: '#e6eae4', margin: '5px 0' }} />

          {AREAS.map(a => {
            const hasFlyout = a.items.filter(i => i.href).length > 1
            return (
              <div key={a.key} style={{ position: 'relative' }} onMouseEnter={() => setFlyout(hasFlyout ? a.key : null)}>
                <RailIcon href={a.defaultHref} title={a.label} label={a.railLabel} active={!melloActive && activeArea?.key === a.key} dataTour={`nav-${a.key}`}>
                  <a.railIcon size={20} />
                </RailIcon>
                {/* hover flyout — the old permanent panel, now on demand */}
                {flyout === a.key && hasFlyout && (
                  <div style={{ position: 'absolute', left: '100%', top: -6, paddingLeft: 10, zIndex: 70 }}>
                    <div style={{ width: 226, background: '#fff', border: '1px solid #efece2', borderRadius: 14, boxShadow: '0 18px 50px rgba(20,29,21,0.16)', padding: '10px 8px' }}>
                      <div style={{ padding: '2px 10px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: '#a2aca2' }}>{a.label}</div>
                      {a.items.map((item, i) => item.section
                        ? <div key={`s:${item.section}`} style={{ padding: '9px 10px 3px', fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#b8c0b6' }}>{item.section}</div>
                        : <ItemLink key={item.href || i} item={item} active={item.href === activeHref} />)}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <div style={{ flex: 1 }} onMouseEnter={() => setFlyout(null)} />

          <div onMouseEnter={() => setFlyout(null)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <NotificationBell up />
            <RailIcon href="/settings" title="Settings" active={!melloActive && pathname === '/settings'}><Settings size={19} /></RailIcon>
            <div style={{ position: 'relative', marginTop: 4 }}>
              <button onClick={() => setAcctOpen(o => !o)} aria-label="Account" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-white text-sm font-black">{initials}</div>
              </button>
              {acctOpen && <AcctMenu style={{ position: 'fixed', bottom: 14, left: RAIL_W + 10 }} />}
            </div>
          </div>
        </aside>
      )}

      {/* ── MAIN — the content owns the screen ── */}
      <div style={{ flex: 1, marginLeft: isMobile ? 0 : RAIL_W, marginTop: isMobile ? 52 : 0, display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fbfcfa', minWidth: 0, maxWidth: isMobile ? '100vw' : `calc(100vw - ${RAIL_W}px)`, overflowX: 'hidden' }}>
        <div id="topbar-portal" />
        {/* Project switcher — top-left of the content, labeled so it's obvious which project you're in
            and that you can switch. Scopes the whole app (sf_brand cookie). */}
        {brands.length > 0 && (
          <div style={{ padding: isMobile ? '12px 16px 0' : '16px 24px 0' }}>
            <ProjectSwitcher initialBrands={brands} initialActive={activeBrand} />
          </div>
        )}
        <main className="flex-1" style={{ minWidth: 0, overflowX: 'hidden' }}>{children}</main>
        <UpsellModalHost />
        <ConfirmHost />
        <CreditModal />
        <ProductTour />

      </div>
    </div>
  )
}
