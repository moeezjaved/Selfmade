'use client'

// Contact is a public marketing page, but the in-app "Support & Feedback" link lands users here — and
// they had no way back (the logo goes to the marketing "/", which bounces logged-in users to login).
// This Back control returns them to wherever they came from, falling back to the dashboard.
export default function BackLink() {
  const goBack = () => {
    if (typeof window === 'undefined') return
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/dashboard'
  }
  return (
    <button
      onClick={goBack}
      aria-label="Go back"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#0e1b12', fontSize: 14, fontWeight: 700, padding: 0 }}
    >
      <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>←</span> Back
    </button>
  )
}
