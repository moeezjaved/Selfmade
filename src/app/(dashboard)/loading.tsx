/**
 * Dashboard route-group loading UI. Shown while a segment's server payload streams — so a slow /
 * cold-starting route (the 3–7s cold render the test report measured) shows a branded spinner
 * instead of a blank green screen during the wait. Pairs with error.tsx: spinner while loading,
 * retry UI if it fails.
 */
export default function DashboardLoading() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1a3a1a',
    }}>
      <div className="selfmade-loading" />
    </div>
  )
}
