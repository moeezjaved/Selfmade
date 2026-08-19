'use client'
/**
 * AdsTabs — the single tab strip that turns the four Meta-analytics pages (Reports · Scale & Insights ·
 * Leaderboard · Snapshots) into ONE surface. They used to be four separate rail items ("too many things
 * in the Work tab"); now Reports is the home and the rest are tabs here. One import, dropped at the top
 * of each page. Pages stay independent routes — this is pure navigation, nothing deleted.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/reports', label: 'Reports' },
  { href: '/insights', label: 'Scale & Insights' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/snapshots', label: 'Snapshots' },
]

export default function AdsTabs() {
  const pathname = usePathname()
  return (
    <div data-tour="ads-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid #efece2', paddingBottom: 2 }}>
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        return (
          <Link key={t.href} href={t.href} style={{
            padding: '8px 14px', borderRadius: '10px 10px 0 0', fontSize: 13.5, fontWeight: 750, textDecoration: 'none', fontFamily: 'inherit',
            color: active ? '#141d15' : '#7a9a7a',
            background: active ? '#eef6e4' : 'transparent',
            borderBottom: active ? '2px solid #ef4a1e' : '2px solid transparent',
            marginBottom: -2,
          }}>{t.label}</Link>
        )
      })}
    </div>
  )
}
