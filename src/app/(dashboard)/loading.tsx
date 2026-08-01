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
      <div style={{ width: 46, height: 46, borderRadius: 13, background: '#17251c', display: 'grid', placeItems: 'center', boxShadow: '0 10px 30px -12px rgba(23,37,28,.35)', animation: 'sm-breathe 1.6s ease-in-out infinite' }}>
        <div className="selfmade-loading" style={{ width: 24, height: 24 }} />
      </div>
      <div style={{ fontSize: 13, color: '#9aa79a', fontWeight: 650, fontFamily: "'Inter',-apple-system,sans-serif" }}>One moment…</div>
      <style>{`@keyframes sm-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.94);opacity:.82}}`}</style>
    </div>
  )
}
