'use client'

import { useEffect, useState } from 'react'
import { CreditCounter } from '@/components/credits/CreditCounter'
import { CreditModal } from '@/components/credits/CreditModal'
import { NotificationBell } from '@/components/NotificationBell'
import UpsellModalHost from '@/components/UpsellModal'
import RemakeStarter from '@/components/RemakeStarter'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { META_LIVE } from '@/lib/flags'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'
import {
  Settings, LogOut, Menu, X, Check, LifeBuoy, ChevronsUpDown, Zap, Sparkles, CreditCard, Users,
  Compass, Target, TrendingUp, Star, Bookmark, Image as ImageIcon, Heart,
  Rocket, Megaphone, LineChart, BarChart2, Wand2, Store, LayoutDashboard, Terminal, ClipboardList, Trophy, Camera,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
import BootMotion from '@/components/motion/BootMotion'
import SavedReportsNav from '@/components/reports/SavedReportsNav'

// Two-rail nav: each AREA is one icon in the thin rail; its `items` fill the panel. Outline icons.
const AREAS = [
  {
    key: 'discover', label: 'Ad Discovery', railLabel: 'Discovery', railIcon: Compass, defaultHref: '/discovery',
    items: [
      { href: '/discovery',            icon: Compass,      label: 'Discovery',  badge: 'NEW' },
      { href: '/discovery/brand-spy',  icon: Target,       label: 'Brand Spy',  badge: 'NEW' },
      { href: '/trending',             icon: TrendingUp,   label: 'Trending',   badge: 'NEW' },
      { href: '/discovery/top-picks',  icon: Star,         label: 'Top Picks',  badge: null },
      { href: '/discovery/saved',      icon: Bookmark,     label: 'Boards',     badge: null },
      { href: '/assets',               icon: ImageIcon,    label: 'Assets',     badge: 'NEW' },
      { href: '/discovery/following',  icon: Heart,        label: 'Following',  badge: null },
    ],
  },
  {
    key: 'analytics', label: 'Analytics & Launch', railLabel: 'Launch', railIcon: Rocket, defaultHref: '/m4',
    // While META_LIVE is off (new Facebook app in review) these pages show a coming-soon teaser,
    // so badge them SOON here to set expectations before the click.
    items: [
      { href: '/m4',         icon: Rocket,      label: 'Launch Ads',       badge: META_LIVE ? 'AI' : 'SOON' },
      { href: '/campaigns',  icon: Megaphone,   label: 'Campaigns',        badge: META_LIVE ? null : 'SOON' },
      { href: '/insights',   icon: LineChart,   label: 'Scale & Insights', badge: META_LIVE ? 'NEW' : 'SOON' },
      { href: '/reports',    icon: BarChart2,   label: 'Reports',          badge: META_LIVE ? 'NEW' : 'SOON' },
      { href: '/leaderboard',icon: Trophy,      label: 'Leaderboard',      badge: META_LIVE ? 'NEW' : 'SOON' },
      { href: '/snapshots',  icon: Camera,      label: 'Snapshots',        badge: META_LIVE ? null : 'SOON' },
    ],
  },
  {
    key: 'create', label: 'AI Gen', railLabel: 'AI Gen', railIcon: Wand2, defaultHref: '/creative-studio',
    items: [
      { href: '/creative-studio?studio=1', icon: Wand2,     label: 'Create Ad',    badge: 'NEW' },
      { href: '/creative-studio', icon: Sparkles,           label: 'My Creatives', badge: null },
      { href: '/brands',          icon: Store,              label: 'Brands',       badge: null },
    ],
  },
  {
    key: 'account', label: 'Account', railIcon: Settings, defaultHref: '/dashboard',
    items: [
      { href: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard',       badge: null },
      { href: '/mcp',        icon: Terminal,        label: 'API & MCP',       badge: 'NEW' },
      { href: '/team',       icon: Users,           label: 'Team',            badge: 'NEW' },
      { href: '/activity',   icon: ClipboardList,   label: 'Activity Log',    badge: null },
      { href: '/settings',   icon: Settings,        label: 'Settings',        badge: null },
      { href: '/billing',    icon: CreditCard,      label: 'Billing & plans', badge: null },
    ],
  },
]

// Thin-rail icon button (icon-only, tooltip on hover).
function RailIcon({ href, active, title, accent, label, children }: {
  href: string; active: boolean; title: string; accent?: boolean; label?: string; children: React.ReactNode
}) {
  return (
    <Link href={href} title={title} aria-label={title}
      className={cn('rail-icon', accent && 'accent', active && 'active')}>
      {children}
      {label && <span className="rail-label">{label}</span>}
    </Link>
  )
}

// Shared row style + item for the account dropdown.
const ACCT_ITEM: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, textDecoration: 'none' }
function AcctItem({ href, icon: Icon, label, accent }: { href: string; icon: React.ElementType; label: string; accent?: boolean }) {
  return (
    <Link href={href} className="sm-acct-item" style={{ ...ACCT_ITEM, color: accent ? '#dffe95' : 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: accent ? 700 : 500 }}>
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span>{label}</span>
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
  const [acctOpen, setAcctOpen] = useState(false)
  // Close the mobile drawer + account menu whenever the route changes.
  useEffect(() => { setNavOpen(false); setAcctOpen(false) }, [pathname])
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
  const displayName = user?.user_metadata?.full_name || user?.email || 'User'
  const planLabel = profile?.subscription_status === 'trialing'
    ? 'Trial'
    : (profile?.plan_id ? profile.plan_id.charAt(0).toUpperCase() + profile.plan_id.slice(1) : 'Free')
  const statusLabel = (profile?.subscription_status === 'canceled' || profile?.subscription_status === 'past_due') ? 'Inactive' : 'Active'

  return (
    <div className="flex min-h-screen bg-dark">
      <BootMotion />

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
      <aside style={{width:320,flexShrink:0,display:"flex",position:"fixed",top:0,left:0,bottom:0,zIndex:50,
        transform: isMobile && !navOpen ? "translateX(-100%)" : "translateX(0)",
        transition:"transform 0.25s ease",
        boxShadow: isMobile && navOpen ? "0 0 40px rgba(0,0,0,0.4)" : "none"}}>

        {/* Close button inside the drawer — only when open, else it peeks past the off-screen edge */}
        {isMobile && navOpen && (
          <button onClick={() => setNavOpen(false)} aria-label="Close menu" style={{position:"absolute",top:10,right:-1,transform:"translateX(100%)",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",background:"#1c2f19",border:"1px solid rgba(223,254,149,0.1)",borderLeft:"none",borderRadius:"0 9px 9px 0"}}>
            <X size={18}/>
          </button>
        )}

        {/* Rail 1 — icon rail with labels below */}
        <div style={{width:70,flexShrink:0,background:"#0b140d",borderRight:"1px solid rgba(255,255,255,0.05)",display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 0",gap:3}}>
          <Link href="/dashboard" title="Home" style={{marginBottom:10}}>
            <div style={{width:34,height:34,borderRadius:11,background:"#dffe95",color:"#0e1b12",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:18,fontStyle:"italic",fontFamily:"Georgia,serif"}}>S</div>
          </Link>

          {/* Mello — the AI, pinned top */}
          <RailIcon href="/mello" active={melloActive} title="Ask Mello" accent label="Mello">
            <Sparkles size={20}/>
          </RailIcon>

          <div style={{width:30,height:1,background:"rgba(255,255,255,0.06)",margin:"5px 0"}}/>

          {/* Top areas — outline icon + label below */}
          {AREAS.filter(a => a.key !== 'account').map(a => (
            <RailIcon key={a.key} href={a.defaultHref} title={a.label} label={(a as any).railLabel} active={!melloActive && activeArea.key === a.key}>
              <a.railIcon size={20}/>
            </RailIcon>
          ))}

          <div style={{flex:1}}/>

          {/* Settings pinned bottom */}
          <RailIcon href="/settings" title="Settings" label="Settings" active={!melloActive && pathname === '/settings'}>
            <Settings size={20}/>
          </RailIcon>
        </div>

        {/* Rail 2 — contextual panel */}
        <div style={{width:250,flexShrink:0,background:"radial-gradient(140% 120% at 0% 0%, #16281a 0%, #0e1b12 55%)",borderRight:"1px solid rgba(255,255,255,0.05)",display:"flex",flexDirection:"column"}}>

          {/* Panel header: area title + workspace + bell */}
          <div style={{padding:"18px 16px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:15,fontWeight:800,color:"#f4f7ef",letterSpacing:"-.01em"}}>{melloActive ? 'Ask Mello' : activeArea.label}</div>
              <div style={{fontSize:11.5,fontWeight:500,color:"#7c8577",marginTop:1}}>Selfmade workspace</div>
            </div>
            <NotificationBell />
          </div>

          {/* Primary action — the bold, always-there entry to the core remake loop (replaces the Ask
              Mello card here; Mello stays reachable from the rail icon on the left). */}
          <div style={{ padding: '0 20px' }}><RemakeStarter /></div>

          <div style={{padding:"10px 20px 6px",fontSize:10,fontWeight:800,letterSpacing:".1em",textTransform:"uppercase",color:"rgba(255,255,255,0.28)"}}>Workspace</div>

          {/* Nav items — outline icon + label; active = solid lime pill; lime dot for updates */}
          <nav className="flex-1 overflow-y-auto" style={{padding:"2px 12px"}}>
            {activeArea.items.map(item => {
              const isActive = item.href === activeHref
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-nav={item.href === '/creative-studio' ? 'creatives' : undefined}
                  className={cn('sidebar-link', isActive && 'active')}
                >
                  <item.icon size={19} strokeWidth={1.9} className="flex-shrink-0"/>
                  <span style={{flex:1,minWidth:0}}>{item.label}</span>
                  {item.badge === 'AI' && (
                    <span style={{fontSize:9,fontWeight:800,letterSpacing:".04em",padding:"2px 6px",borderRadius:99,background:isActive?"#0e1b12":"#dffe95",color:isActive?"#dffe95":"#0e1b12",flexShrink:0}}>AI</span>
                  )}
                  {(item.badge === 'NEW' || item.badge === 'New') && (
                    <span title="New" style={{width:7,height:7,borderRadius:99,background:isActive?"#0e1b12":"#dffe95",flexShrink:0}}/>
                  )}
                  {item.badge === 'SOON' && (
                    <span style={{fontSize:9,fontWeight:800,letterSpacing:".04em",padding:"2px 6px",borderRadius:99,background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.45)",border:"1px solid rgba(255,255,255,0.12)",flexShrink:0}}>SOON</span>
                  )}
                </Link>
              )
            })}
            {/* Saved reports live under the Reports item in the Analytics area. Hidden while META_LIVE
                is off — Reports is a Coming-soon (Meta-connected) surface, so its "Create report" +
                saved list would be dead. */}
            {META_LIVE && !melloActive && activeArea.key === 'analytics' && <SavedReportsNav />}
          </nav>

          {/* Save ads from — extension / IG-mobile entry points (Atria-style) */}
          <div style={{padding:"10px 14px",borderTop:"1px solid rgba(223,254,149,0.08)"}}>
            <div style={{fontSize:9.5,fontWeight:800,letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,0.32)",marginBottom:7}}>Save ads from</div>
            <div style={{display:"flex",gap:6}}>
              <a href="https://chromewebstore.google.com/detail/selfmade-%E2%80%94-save-winning-a/eekbcgdoonpmhoojoaggpfmfgcplaefi" target="_blank" rel="noopener noreferrer" title="Install the Chrome extension" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 8px",borderRadius:8,background:"rgba(223,254,149,0.1)",border:"1px solid rgba(223,254,149,0.14)",color:"#dffe95",fontSize:11.5,fontWeight:700,textDecoration:"none"}}>🧩 Extension</a>
              <Link href="/settings" title="Save from Instagram on mobile" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"6px 8px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.7)",fontSize:11.5,fontWeight:700,textDecoration:"none"}}>📱 IG</Link>
            </div>
          </div>

          {/* Credits + Account menu */}
          <div style={{padding:14,borderTop:"1px solid rgba(223,254,149,0.08)",position:"relative"}}>
            <div style={{marginBottom:12}}><CreditCounter /></div>

            {/* Account button → opens the dropdown */}
            <button onClick={() => setAcctOpen(o => !o)}
              style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:acctOpen?"rgba(255,255,255,0.06)":"transparent",border:"none",borderRadius:10,padding:6,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
              <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-dark text-sm font-black flex-shrink-0">{initials}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.9)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayName}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{planLabel} · {statusLabel}</div>
              </div>
              <ChevronsUpDown size={15} color="rgba(255,255,255,0.4)" style={{flexShrink:0}}/>
            </button>

            {/* Dropdown (pops up above the button) */}
            {acctOpen && (
              <>
                <div onClick={() => setAcctOpen(false)} style={{position:"fixed",inset:0,zIndex:59}}/>
                <div style={{position:"absolute",bottom:"100%",left:8,right:8,marginBottom:8,minWidth:236,background:"#1c2f19",border:"1px solid rgba(223,254,149,0.14)",borderRadius:14,boxShadow:"0 14px 44px rgba(0,0,0,0.5)",zIndex:60,overflow:"hidden"}}>
                  {/* header */}
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 14px 12px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                    <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-dark text-sm font-black flex-shrink-0">{initials}</div>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayName}</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.email}</div>
                    </div>
                  </div>
                  {/* workspace */}
                  <div style={{padding:"8px 8px 2px"}}>
                    <div style={{fontSize:9.5,fontWeight:800,letterSpacing:".07em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)",padding:"2px 8px 6px"}}>Workspace</div>
                    <Link href="/team" className="sm-acct-item" style={ACCT_ITEM}>
                      <div style={{width:26,height:26,borderRadius:7,background:"#dffe95",color:"#243d20",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,flexShrink:0}}>{initials}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12.5,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayName.split(' ')[0]}’s Workspace</div>
                        <div style={{fontSize:10.5,color:"rgba(255,255,255,0.45)"}}>{planLabel} plan</div>
                      </div>
                      <Check size={16} color="#dffe95" style={{flexShrink:0}}/>
                    </Link>
                  </div>
                  <div style={{height:1,background:"rgba(255,255,255,0.06)",margin:"4px 0"}}/>
                  {/* items */}
                  <div style={{padding:"4px 8px 8px"}}>
                    <AcctItem href="/mcp" icon={Sparkles} label="API & MCP" />
                    <AcctItem href="/settings" icon={Settings} label="Settings" />
                    <AcctItem href="/team" icon={Users} label="Team & members" />
                    <AcctItem href="/billing" icon={CreditCard} label="Billing & plan" />
                    <AcctItem href="/billing" icon={Zap} label="Upgrade plan" accent />
                    <AcctItem href="/contact" icon={LifeBuoy} label="Support & feedback" />
                    <div style={{height:1,background:"rgba(255,255,255,0.06)",margin:"6px 0"}}/>
                    <button onClick={handleSignOut} className="sm-acct-item" style={{...ACCT_ITEM,width:"100%",border:"none",background:"transparent",cursor:"pointer",color:"#ff9d9d",fontFamily:"inherit"}}>
                      <LogOut size={16} style={{flexShrink:0}}/>
                      <span style={{fontSize:13,fontWeight:600}}>Log out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{flex:1,
        marginLeft: isMobile ? 0 : 320,
        marginTop: isMobile ? 52 : 0,
        display:"flex",flexDirection:"column",minHeight:"100vh",background:"#eef5eb",minWidth:0,
        maxWidth: isMobile ? "100vw" : "calc(100vw - 320px)",
        overflowX:"hidden"}}>
        <div id="topbar-portal"/>
        <main className="flex-1" style={{minWidth:0,overflowX:"hidden"}}>
          {children}
        </main>
        <UpsellModalHost />
        <CreditModal />
      </div>
    </div>
  )
}
