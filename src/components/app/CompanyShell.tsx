'use client'
/**
 * CompanyShell — Unified Shell v2 (flat, always-visible sidebar; Result/Lapis pattern), behind the
 * `sf_shell=v2` flag. Phase 1: the chrome only — every existing page renders inside it, nav links to the
 * real routes. Light + our orange, matching the ads-studio sidebar. Home/Company/Ads are the lit primary
 * groups; SEO + Intel sit dimmed under a "Grows with your stage" divider (stage logic lands later).
 * The old AppShell is untouched (rollback at ?shell=v1). See docs/…/unified-shell-v2-design.md.
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Inbox, Map, Users, Brain, FileText, Wand2, Image as ImageIcon, BarChart2, Rocket, Plug, Radar, Eye, Bookmark, Store, Menu, X } from 'lucide-react'
import { useIsMobile } from '@/lib/useIsMobile'
import { useCredits } from '@/components/credits/CreditCounter'
import ProjectSwitcher from '@/components/app/ProjectSwitcher'

const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.1)', ORANGE = '#e02f06', ORANGE_WASH = '#fdeee9', MUTED = '#b9b1a3'
const SERIF = 'Fraunces, Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

type Item = { href: string; label: string; icon?: React.ElementType }
type Group = { label?: string; stage?: boolean; items: Item[] }

const NAV: Group[] = [
  { items: [{ href: '/mission', label: 'Home', icon: Home }, { href: '/inbox', label: 'Inbox', icon: Inbox }] },
  { label: 'Company', items: [
    { href: '/mission/journey', label: 'Journey', icon: Map },
    { href: '/company', label: 'Your Team', icon: Users },
    { href: '/brain', label: 'Company Brain', icon: Brain },
    { href: '/documents', label: 'Documents', icon: FileText },
  ] },
  { label: 'Ads', items: [
    { href: '/ads-studio', label: 'Ad Studio', icon: Wand2 },
    { href: '/creative-studio', label: 'My Creatives', icon: ImageIcon },
    { href: '/reports', label: 'Reports', icon: BarChart2 },
    { href: '/m4', label: 'Launch Ads', icon: Rocket },
    { href: '/connect/meta', label: 'Connect Meta', icon: Plug },
  ] },
  { label: 'SEO', stage: true, items: [{ href: '/grow', label: 'Growth', icon: BarChart2 }] },
  { label: 'Intel', stage: true, items: [
    { href: '/discovery', label: 'All ads', icon: Radar },
    { href: '/discovery/brand-spy', label: 'Brand Spy', icon: Eye },
    { href: '/discovery/saved', label: 'Boards', icon: Bookmark },
    { href: '/brands', label: 'My Brands', icon: Store },
  ] },
]

export default function CompanyShell({ brands, activeBrand, children }: { brands: { id: string; name: string }[]; activeBrand: string; children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const { plan } = useCredits()
  const isPaid = !!plan && plan !== 'free'

  const isActive = (href: string) => href === '/mission' ? (pathname === '/mission' || pathname === '/') : pathname === href || pathname.startsWith(href + '/')

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
          {g.label && <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: SUB, opacity: .7, padding: '4px 10px 5px' }}>{g.label}</div>}
          {g.items.map((it) => {
            const on = isActive(it.href)
            const Icon = it.icon
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, textDecoration: 'none', background: on ? ORANGE_WASH : 'transparent', color: on ? ORANGE : '#43403a', fontWeight: on ? 800 : 600, fontSize: 13.5, fontFamily: SANS, opacity: g.stage && !on ? 0.55 : 1, transition: 'background .12s' }}>
                {Icon && <Icon size={16} style={{ flex: 'none', color: on ? ORANGE : SUB }} />}{it.label}
              </Link>
            )
          })}
        </div>
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 14 }}>
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 11, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, color: SUB, textAlign: 'center', marginBottom: 8 }}>⚡ {isPaid ? `${(plan || '').replace(/^\w/, (c) => c.toUpperCase())} plan` : 'Free plan'}</div>
        {!isPaid && <a href="/hire" style={{ display: 'block', background: ORANGE, color: '#fff', borderRadius: 11, padding: '9px 12px', fontSize: 12.5, fontWeight: 800, textAlign: 'center', textDecoration: 'none' }}>Hire the team →</a>}
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
