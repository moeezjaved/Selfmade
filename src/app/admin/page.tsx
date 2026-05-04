'use client'
import { useEffect, useState } from 'react'

interface Stats { totalUsers: number; newToday: number; payingUsers: number; trialUsers: number; mrr: number }

function KPI({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', border: '1px solid #e8e8e8' }}>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{label}</div>
      <div style={{ fontSize: '32px', fontWeight: '700', color: '#111', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: '#aaa', marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/admin/stats').then(r => r.json()).then(setStats)
  }, [])

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111', margin: '0 0 6px' }}>Dashboard</h1>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 28px' }}>Overview of your platform</p>

      {!stats ? (
        <div style={{ color: '#aaa', fontSize: '14px' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
          <KPI label="Total Users" value={stats.totalUsers.toLocaleString()} />
          <KPI label="New Today" value={stats.newToday.toLocaleString()} />
          <KPI label="On Trial" value={stats.trialUsers.toLocaleString()} sub="7-day free trial" />
          <KPI label="Paying Users" value={stats.payingUsers.toLocaleString()} sub="active paid subscriptions" />
          <KPI label="MRR" value={`$${stats.mrr.toLocaleString()}`} sub="paid users × $49" />
        </div>
      )}
    </div>
  )
}
