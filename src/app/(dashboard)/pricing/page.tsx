'use client'
import PricingSection from '@/components/pricing/PricingSection'

export default function PricingPage() {
  return (
    <div style={{ padding: 28 }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#111', margin: 0 }}>Plans & Pricing</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 6 }}>Everything — Discovery, Brand Spy, Patterns, AI creation, Launch, Analytics — in one place.</p>
      </div>
      <PricingSection variant="dashboard" />
    </div>
  )
}
