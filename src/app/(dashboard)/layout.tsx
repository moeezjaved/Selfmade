'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'
import {
  LayoutDashboard, Target, Megaphone, Sparkles, TrendingUp,
  Zap, ClipboardList, Settings, CreditCard,
  Bell, ChevronDown, RefreshCw, LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  {
    label: 'Main',
    items: [
      { href: '/dashboard',        icon: LayoutDashboard, label: 'Dashboard',        badge: null },
      { href: '/recommendations',  icon: Target,          label: 'Recommendations',  badge: '5'  },
      { href: '/campaigns',        icon: Megaphone,       label: 'Campaigns',        badge: null },
      { href: '/ad-engine',        icon: Zap,             label: 'Ad Engine',        badge: 'New'},
      { href: '/m4',               icon: TrendingUp,      label: 'M4 Method',        badge: 'AI'},
      { href: '/creative-studio',  icon: Sparkles,        label: 'Creative Studio',  badge: null },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/activity',         icon: ClipboardList,   label: 'Activity Log',     badge: null },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/settings',         icon: Settings,        label: 'Settings',         badge: null },
      { href: '/billing',          icon: CreditCard,      label: 'Billing',          badge: null },
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

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notifications, setNotifications] = useState(3)

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data: p } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()
      setProfile(p)
    }
    loadUser()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetch('/api/meta/sync', { method: 'POST' })
    } finally {
      setSyncing(false)
    }
  }

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
      <aside className="w-[232px] flex-shrink-0 bg-dark2 border-r border-white/10 flex flex-col fixed top-0 left-0 bottom-0 z-50">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <Link href="/dashboard">
            {/* Logo image — replace src with actual logo */}
            <div className="text-lime font-black text-2xl tracking-tight font-serif italic"><img src="/logo.png" alt="Selfmade" style={{height:42,width:"auto",display:"block"}}/></div>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV.map(section => (
            <div key={section.label}>
              <div className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white/25">
                {section.label}
              </div>
              {section.items.map(item => {
                const isActive = pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn('sidebar-link', isActive && 'active')}
                  >
                    <item.icon size={16} className="flex-shrink-0"/>
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        item.badge === 'New'
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

        {/* User */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-dark text-sm font-black flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white truncate">
                {user?.user_metadata?.full_name || user?.email || 'User'}
              </div>
              <div className="text-xs text-white/40 truncate">
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
      <div className="flex-1 ml-[232px] flex flex-col min-h-screen">

        {/* Topbar — rendered by each page via slot or context */}
        <div id="topbar-portal"/>

        {/* Page content */}
        <main className="flex-1">
          {children}
        </main>

      </div>
    </div>
  )
}
