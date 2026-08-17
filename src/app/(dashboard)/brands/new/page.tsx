'use client'
/**
 * New-brand onboarding — the "add a project" flow (Phase 3). Reached from the rail's ProjectSwitcher
 * ("+ New brand"). Walks a second brand through the SAME setup the first one got, so it isn't a hollow
 * shell in the brief:
 *   1) Name it            → POST /api/brands (name, site, physical/service); plan-cap aware.
 *   2) Watch its rivals   → AddCompetitors, scoped to THIS brand_id (each rival watched for this brand).
 *   3) Connect its ads    → link a Meta ad account to this brand (or connect one / skip).
 * On finish it makes the new brand the ACTIVE project (sf_brand cookie) and lands on its brief.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

const AddCompetitors = dynamic(() => import('@/components/AddCompetitors'), { ssr: false })

const INK = '#141d15', SUB = '#6b776b', LINE = '#e2e8dd', FOREST = '#141d15', LIME = '#ff5a2c'
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 22, boxShadow: '0 1px 2px rgba(20,29,21,0.04)' }
const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: '#fbfcfa', color: INK }
const primary: React.CSSProperties = { padding: '10px 18px', borderRadius: 100, border: 'none', background: '#ef4a1e', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }
const ghost: React.CSSProperties = { padding: '10px 16px', borderRadius: 100, border: `1px solid ${LINE}`, background: '#fff', color: SUB, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }

type Acct = { account_id: string; account_name: string | null; currency: string | null; brand_id: string | null }

export default function NewBrandPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [form, setForm] = useState({ name: '', website: '', category: 'physical' })
  const [brandId, setBrandId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showComp, setShowComp] = useState(false)
  const [accts, setAccts] = useState<Acct[] | null>(null)
  const [linking, setLinking] = useState('')

  // Step 3: pull the founder's Meta ad accounts so they can attach one to this brand.
  useEffect(() => {
    if (step !== 3) return
    fetch('/api/meta/accounts').then(r => r.ok ? r.json() : null)
      .then(j => setAccts(Array.isArray(j?.accounts) ? j.accounts : []))
      .catch(() => setAccts([]))
  }, [step])

  const createBrand = async () => {
    if (!form.name.trim()) { setErr('Give your brand a name.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/brands', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), website: form.website.trim() || null, brand_type: form.category, brand_kit: { category: form.category } }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 402) { setErr(j?.message || 'Your plan’s brand limit is reached — upgrade to add another.'); setBusy(false); return }
      if (!r.ok || !j?.brand?.id) { setErr(j?.error || 'Couldn’t create the brand — try again.'); setBusy(false); return }
      setBrandId(String(j.brand.id)); setStep(2)
    } catch { setErr('Something went wrong.') }
    setBusy(false)
  }

  const linkAccount = async (account_id: string) => {
    if (!brandId) return
    setLinking(account_id)
    await fetch('/api/meta/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id, brand_id: brandId }) }).catch(() => {})
    setAccts(prev => (prev || []).map(a => a.account_id === account_id ? { ...a, brand_id: brandId } : (a.brand_id === brandId ? { ...a, brand_id: null } : a)))
    setLinking('')
  }

  // Make the new brand the active project everywhere, then land on its brief.
  const finish = () => {
    if (brandId) document.cookie = `${BRAND_COOKIE}=${encodeURIComponent(brandId)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    window.location.href = '/brief'
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        {[1, 2, 3].map(n => (
          <div key={n} style={{ height: 4, flex: 1, borderRadius: 4, background: step >= n ? FOREST : '#efece2' }} />
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: SUB, letterSpacing: '.04em', marginBottom: 18 }}>Step {step} of 3</div>

      {step === 1 && (
        <div style={card}>
          <h1 style={{ fontFamily: 'Georgia,serif', fontSize: 25, color: INK, margin: '0 0 4px' }}>Add a new brand</h1>
          <p style={{ fontSize: 14, color: SUB, margin: '0 0 20px' }}>A new project Mello runs alongside your others — its own competitors, ads, inbox and brief, one login.</p>

          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>Brand name</label>
          <input style={{ ...input, margin: '6px 0 14px' }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Mars Men" autoFocus />

          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>Website <span style={{ color: SUB, fontWeight: 500 }}>(optional — helps Mello learn the brand)</span></label>
          <input style={{ ...input, margin: '6px 0 14px' }} value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://…" />

          <label style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>What is it?</label>
          <div style={{ display: 'flex', gap: 8, margin: '8px 0 6px', flexWrap: 'wrap' }}>
            {[{ k: 'physical', l: '🧴 Physical product', d: 'Something you ship' }, { k: 'app', l: '📱 App / website', d: 'Software or SaaS' }, { k: 'service', l: '🛠️ A service', d: 'You do it for people' }].map(o => (
              <button key={o.k} onClick={() => setForm(f => ({ ...f, category: o.k }))}
                style={{ flex: '1 1 150px', textAlign: 'left', border: `1.5px solid ${form.category === o.k ? '#cfe6b8' : LINE}`, background: form.category === o.k ? '#f6fbef' : '#fff', borderRadius: 12, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{o.l}</div>
                <div style={{ fontSize: 12, color: SUB }}>{o.d}</div>
              </button>
            ))}
          </div>

          {err && <div style={{ color: '#b4232a', fontSize: 13, margin: '10px 0 0' }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button style={ghost} onClick={() => router.push('/brief')}>Cancel</button>
            <button style={{ ...primary, opacity: busy ? 0.6 : 1 }} onClick={createBrand} disabled={busy}>{busy ? 'Creating…' : 'Continue →'}</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          <h1 style={{ fontFamily: 'Georgia,serif', fontSize: 23, color: INK, margin: '0 0 4px' }}>Who does {form.name.trim() || 'this brand'} compete with?</h1>
          <p style={{ fontSize: 14, color: SUB, margin: '0 0 18px' }}>Mello watches these rivals for <b>{form.name.trim() || 'this brand'}</b> — their new ads, offers and winners fill this brand’s brief. Add a few (you can always add more later).</p>
          <button style={primary} onClick={() => setShowComp(true)}>+ Add competitors</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 22 }}>
            <button style={ghost} onClick={() => setStep(3)}>Skip for now</button>
            <button style={primary} onClick={() => setStep(3)}>Continue →</button>
          </div>
          {showComp && brandId && (
            <AddCompetitors brandId={brandId} brandName={form.name.trim() || 'this brand'} website={form.website.trim() || null} industry={null}
              onClose={() => setShowComp(false)} onDone={() => setShowComp(false)} />
          )}
        </div>
      )}

      {step === 3 && (
        <div style={card}>
          <h1 style={{ fontFamily: 'Georgia,serif', fontSize: 23, color: INK, margin: '0 0 4px' }}>Connect {form.name.trim() || 'this brand'}’s ads</h1>
          <p style={{ fontSize: 14, color: SUB, margin: '0 0 18px' }}>Link the Meta ad account that runs <b>{form.name.trim() || 'this brand'}</b> so its campaigns, ROAS and “what to make next” show up for this project. Optional — you can do it later from the brief.</p>

          {accts === null ? (
            <div style={{ fontSize: 13.5, color: SUB }}>Loading your ad accounts…</div>
          ) : accts.length === 0 ? (
            <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, color: SUB, marginBottom: 10 }}>No Meta ad account connected yet.</div>
              <a href="/connect/meta" style={{ ...primary, textDecoration: 'none' }}>Connect Meta</a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {accts.map(a => {
                const mine = a.brand_id === brandId
                return (
                  <div key={a.account_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: `1px solid ${mine ? '#cfe6b8' : LINE}`, background: mine ? '#f6fbef' : '#fff', borderRadius: 12, padding: '11px 13px' }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{a.account_name || a.account_id}</div>
                      <div style={{ fontSize: 12, color: SUB }}>{a.currency || ''} {a.brand_id && !mine ? '· linked to another brand' : ''}</div>
                    </div>
                    <button onClick={() => linkAccount(a.account_id)} disabled={linking === a.account_id}
                      style={mine ? { ...ghost, color: '#3b6d11', borderColor: '#cfe6b8' } : { ...primary, padding: '7px 14px', fontSize: 13 }}>
                      {linking === a.account_id ? '…' : mine ? '✓ Linked' : 'Link'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 22 }}>
            <button style={ghost} onClick={() => setStep(2)}>← Back</button>
            <button style={primary} onClick={finish}>Open {form.name.trim() || 'brand'}’s brief →</button>
          </div>
        </div>
      )}
    </div>
  )
}
