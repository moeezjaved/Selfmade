'use client'
/** Friendly popup shown when someone tries to sign up with a disposable/throwaway email (form or Google). */
export default function BusinessEmailModal({ email, onClose }: { email?: string; onClose: () => void }) {
  const INK = '#0e1b12', LIME = '#ff5a2c'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,18,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, boxShadow: '0 24px 70px rgba(14,27,18,0.28)', padding: '32px 30px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28 }}>📮</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111', margin: '0 0 8px', letterSpacing: '-.01em' }}>Use a permanent email</h2>
        <p style={{ fontSize: 14.5, color: '#4b5563', lineHeight: 1.6, margin: '0 0 6px' }}>
          That looks like a <b>temporary/disposable inbox</b>. Please sign up with an email you’ll keep — Gmail, Outlook, or your work address are all fine.
        </p>
        {email && <p style={{ fontSize: 13, color: '#9ca3af', margin: '6px 0 4px' }}>{email}</p>}
        <button onClick={onClose} style={{ width: '100%', background: LIME, color: INK, border: 'none', borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 16 }}>
          Use a different email
        </button>
      </div>
    </div>
  )
}
