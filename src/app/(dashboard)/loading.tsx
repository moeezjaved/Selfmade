/**
 * Dashboard route-group loading UI. Shown while a segment's server payload streams — so a slow /
 * cold-starting route shows a calm branded wait instead of the old full-bleed dark-green flash
 * (which clashed with the light app and read as "broken"). Light ground + a small Mello mark that
 * breathes. Pairs with error.tsx: this while loading, retry UI if it fails.
 */
export default function DashboardLoading() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, background: '#f6f8f5',
    }}>
      <div className="selfmade-loading" style={{ width: 39, height: 39, borderRadius: 0, boxShadow: '0 12px 30px -12px rgba(239,74,30,.45)' }} />
      <div style={{ fontSize: 13, color: '#9aa79a', fontWeight: 650, fontFamily: "'Inter',-apple-system,sans-serif" }}>One moment…</div>
    </div>
  )
}
