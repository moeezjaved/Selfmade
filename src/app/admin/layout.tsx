'use client'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: '◈' },
  { href: '/admin/users', label: 'Users', icon: '◉' },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: '💳' },
  { href: '/admin/creatives', label: 'Creatives', icon: '🎨' },
  { href: '/admin/inspirations', label: 'Inspirations', icon: '✨' },
  { href: '/admin/payments', label: 'Payments', icon: '◎' },
  { href: '/admin/credit-pricing', label: 'Credit Pricing', icon: '◆' },
  { href: '/admin/experts', label: 'Experts', icon: '⭐' },
  { href: '/admin/blog', label: 'Blog', icon: '✍️' },
  { href: '/admin/mcp', label: 'MCP Server', icon: '🔌' },
  { href: '/admin/brand-directory', label: 'Brand Directory', icon: '📇' },
  { href: '/admin/funnel', label: 'Funnel', icon: '▽' },
  { href: '/admin/errors', label: 'Error Logs', icon: '⚠' },
  { href: '/admin/invite-codes', label: 'Invite Codes', icon: '🎟' },
  { href: '/admin/indexer', label: 'Ad Indexer', icon: '🕷️' },
  { href: '/admin/brands', label: 'Brands', icon: '🏷️' },
  { href: '/admin/seo', label: 'SEO', icon: '🔍' },
  { href: '/admin/countries', label: 'Countries', icon: '🌍' },
  { href: '/admin/seeds', label: 'Seeds', icon: '🌱' },
  { href: '/admin/workers', label: 'Workers', icon: '⚙️' },
  { href: '/admin/health', label: 'System Health', icon: '🏥' },
  { href: '/admin/tokens', label: 'Token Pool', icon: '🔑' },
  { href: '/admin/proxy-pool', label: 'Proxy Pool', icon: '🔀' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  if (pathname === '/admin/login') return <>{children}</>

  const logout = async () => {
    await fetch('/api/admin/auth', { method: 'DELETE' })
    router.push('/admin/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f5f5f5' }}>
      {/* Sidebar */}
      <aside style={{ width: '220px', background: '#0f0f0f', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'fixed', top: 0, left: 0, bottom: 0 }}>
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid #1e1e1e' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.12em', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>Selfmade</div>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>Admin</div>
        </div>
        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px' }}>
          {NAV.map(item => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 12px', borderRadius: '7px', marginBottom: '2px',
                  background: active ? '#1e1e1e' : 'transparent',
                  color: active ? '#fff' : '#777',
                  fontSize: '13px', fontWeight: active ? '600' : '400',
                  textDecoration: 'none', transition: 'all 0.1s',
                  borderLeft: active ? '2px solid #2563eb' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: '12px' }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div style={{ padding: '16px 12px', borderTop: '1px solid #1e1e1e' }}>
          <button
            onClick={logout}
            style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '7px', color: '#555', fontSize: '12px', cursor: 'pointer', textAlign: 'left' }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, marginLeft: '220px', padding: '32px 36px', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  )
}
