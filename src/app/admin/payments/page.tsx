'use client'
import { useEffect, useState } from 'react'

interface Invoice {
  id: string; amount: number; currency: string; status: string | null;
  customer_email: string; created: string; hosted_invoice_url: string;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function PaymentsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/payments')
      .then(r => r.json())
      .then(d => { setInvoices(d.invoices || []); setTotalRevenue(d.totalRevenue || 0); setLoading(false) })
  }, [])

  const paid = invoices.filter(i => i.status === 'paid')
  const failed = invoices.filter(i => i.status === 'failed')

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111', margin: '0 0 6px' }}>Payments</h1>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px' }}>{invoices.length} total transactions</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: 'Successful Payments', value: paid.length },
          { label: 'Failed / Pending', value: failed.length },
        ].map(card => (
          <div key={card.label} style={{ background: '#fff', borderRadius: '12px', padding: '22px 24px', border: '1px solid #e8e8e8' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>{card.label}</div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#111' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
              {['Customer', 'Amount', 'Status', 'Date', 'Invoice'].map(h => (
                <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontWeight: '600', color: '#888', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#aaa' }}>Loading…</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#aaa' }}>No payments yet</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '12px 16px', color: '#444' }}>{inv.customer_email || '—'}</td>
                <td style={{ padding: '12px 16px', fontWeight: '600', color: '#111' }}>
                  {inv.currency} {inv.amount.toFixed(2)}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600', background: inv.status === 'paid' ? '#dcfce7' : '#fef2f2', color: inv.status === 'paid' ? '#16a34a' : '#dc2626' }}>
                    {inv.status === 'paid' ? 'Success' : 'Failed'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', color: '#777' }}>{fmt(inv.created)}</td>
                <td style={{ padding: '12px 16px' }}>
                  {inv.hosted_invoice_url ? (
                    <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: '12px', textDecoration: 'none' }}>View →</a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
