'use client'
/** Friendly popup shown when someone tries to sign up with a personal email (form or Google). */
export default function BusinessEmailModal({ email, onClose }: { email?: string; onClose: () => void }) {
  const INK = '#0e1b12', LIME = '#dffe95'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,18,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, boxShadow: '0 24px 70px rgba(14,27,18,0.28)', padding: '32px 30px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28 }}>🏢</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 8px', letterSpacing: '-.01em' }}>Use your work email</h2>
        <p style={{ fontSize: 14.5, color: '#4b5563', lineHeight: 1.6, margin: '0 0 6px' }}>
          Selfmade is built for teams, so we only accept <b>company (business) email addresses</b>.
        </p>
        {email && <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 4px' }}>{email} looks like a personal account.</p>}
        <p style={{ fontSize: 13, color: '#6b7280', margin: '10px 0 22px' }}>Personal inboxes like Gmail, Yahoo, Outlook or iCloud aren’t supported.</p>
        <button onClick={onClose} style={{ width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          Use my work email instead
        </button>
      </div>
    </div>
  )
}
