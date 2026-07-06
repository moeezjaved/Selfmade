'use client'

import { useEffect, useState } from 'react'
import { CreditCounter } from '@/components/credits/CreditCounter'
import { NotificationBell } from '@/components/NotificationBell'
import UpsellModalHost from '@/components/UpsellModal'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'
import {
  LayoutDashboard, Megaphone, Sparkles, TrendingUp,
  ClipboardList, Settings, CreditCard, BarChart2,
  Rocket, LogOut, Compass, Bookmark, Heart, Star, Store, Radar, Wand2, Flame, Users, Library,
  Menu, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'

// Two-rail nav: each AREA is one icon in the thin rail; its `items` fill the panel.
const AREAS = [
  {
    key: 'discover', label: 'Ad Discovery', railIcon: Compass, defaultHref: '/discovery',
    items: [
      { href: '/discovery',            icon: Compass,   label: 'Discovery',     badge: 'NEW' },
      { href: '/discovery/brand-spy',  icon: Radar,     label: 'Brand Spy',     badge: 'NEW' },
      { href: '/trending',             icon: Flame,     label: 'Trending',      badge: 'NEW' },
      { href: '/discovery/top-picks',  icon: Star,      label: 'Top Picks',     badge: null },
      { href: '/discovery/saved',      icon: Bookmark,  label: 'Boards',        badge: null },
      { href: '/assets',               icon: Library,   label: 'Assets',        badge: 'NEW' },
      { href: '/discovery/following',  icon: Heart,     label: 'Following',      badge: null },
    ],
  },
  {
    key: 'analytics', label: 'Analytics & Launch', railIcon: Rocket, defaultHref: '/m4',
    items: [
      { href: '/m4',         icon: Rocket,      label: 'Launch Ads',       badge: 'AI' },
      { href: '/campaigns',  icon: Megaphone,   label: 'Campaigns',        badge: null },
      { href: '/insights',   icon: TrendingUp,  label: 'Scale & Insights', badge: 'NEW' },
      { href: '/reports',    icon: BarChart2,   label: 'Reports',          badge: 'NEW' },
    ],
  },
  {
    key: 'create', label: 'AI Gen', railIcon: Wand2, defaultHref: '/creative-studio',
    items: [
      { href: '/creative-studio?studio=1', icon: Wand2, label: 'Create Ad',  badge: 'NEW' },
      { href: '/creative-studio', icon: Sparkles, label: 'My Creatives', badge: null },
      { href: '/brands',          icon: Store,    label: 'Brands',       badge: null },
    ],
  },
  {
    key: 'account', label: 'Account', railIcon: Settings, defaultHref: '/dashboard',
    items: [
      { href: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard',    badge: null },
      { href: '/mcp',        icon: Sparkles,        label: 'API & MCP',    badge: 'NEW' },
      { href: '/team',       icon: Users,           label: 'Team',         badge: 'NEW' },
      { href: '/activity',   icon: ClipboardList,   label: 'Activity Log', badge: null },
      { href: '/settings',   icon: Settings,        label: 'Settings',     badge: null },
      { href: '/billing',    icon: CreditCard,      label: 'Billing & plans', badge: null },
    ],
  },
]

// Thin-rail icon button (icon-only, tooltip on hover).
function RailIcon({ href, active, title, accent, children }: {
  href: string; active: boolean; title: string; accent?: boolean; children: React.ReactNode
}) {
  return (
    <Link href={href} title={title} aria-label={title}
      className={cn('rail-icon', accent && 'accent', active && 'active')}>
      {children}
    </Link>
  )
}

interface DashboardLayoutProps {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  // The single active nav item = the longest href that prefixes the current path.
  const activeHref = AREAS.flatMap(s => s.items.map(i => i.href))
    .filter(h => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0]
  const melloActive = pathname === '/mello' || pathname.startsWith('/mello/')
  // Which AREA the panel shows: the one containing the active item (fall back to first, e.g. on /mello).
  const activeArea = AREAS.find(a => a.items.some(i => i.href === activeHref)) || AREAS[0]

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)
  // Close the mobile drawer whenever the route changes (tapping a nav item navigates → dismiss).
  useEffect(() => { setNavOpen(false) }, [pathname])
  // NOTE: this layout used to be gated behind a whole-layout `mounted` flag (returned a blank
  // placeholder until a post-mount effect flipped it). That was meant to dodge hydration #418/#423/
  // #425 — but those turned out to be browser EXTENSIONS injecting into <html>/<body>, not our code,
  // so the gate fixed nothing. Worse, it DEADLOCKED: on a direct load of a route whose page uses
  // next/dynamic(ssr:false) (e.g. /discovery), the layout's setMounted effect never committed and
  // the page rendered a permanent blank-green screen. Rendering the layout unconditionally fixes it —
  // the sidebar SSRs immediately; user-dependent bits (avatar/initials) are null→'A' on both server
  // and first client render, so there's no real mismatch, just a post-load update.
  useEffect(() => {
    let mounted = true
    // getSession() reads the session from LOCAL STORAGE (no network round-trip), so the
    // user's name/initials/plan render on first paint. getUser() POSTs to the auth
    // server to validate the JWT — that network wait was the blank "User / … credits"
    // cold-start delay. Page-level auth is still enforced server-side by the API routes
    // and middleware; this is display only. The profile (plan badge) loads in the
    // background and never blocks the name from showing.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (!session?.user) { router.push('/login'); return }
      setUser(session.user)
      supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single()
        .then(({ data }) => { if (mounted) setProfile(data) })
    })
    return () => { mounted = false }
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = user?.user_metadata?.full_name
    ? user.user_metadata.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0].toUpperCase() || 'A'

  return (
    <div className="flex min-h-screen bg-dark">

      {/* ── MOBILE TOP BAR (hamburger) — only < 768px ── */}
      {isMobile && (
        <div style={{position:"fixed",top:0,left:0,right:0,height:52,zIndex:45,background:"#1c2f19",borderBottom:"1px solid rgba(223,254,149,0.1)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px"}}>
          <button onClick={() => setNavOpen(true)} aria-label="Open menu" style={{width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",color:"#dffe95",background:"transparent",border:"none",borderRadius:9}}>
            <Menu size={22}/>
          </button>
          <Link href="/dashboard" style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:28,height:28,borderRadius:8,background:"#dffe95",color:"#243d20",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:16,fontStyle:"italic",fontFamily:"Georgia,serif"}}>S</div>
          </Link>
          <div style={{display:"flex",alignItems:"center"}}><NotificationBell /></div>
        </div>
      )}

      {/* Backdrop behind the open drawer on mobile */}
      {isMobile && navOpen && (
        <div onClick={() => setNavOpen(false)} style={{position:"fixed",inset:0,background:"rgba(14,27,18,0.5)",backdropFilter:"blur(2px)",zIndex:49}}/>
      )}

      {/* ── SIDEBAR (two-rail: thin icon rail + contextual panel) ── */}
      <aside style={{width:256,flexShrink:0,display:"flex",position:"fixed",top:0,left:0,bottom:0,zIndex:50,
        transform: isMobile && !navOpen ? "translateX(-100%)" : "translateX(0)",
        transition:"transform 0.25s ease",
        boxShadow: isMobile && navOpen ? "0 0 40px rgba(0,0,0,0.4)" : "none"}}>

        {/* Close button inside the drawer — only when open, else it peeks past the off-screen edge */}
        {isMobile && navOpen && (
          <button onClick={() => setNavOpen(false)} aria-label="Close menu" style={{position:"absolute",top:10,right:-1,transform:"translateX(100%)",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",background:"#1c2f19",border:"1px solid rgba(223,254,149,0.1)",borderLeft:"none",borderRadius:"0 9px 9px 0"}}>
            <X size={18}/>
          </button>
        )}

        {/* Rail 1 — thin icon rail */}
        <div style={{width:56,flexShrink:0,background:"#1c2f19",borderRight:"1px solid rgba(223,254,149,0.08)",display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 0",gap:5}}>
          <Link href="/dashboard" title="Home" style={{marginBottom:8}}>
            <div style={{width:32,height:32,borderRadius:9,background:"#dffe95",color:"#243d20",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:18,fontStyle:"italic",fontFamily:"Georgia,serif"}}>S</div>
          </Link>

          {/* Mello — the AI, pinned top */}
          <RailIcon href="/mello" active={melloActive} title="Ask Mello" accent>
            <Sparkles size={18}/>
          </RailIcon>

          <div style={{width:22,height:1,background:"rgba(255,255,255,0.08)",margin:"5px 0"}}/>

          {/* Top areas */}
          {AREAS.filter(a => a.key !== 'account').map(a => (
            <RailIcon key={a.key} href={a.defaultHref} title={a.label} active={!melloActive && activeArea.key === a.key}>
              <a.railIcon size={18}/>
            </RailIcon>
          ))}

          <div style={{flex:1}}/>

          {/* Account pinned bottom */}
          <RailIcon href="/dashboard" title="Account" active={!melloActive && activeArea.key === 'account'}>
            <Settings size={18}/>
          </RailIcon>
        </div>

        {/* Rail 2 — contextual panel */}
        <div style={{width:200,flexShrink:0,background:"#243d20",borderRight:"1px solid rgba(223,254,149,0.08)",display:"flex",flexDirection:"column"}}>

          {/* Panel header: active area name + bell */}
          <div style={{padding:"20px 16px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <span style={{fontSize:13,fontWeight:800,color:"#dffe95",letterSpacing:"-.01em"}}>
              {melloActive ? 'Ask Mello' : activeArea.label}
            </span>
            <NotificationBell />
          </div>

          {/* Items of the active area */}
          <nav className="flex-1 overflow-y-auto" style={{padding:"2px 0"}}>
            {activeArea.items.map(item => {
              // Active = the LONGEST matching href (see activeHref above).
              const isActive = item.href === activeHref
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-nav={item.href === '/creative-studio' ? 'creatives' : undefined}
                  className={cn('sidebar-link', isActive && 'active')}
                >
                  <item.icon size={16} className="flex-shrink-0"/>
                  <span className="flex-1">{item.label}</span>
                  {item.badge === 'AI' && (
                    <span style={{fontSize:9,fontWeight:800,letterSpacing:".04em",padding:"2px 6px",borderRadius:99,background:"#dffe95",color:"#243d20"}}>AI</span>
                  )}
                  {(item.badge === 'NEW' || item.badge === 'New') && (
                    <span title="New" style={{width:6,height:6,borderRadius:99,background:"#dffe95",flexShrink:0}}/>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Save ads from — extension / IG-mobile entry points (Atria-style) */}
          <div style={{padding:"10px 14px",borderTop:"1px solid rgba(223,254,149,0.08)"}}>
            <div style={{fontSize:9.5,fontWeight:800,letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,0.32)",marginBottom:7}}>Save ads from</div>
            <div style={{display:"flex",gap:6}}>
              <Link href="/settings" title="Get the browser extension" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 8px",borderRadius:8,background:"rgba(223,254,149,0.1)",border:"1px solid rgba(223,254,149,0.14)",color:"#dffe95",fontSize:11.5,fontWeight:700,textDecoration:"none"}}>🧩 Extension</Link>
              <Link href="/settings" title="Save from Instagram on mobile" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 8px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.7)",fontSize:11.5,fontWeight:700,textDecoration:"none"}}>📱 IG</Link>
            </div>
          </div>

          {/* Credits + User */}
          <div style={{padding:14,borderTop:"1px solid rgba(223,254,149,0.08)"}}>
            <div style={{marginBottom:12}}><CreditCounter /></div>
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-dark text-sm font-black flex-shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.9)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {user?.user_metadata?.full_name || user?.email || 'User'}
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {profile?.subscription_status === 'trialing'
                    ? 'Trial'
                    : (profile?.plan_id ? profile.plan_id.charAt(0).toUpperCase() + profile.plan_id.slice(1) : 'Free')} · {profile?.subscription_status === 'canceled' || profile?.subscription_status === 'past_due' ? 'Inactive' : 'Active'}
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white/70"
              >
                <LogOut size={14}/>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{flex:1,
        marginLeft: isMobile ? 0 : 256,
        marginTop: isMobile ? 52 : 0,
        display:"flex",flexDirection:"column",minHeight:"100vh",background:"#eef5eb",minWidth:0,
        maxWidth: isMobile ? "100vw" : "calc(100vw - 256px)",
        overflowX:"hidden"}}>
        <div id="topbar-portal"/>
        <main className="flex-1" style={{minWidth:0,overflowX:"hidden"}}>
          {children}
        </main>
        <UpsellModalHost />
      </div>
    </div>
  )
}
