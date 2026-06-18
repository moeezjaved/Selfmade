'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setLoading(false)
    if (res.ok) {
      router.push('/admin')
    } else {
      setError('Invalid password')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#141414', padding: '48px', borderRadius: '16px', width: '380px', border: '1px solid #222' }}>
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', letterSpacing: '0.15em', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>Selfmade</div>
          <h1 style={{ color: '#fff', fontSize: '26px', fontWeight: '700', margin: 0 }}>Admin Dashboard</h1>
        </div>
        <form onSubmit={login}>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%', padding: '12px 14px', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '12px' }}
            autoFocus
          />
          {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', margin: '0 0 12px' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            style={{ width: '100%', padding: '12px', background: loading ? '#333' : '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', marginTop: error ? '0' : '0' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
