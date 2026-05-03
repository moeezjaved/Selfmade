'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ErrorLog {
  id: string; user_id: string | null; user_email: string | null;
  error_message: string; error_stack: string | null;
  page_url: string | null; created_at: string;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/admin/errors')
      .then(r => r.json())
      .then(d => { setErrors(d.errors || []); setLoading(false) })
  }, [])

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111', margin: '0 0 6px' }}>Error Logs</h1>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px' }}>{errors.length} errors recorded</p>

      {loading ? (
        <div style={{ color: '#aaa', fontSize: '14px' }}>Loading…</div>
      ) : errors.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', padding: '48px', textAlign: 'center', color: '#aaa', fontSize: '14px' }}>
          No errors recorded yet 🎉
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {errors.map(err => (
            <div key={err.id} style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
              <div
                onClick={() => setExpanded(expanded === err.id ? null : err.id)}
                style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '12px' }}
              >
                <span style={{ fontSize: '14px', marginTop: '1px' }}>⚠</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#dc2626', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {err.error_message}
                  </div>
                  <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {err.user_email ? (
                      <button
                        onClick={e => { e.stopPropagation(); if (err.user_id) router.push(`/admin/users/${err.user_id}`) }}
                        style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: '11px' }}
                      >
                        👤 {err.user_email}
                      </button>
                    ) : <span>Anonymous</span>}
                    {err.page_url && <span>📍 {err.page_url}</span>}
                    <span>🕐 {fmt(err.created_at)}</span>
                  </div>
                </div>
                <span style={{ fontSize: '12px', color: '#aaa', flexShrink: 0 }}>{expanded === err.id ? '▲' : '▼'}</span>
              </div>

              {expanded === err.id && err.error_stack && (
                <div style={{ padding: '0 18px 16px', borderTop: '1px solid #f5f5f5' }}>
                  <pre style={{ margin: '12px 0 0', padding: '12px', background: '#1e1e1e', color: '#e5e7eb', borderRadius: '8px', fontSize: '11px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {err.error_stack}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
