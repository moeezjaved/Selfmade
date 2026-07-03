'use client'

import { useEffect, useState } from 'react'
import { CreditCounter } from '@/components/credits/CreditCounter'
import { NotificationBell } from '@/components/NotificationBell'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'
import {
  LayoutDashboard, Megaphone, Sparkles, TrendingUp,
  ClipboardList, Settings, CreditCard, BarChart2,
  Rocket, LogOut, Compass, Bookmark, Heart, Star, Store, Radar,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  {
    label: 'Ad Discovery',
    items: [
      { href: '/discovery',            icon: Compass,   label: 'Discovery',     badge: 'NEW' },
      { href: '/discovery/brand-spy',  icon: Radar,     label: 'Brand Spy',     badge: 'NEW' },
      { href: '/patterns',             icon: BarChart2, label: 'Patterns',      badge: 'NEW' },
      { href: '/discovery/top-picks',  icon: Star,      label: 'Top Picks',     badge: null },
      { href: '/discovery/saved',      icon: Bookmark,  label: 'Saved Ads',     badge: null },
      { href: '/discovery/following',  icon: Heart,     label: 'Following',      badge: null },
    ],
  },
  {
    label: 'Analytics & Launch',
    items: [
      { href: '/m4',         icon: Rocket,      label: 'Launch Ads',       badge: 'AI' },
      { href: '/campaigns',  icon: Megaphone,   label: 'Campaigns',        badge: null },
      { href: '/insights',   icon: TrendingUp,  label: 'Scale & Insights', badge: 'NEW' },
      { href: '/reports',    icon: BarChart2,   label: 'Reports',          badge: 'NEW' },
    ],
  },
  {
    label: 'AI Gen',
    items: [
      { href: '/creative-studio', icon: Sparkles, label: 'My Creatives', badge: 'NEW' },
      { href: '/brands',          icon: Store,    label: 'Brands',       badge: null },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard',    badge: null },
      { href: '/activity',   icon: ClipboardList,   label: 'Activity Log', badge: null },
      { href: '/settings',   icon: Settings,        label: 'Settings',     badge: null },
      { href: '/pricing',    icon: CreditCard,      label: 'Plans & Pricing', badge: null },
      { href: '/billing',    icon: CreditCard,      label: 'Billing',      badge: null },
    ],
  },
]

interface DashboardLayoutProps {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  // The single active nav item = the longest href that prefixes the current path.
  const activeHref = NAV.flatMap(s => s.items.map(i => i.href))
    .filter(h => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0]

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
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

      {/* ── SIDEBAR ── */}
      <aside style={{width:232,flexShrink:0,background:"#243d20",borderRight:"1px solid rgba(223,254,149,0.08)",display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,bottom:0,zIndex:50}}>

        {/* Logo + notification bell */}
        <div style={{padding:"18px 20px",borderBottom:"1px solid rgba(223,254,149,0.08)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <Link href="/dashboard">
            <div className="text-lime font-black text-2xl tracking-tight font-serif italic">
              <img src="/logo.png" alt="Selfmade" style={{height:42,width:"auto",display:"block"}}/>
            </div>
          </Link>
          <NotificationBell />
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {/* Mello — primary AI agent, pinned at the top (Raya-style) */}
          {(() => {
            const melloActive = pathname === '/mello' || pathname.startsWith('/mello/')
            return (
              <div style={{padding:"0 12px 6px"}}>
                <Link
                  href="/mello"
                  style={{
                    display:"flex",alignItems:"center",gap:10,padding:"11px 12px",borderRadius:11,
                    background: melloActive ? "#dffe95" : "rgba(223,254,149,0.10)",
                    border: melloActive ? "1px solid #dffe95" : "1px solid rgba(223,254,149,0.18)",
                    transition:"all .15s",
                  }}
                >
                  <span style={{width:26,height:26,borderRadius:8,background: melloActive ? "#2d5a27" : "#dffe95",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <Sparkles size={15} color={melloActive ? "#dffe95" : "#2d5a27"} />
                  </span>
                  <span style={{flex:1,fontWeight:800,fontSize:14.5,color: melloActive ? "#243d20" : "rgba(255,255,255,0.92)"}}>Ask Mello</span>
                  <span style={{fontSize:9,fontWeight:800,letterSpacing:".04em",padding:"2px 7px",borderRadius:99,background: melloActive ? "#2d5a27" : "#dffe95",color: melloActive ? "#dffe95" : "#243d20"}}>AI</span>
                </Link>
              </div>
            )
          })()}

          {NAV.map(section => (
            <div key={section.label}>
              <div style={{padding:"16px 20px 6px",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".1em",color:"rgba(255,255,255,0.2)"}}>
                {section.label}
              </div>
              {section.items.map(item => {
                // Active = the LONGEST matching href, so /discovery/saved highlights
                // "Saved" (not also "Discovery"); /discovery/<adId> still highlights Discovery.
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
                    {item.badge && (
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        item.badge === 'New' || item.badge === 'NEW'
                          ? 'bg-lime/20 text-lime border border-lime/30'
                          : 'bg-lime text-dark'
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Credits + User */}
        <div style={{padding:16,borderTop:"1px solid rgba(223,254,149,0.08)"}}>
          <div style={{marginBottom:12}}><CreditCounter /></div>
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-dark text-sm font-black flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.9)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {user?.user_metadata?.full_name || user?.email || 'User'}
              </div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {profile?.subscription_status === 'trialing' ? 'Trial' : 'Pro'} · Active
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
      </aside>

      {/* ── MAIN ── */}
      <div style={{flex:1,marginLeft:232,display:"flex",flexDirection:"column",minHeight:"100vh",background:"#eef5eb",minWidth:0,maxWidth:"calc(100vw - 232px)",overflowX:"hidden"}}>
        <div id="topbar-portal"/>
        <main className="flex-1" style={{minWidth:0,overflowX:"hidden"}}>
          {children}
        </main>
      </div>
    </div>
  )
}
