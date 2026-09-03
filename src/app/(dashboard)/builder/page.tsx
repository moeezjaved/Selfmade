'use client'
/**
 * Page Builder wizard (Atlas-style). A single self-contained client component that walks the merchant
 * through Template → Product → Research → Persona+Angle → Build → Preview → Publish. It only talks to
 * the /api/builder/* endpoints via fetch (another dev owns those routes); nothing here imports server
 * lib. Visual language matches HqRunable / Reports: cream/white cards, ink text, orange accent (#e02f06),
 * rounded pills, inline styles + one <style jsx> tag for the bits inline styles can't express.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

/* ── theme tokens (shared with HqRunable / Reports) ── */
const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a'
const LINE = 'rgba(20,18,15,.10)', LINE2 = 'rgba(20,18,15,.05)'
const ORANGE = '#e02f06', WASH = '#fdeee9', INSET = '#f7f6f4', GOOD = '#12a150'
const SERIF = '"Hedvig Letters Serif", Georgia, "Times New Roman", serif'

/* ── types mirroring the API contract ── */
type Template = { id: string; type: string; name: string; description: string; thumbnail?: string }
type Product = { id: string; title: string; handle?: string; price?: string; image?: string; sku?: string }
type Angle = { id: string; title: string; promise: string }
type Persona = { id: string; name: string; description: string; angles: Angle[]; custom?: boolean }

type Step = 'list' | 1 | 2 | 3 | 4 | 'building' | 'preview' | 'published' | 'edit'
type SavedPage = { id: string; type: string; template_id: string; product_name: string; status: string; shopify_url?: string; created_at: string }
type StoreTheme = { id: number; name: string; role: string; live: boolean }
type EditSlot = { key: string; type: string; label: string; hint?: string }
// which string fields are editable inside each array-slot item
const ITEM_FIELDS: Record<string, { field: string; label: string; area?: boolean }[]> = {
  list: [{ field: 'label', label: 'Label' }, { field: 'body', label: 'Detail' }],
  costs: [{ field: 'label', label: 'Where' }, { field: 'body', label: 'Cost' }],
  timeline: [{ field: 'label', label: 'When' }, { field: 'body', label: 'What changed', area: true }],
  reasons: [{ field: 'label', label: 'Tag' }, { field: 'title', label: 'Heading' }, { field: 'body', label: 'Body', area: true }],
  testimonials: [{ field: 'name', label: 'Name' }, { field: 'city', label: 'City' }, { field: 'quote', label: 'Quote', area: true }],
  faq: [{ field: 'q', label: 'Question' }, { field: 'a', label: 'Answer', area: true }],
}

const STEP_LABELS = ['Template', 'Product', 'Research', 'Persona & angle']

const CARD: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
  boxShadow: '0 1px 2px rgba(20,18,15,.05)',
}

const cardTitle: React.CSSProperties = { fontFamily: SERIF, fontWeight: 400, fontSize: 27, letterSpacing: '-.015em', margin: 0, color: INK }
const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: ORANGE }
const editInput: React.CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: INK, outline: 'none', fontFamily: 'inherit', background: '#fff' }
const editArea: React.CSSProperties = { ...editInput, resize: 'vertical', lineHeight: 1.5 }

/* ── small inline error + retry strip ── */
function ErrorStrip({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fdecec', border: '1px solid #f6cccc', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: '#9a2b2b', marginTop: 14 }}>
      <span>{msg}</span>
      {onRetry && <button onClick={onRetry} style={{ border: '1px solid #d98c8c', background: '#fff', color: '#9a2b2b', borderRadius: 999, padding: '5px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Retry</button>}
    </div>
  )
}

/* ── gradient fallback for a thumbnail that 404s ── */
const GRADS = [
  'linear-gradient(135deg,#ffd9c9,#ff8a5c)',
  'linear-gradient(135deg,#d7e8ff,#8ab6ff)',
  'linear-gradient(135deg,#e6dcff,#b59bff)',
  'linear-gradient(135deg,#d8f3e0,#7ed6a0)',
]
function Thumb({ src, seed, label, height = 132 }: { src?: string; seed: number; label?: string; height?: number }) {
  const [broken, setBroken] = useState(false)
  const grad = GRADS[seed % GRADS.length]
  if (!src || broken) {
    return (
      <div style={{ height, borderRadius: 12, background: grad, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.9)', fontFamily: SERIF, fontSize: 20, letterSpacing: '-.01em' }}>
        {label || ''}
      </div>
    )
  }
  return <img src={src} alt={label || ''} onError={() => setBroken(true)} style={{ display: 'block', width: '100%', height, objectFit: 'cover', borderRadius: 12 }} />
}

export default function BuilderPage() {
  const [step, setStep] = useState<Step>('list')

  /* ── landing: the user's already-generated pages ── */
  const [pages, setPages] = useState<SavedPage[] | null>(null)
  const loadPages = useCallback(async () => {
    try { const r = await fetch('/api/builder/drafts'); const j = await r.json(); setPages(j.pages || []) }
    catch { setPages([]) }
  }, [])
  useEffect(() => { loadPages() }, [loadPages])

  // load Hedvig serif once (same as HqRunable)
  useEffect(() => {
    if (document.getElementById('hedvig-font')) return
    const l = document.createElement('link'); l.id = 'hedvig-font'; l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Hedvig+Letters+Serif:opsz@12..24&display=swap'
    document.head.appendChild(l)
  }, [])

  /* ── step 1: templates ── */
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [tplErr, setTplErr] = useState('')
  const [tplId, setTplId] = useState<string | null>(null)
  const loadTemplates = useCallback(async () => {
    setTplErr(''); setTemplates(null)
    try {
      const r = await fetch('/api/builder/templates')
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not load templates')
      setTemplates(j.templates || [])
    } catch (e: any) { setTplErr(e?.message || 'Could not load templates') }
  }, [])
  useEffect(() => { loadTemplates() }, [loadTemplates])

  /* ── step 2: products ── */
  const [q, setQ] = useState('')
  const [products, setProducts] = useState<Product[] | null>(null)
  const [prodErr, setProdErr] = useState('')
  const [noStore, setNoStore] = useState(false)
  const [productId, setProductId] = useState<string | null>(null)
  const loadProducts = useCallback(async (query: string) => {
    setProdErr(''); setProducts(null)
    try {
      const r = await fetch(`/api/builder/products?q=${encodeURIComponent(query)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not load products')
      setNoStore(!!j.noStore)
      setProducts(j.products || [])
    } catch (e: any) { setProdErr(e?.message || 'Could not load products') }
  }, [])
  // debounce product search; only fetch once the user reaches step 2
  const prodLoaded = useRef(false)
  useEffect(() => {
    if (step !== 2) return
    const t = setTimeout(() => loadProducts(q), prodLoaded.current ? 300 : 0)
    prodLoaded.current = true
    return () => clearTimeout(t)
  }, [q, step, loadProducts])

  /* ── step 3: research ── */
  const [researchName, setResearchName] = useState('')
  const [researchText, setResearchText] = useState('')      // only for txt/md read client-side
  const [researchMode, setResearchMode] = useState<'close' | 'inspire'>('inspire')
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const onFile = useCallback((f: File | null) => {
    if (!f) return
    setResearchName(f.name)
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext === 'txt' || ext === 'md' || ext === 'csv') {
      const reader = new FileReader()
      reader.onload = () => setResearchText(String(reader.result || '').slice(0, 20000))
      reader.readAsText(f)
    } else {
      setResearchText('')   // pdf/docx can't be read client-side; pass only the toggle intent
    }
  }, [])
  const clearResearch = () => { setResearchName(''); setResearchText(''); if (fileRef.current) fileRef.current.value = '' }
  const researchPayload = () => {
    if (!researchName) return undefined
    return { name: researchName, mode: researchMode, text: researchText || undefined }
  }

  /* ── step 4: personas + angles ── */
  const [personas, setPersonas] = useState<Persona[] | null>(null)
  const [personaErr, setPersonaErr] = useState('')
  const [personaLoading, setPersonaLoading] = useState(false)
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [angleId, setAngleId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [customDesc, setCustomDesc] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const loadPersonas = useCallback(async () => {
    if (!productId) return
    setPersonaErr(''); setPersonaLoading(true); setPersonas(null); setPersonaId(null); setAngleId(null)
    try {
      const r = await fetch('/api/builder/personas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, research: researchPayload() }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not generate personas')
      setPersonas(j.personas || [])
    } catch (e: any) { setPersonaErr(e?.message || 'Could not generate personas') }
    finally { setPersonaLoading(false) }
  }, [productId])   // eslint-disable-line react-hooks/exhaustive-deps
  // generate personas on first entry to step 4 (not on every re-render)
  const personaFetchedFor = useRef<string | null>(null)
  useEffect(() => {
    if (step === 4 && productId && personaFetchedFor.current !== productId) {
      personaFetchedFor.current = productId
      loadPersonas()
    }
  }, [step, productId, loadPersonas])

  // the currently selected persona object (built-in or the custom one)
  const customPersona: Persona | null = customName.trim()
    ? { id: '__custom__', name: customName.trim(), description: customDesc.trim(), angles: [], custom: true }
    : null
  const selectedPersona: Persona | null = useMemo(() => {
    if (personaId === '__custom__') return customPersona
    return (personas || []).find((p) => p.id === personaId) || null
  }, [personaId, personas, customPersona])
  const selectedAngle: Angle | null = useMemo(
    () => (selectedPersona?.angles || []).find((a) => a.id === angleId) || null,
    [selectedPersona, angleId],
  )

  /* ── build → preview ── */
  const [buildErr, setBuildErr] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [pageId, setPageId] = useState('')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [stageIdx, setStageIdx] = useState(0)
  const STAGES = ['Reading your product…', 'Writing the copy…', 'Assembling the page…', 'Finalizing preview…']

  const runBuild = useCallback(async () => {
    if (!tplId || !productId || !selectedPersona) return
    setBuildErr(''); setStep('building'); setStageIdx(0)
    // cosmetic staged progress while the real request runs
    const timers: any[] = []
    STAGES.forEach((_, i) => { if (i > 0) timers.push(setTimeout(() => setStageIdx(i), i * 1400)) })
    try {
      const r = await fetch('/api/builder/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: tplId, productId,
          persona: selectedPersona, angle: selectedAngle,
          research: researchPayload(),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Build failed — please try again')
      setPageId(j.pageId || '')
      setPreviewHtml(j.previewHtml || '')
      setStageIdx(STAGES.length - 1)
      setStep('preview')
    } catch (e: any) {
      setBuildErr(e?.message || 'Build failed — please try again')
      setStep(4)
    } finally { timers.forEach(clearTimeout) }
  }, [tplId, productId, selectedPersona, selectedAngle])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── publish ── */
  const [publishing, setPublishing] = useState(false)
  const [publishErr, setPublishErr] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')       // ?preview_theme_id link when a draft theme is chosen
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3200) }

  /* ── theme picker (detected live from the connected store, Atlas-style) ── */
  const [themes, setThemes] = useState<StoreTheme[] | null>(null)
  const [themesLoading, setThemesLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [chosenTheme, setChosenTheme] = useState<number | null>(null)
  const openThemePicker = useCallback(async () => {
    setPickerOpen(true); setPublishErr('')
    if (themes) return
    setThemesLoading(true)
    try {
      const r = await fetch('/api/builder/themes'); const j = await r.json()
      const list: StoreTheme[] = j.themes || []
      setThemes(list)
      const live = list.find((t) => t.live) || list[0]
      if (live) setChosenTheme(live.id)
    } catch { setThemes([]) }
    finally { setThemesLoading(false) }
  }, [themes])

  /* ── reopen a saved page (re-rendered server-side) into the preview step ── */
  const [opening, setOpening] = useState<string | null>(null)
  const openDraft = useCallback(async (id: string) => {
    setOpening(id)
    try {
      const r = await fetch(`/api/builder/drafts?id=${encodeURIComponent(id)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not open')
      setPageId(j.pageId || id)
      setPreviewHtml(j.previewHtml || '')
      setPublishedUrl(j.shopifyUrl || '')
      setPublishErr('')
      setStep('preview')
    } catch { setToast('Could not open that page.'); setTimeout(() => setToast(''), 3200) }
    finally { setOpening(null) }
  }, [])

  /* ── inline copy editor for a saved page ── */
  const [editSchema, setEditSchema] = useState<EditSlot[] | null>(null)
  const [editContent, setEditContent] = useState<Record<string, any>>({})
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving] = useState(false)
  const editDraft = useCallback(async (id: string) => {
    setOpening(id); setEditErr('')
    try {
      const r = await fetch(`/api/builder/drafts?id=${encodeURIComponent(id)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not open')
      setPageId(j.pageId || id)
      setEditSchema(j.schema || [])
      setEditContent(j.content || {})
      setPublishedUrl(j.shopifyUrl || '')
      setStep('edit')
    } catch { setToast('Could not open that page.'); setTimeout(() => setToast(''), 3200) }
    finally { setOpening(null) }
  }, [])
  const setField = (key: string, value: any) => setEditContent((c) => ({ ...c, [key]: value }))
  const setItemField = (key: string, idx: number, field: string, value: any) => setEditContent((c) => {
    const arr = Array.isArray(c[key]) ? [...c[key]] : []
    arr[idx] = { ...(arr[idx] || {}), [field]: value }
    return { ...c, [key]: arr }
  })
  const saveEdit = useCallback(async () => {
    if (!pageId) return
    setSaving(true); setEditErr('')
    try {
      const r = await fetch('/api/builder/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, content: editContent }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not save')
      setPreviewHtml(j.previewHtml || '')
      setPublishErr('')
      setStep('preview')
      loadPages()
    } catch (e: any) { setEditErr(e?.message || 'Could not save') }
    finally { setSaving(false) }
  }, [pageId, editContent, loadPages])

  /* ── reset all wizard state and start a brand-new page ── */
  const startNew = useCallback(() => {
    setStep(1); setTplId(null); setProductId(null); setQ(''); clearResearch()
    setPersonas(null); setPersonaId(null); setAngleId(null); setCustomName(''); setCustomDesc(''); setShowCustom(false)
    setPreviewHtml(''); setPageId(''); setPublishedUrl(''); setBuildErr(''); personaFetchedFor.current = null
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const publish = useCallback(async (themeId?: number | null) => {
    if (!pageId) return
    const theme = themes?.find((t) => t.id === themeId) || null
    setPublishing(true); setPublishErr('')
    try {
      const r = await fetch('/api/builder/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, themeId: themeId ?? undefined, themeLive: theme?.live ?? undefined }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Import failed — please try again')
      setPublishedUrl(j.url || '')
      setPreviewUrl(j.previewUrl || '')
      setPickerOpen(false)
      setStep('published')
    } catch (e: any) { setPublishErr(e?.message || 'Import failed — please try again') }
    finally { setPublishing(false) }
  }, [pageId, themes])

  /* ── step gating ── */
  const canNext = (
    step === 1 ? !!tplId :
    step === 2 ? !!productId :
    step === 3 ? true :          // research is optional
    false
  )
  const goNext = () => { if (step === 1) setStep(2); else if (step === 2) setStep(3); else if (step === 3) setStep(4) }
  const goBack = () => {
    if (step === 1) setStep('list')
    else if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
    else if (step === 4) setStep(3)
    else if (step === 'preview') setStep(4)
    else if (step === 'building') setStep(4)
  }

  const selectedTemplate = (templates || []).find((t) => t.id === tplId) || null
  const selectedProduct = (products || []).find((p) => p.id === productId) || null

  const stepNum = typeof step === 'number' ? step : (step === 'building' ? 4 : 4)

  /* ── render ── */
  return (
    <div style={{ background: '#fff', color: INK, minHeight: '100dvh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        .bld-radio { appearance:none; -webkit-appearance:none; width:18px; height:18px; border-radius:50%; border:1.5px solid ${LINE}; flex:none; display:grid; place-items:center; cursor:pointer; }
        .bld-radio:checked { border-color:${ORANGE}; }
        .bld-radio:checked::after { content:''; width:9px; height:9px; border-radius:50%; background:${ORANGE}; }
        .bld-card-btn { transition: box-shadow .12s, border-color .12s, transform .12s; }
        .bld-card-btn:hover { box-shadow: 0 2px 4px rgba(20,18,15,.06), 0 16px 40px -24px rgba(20,18,15,.4); }
      `}</style>

      {/* header + stepper */}
      <div style={{ borderBottom: `1px solid ${LINE2}`, padding: '18px 26px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={eyebrow}>Page Builder</div>
            <h1 style={{ ...cardTitle, fontSize: 26, marginTop: 3 }}>Build a landing page</h1>
          </div>
          {/* step indicator 1-2-3-4 */}
          {typeof step === 'number' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {STEP_LABELS.map((lbl, i) => {
                const n = i + 1
                const done = n < stepNum, cur = n === stepNum
                return (
                  <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: cur ? ORANGE : done ? WASH : INSET, color: cur ? '#fff' : done ? ORANGE : FAINT, border: `1px solid ${cur ? ORANGE : LINE}` }}>{done ? '✓' : n}</span>
                      <span style={{ fontSize: 12.5, fontWeight: cur ? 700 : 600, color: cur ? INK : FAINT }}>{lbl}</span>
                    </div>
                    {n < STEP_LABELS.length && <span style={{ width: 22, height: 1, background: LINE }} />}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* main: content + right-rail summary */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '26px', display: 'grid', gridTemplateColumns: (step === 'list' || step === 'preview' || step === 'published' || step === 'building' || step === 'edit') ? '1fr' : 'minmax(0,1fr) 300px', gap: 24, alignItems: 'start' }}>
        <section style={{ minWidth: 0 }}>
          {/* ── LANDING · YOUR PAGES ── */}
          {step === 'list' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={cardTitle}>Your pages</h2>
                  <p style={{ fontSize: 14, color: SUB, marginTop: 6 }}>Reopen a page to preview or publish it, or build a new one.</p>
                </div>
                <button onClick={startNew} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '11px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ New page</button>
              </div>

              {!pages && <div style={{ marginTop: 18 }}><SkeletonRows /></div>}
              {pages && pages.length === 0 && (
                <div style={{ ...CARD, padding: 34, textAlign: 'center', marginTop: 18 }}>
                  <div style={{ fontSize: 30, marginBottom: 10 }}>🗂️</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>No pages yet</div>
                  <div style={{ fontSize: 13, color: SUB, margin: '8px auto 16px', maxWidth: 380 }}>Build your first high-converting landing page — pick a template, a product, and go.</div>
                  <button onClick={startNew} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '11px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Build a page →</button>
                </div>
              )}
              {pages && pages.length > 0 && (
                <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pages.map((pg) => {
                    const badge = pg.status === 'published' ? { t: 'Published', c: GOOD, bg: '#e7f7ee' }
                      : pg.status === 'failed' ? { t: 'Failed', c: '#9a2b2b', bg: '#fdecec' }
                      : { t: 'Draft', c: SUB, bg: INSET }
                    return (
                      <div key={pg.id} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 14, padding: 14, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: 15, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                            {pg.product_name || 'Landing page'}
                            <span style={{ fontSize: 11, fontWeight: 800, color: badge.c, background: badge.bg, borderRadius: 20, padding: '2px 9px' }}>{badge.t}</span>
                          </div>
                          <div style={{ fontSize: 12, color: FAINT, marginTop: 3, textTransform: 'capitalize' }}>{pg.type} · {new Date(pg.created_at).toLocaleDateString()}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 9 }}>
                          {pg.status === 'published' && pg.shopify_url && (
                            <a href={pg.shopify_url} target="_blank" rel="noopener noreferrer" style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, textDecoration: 'none', borderRadius: 999, padding: '8px 16px', fontWeight: 600, fontSize: 13 }}>View →</a>
                          )}
                          <button onClick={() => editDraft(pg.id)} disabled={opening === pg.id} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: opening === pg.id ? 'default' : 'pointer' }}>Edit</button>
                          <button onClick={() => openDraft(pg.id)} disabled={opening === pg.id} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: opening === pg.id ? 'default' : 'pointer', opacity: opening === pg.id ? 0.6 : 1 }}>{opening === pg.id ? 'Opening…' : 'Open →'}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1 · TEMPLATE ── */}
          {step === 1 && (
            <div>
              <h2 style={cardTitle}>Pick a template</h2>
              <p style={{ fontSize: 14, color: SUB, marginTop: 6 }}>A hand-built, high-converting layout. Your copy and product images get swapped in.</p>
              {tplErr && <ErrorStrip msg={tplErr} onRetry={loadTemplates} />}
              {!templates && !tplErr && <SkeletonGrid />}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14, marginTop: 18 }}>
                {(templates || []).map((t, i) => {
                  const on = tplId === t.id
                  return (
                    <button key={t.id} className="bld-card-btn" onClick={() => setTplId(t.id)} style={{ ...CARD, textAlign: 'left', cursor: 'pointer', padding: 12, font: 'inherit', color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : CARD.boxShadow as string }}>
                      <Thumb src={t.thumbnail} seed={i} label={t.name} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{t.name}</span>
                        <input type="radio" className="bld-radio" checked={on} readOnly />
                      </div>
                      <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, lineHeight: 1.45 }}>{t.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── STEP 2 · PRODUCT ── */}
          {step === 2 && (
            <div>
              <h2 style={cardTitle}>Pick a product</h2>
              <p style={{ fontSize: 14, color: SUB, marginTop: 6 }}>The page is built around one product from your store.</p>
              {!noStore && (
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your products…" style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', fontSize: 14.5, color: INK, outline: 'none', marginTop: 16, fontFamily: 'inherit' }} />
              )}
              {prodErr && <ErrorStrip msg={prodErr} onRetry={() => loadProducts(q)} />}
              {noStore ? (
                <div style={{ ...CARD, padding: 28, textAlign: 'center', marginTop: 16 }}>
                  <div style={{ fontSize: 30, marginBottom: 10 }}>🔗</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Connect your Shopify store</div>
                  <div style={{ fontSize: 13, color: SUB, margin: '8px auto 16px', maxWidth: 360 }}>Link your store so the builder can pull your products, photos and prices into the page.</div>
                  <Link href="/connect/shopify" style={{ display: 'inline-block', background: ORANGE, color: '#fff', textDecoration: 'none', padding: '10px 22px', borderRadius: 999, fontSize: 14, fontWeight: 700 }}>Connect Shopify →</Link>
                </div>
              ) : (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {!products && !prodErr && <SkeletonRows />}
                  {products && products.length === 0 && (
                    <div style={{ fontSize: 13, color: SUB, padding: '20px 0', textAlign: 'center' }}>No products match “{q}”.</div>
                  )}
                  {(products || []).map((p, i) => {
                    const on = productId === p.id
                    return (
                      <button key={p.id} onClick={() => setProductId(p.id)} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', cursor: 'pointer', padding: 11, font: 'inherit', color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : CARD.boxShadow as string }}>
                        <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', flex: 'none' }}>
                          <Thumb src={p.image} seed={i} height={52} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                          <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>
                            {p.price ? p.price : ''}{p.price && p.sku ? ' · ' : ''}{p.sku ? `SKU ${p.sku}` : ''}
                          </div>
                        </div>
                        <input type="radio" className="bld-radio" checked={on} readOnly />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3 · RESEARCH ── */}
          {step === 3 && (
            <div>
              <h2 style={cardTitle}>Customer research <span style={{ fontSize: 15, color: FAINT }}>· optional</span></h2>
              <p style={{ fontSize: 14, color: SUB, marginTop: 6 }}>Drop in reviews, survey notes or a voice-of-customer doc to shape the copy. You can skip this.</p>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0] || null) }}
                onClick={() => fileRef.current?.click()}
                style={{ marginTop: 16, border: `1.5px dashed ${dragOver ? ORANGE : LINE}`, background: dragOver ? WASH : INSET, borderRadius: 16, padding: '30px 20px', textAlign: 'center', cursor: 'pointer', transition: 'background .12s, border-color .12s' }}
              >
                <input ref={fileRef} type="file" accept=".txt,.pdf,.md,.docx,.csv" onChange={(e) => onFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                {researchName ? (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
                    <div style={{ fontSize: 14, fontWeight: 650 }}>{researchName}</div>
                    <button onClick={(e) => { e.stopPropagation(); clearResearch() }} style={{ marginTop: 10, border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 999, padding: '5px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>⬆️</div>
                    <div style={{ fontSize: 14, fontWeight: 650 }}>Drop a file or click to upload</div>
                    <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>txt, pdf, md, docx or csv</div>
                  </div>
                )}
              </div>

              {researchName && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 8 }}>How should we use it?</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {([['close', 'Stick closely', 'Use the exact language and claims'], ['inspire', 'Use as inspiration', 'Take the themes, write fresh copy']] as const).map(([v, l, d]) => {
                      const on = researchMode === v
                      return (
                        <button key={v} onClick={() => setResearchMode(v)} style={{ textAlign: 'left', border: `1px solid ${on ? ORANGE : LINE}`, background: on ? WASH : '#fff', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', color: INK }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: on ? ORANGE : INK }}>{l}</div>
                          <div style={{ fontSize: 12, color: SUB, marginTop: 3, lineHeight: 1.4 }}>{d}</div>
                        </button>
                      )
                    })}
                  </div>
                  {!researchText && /\.(pdf|docx)$/i.test(researchName) && (
                    <div style={{ fontSize: 11.5, color: FAINT, marginTop: 8 }}>We&rsquo;ll read this file server-side during the build.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4 · PERSONA + ANGLE ── */}
          {step === 4 && (
            <div>
              <h2 style={cardTitle}>Who are we talking to?</h2>
              <p style={{ fontSize: 14, color: SUB, marginTop: 6 }}>Pick the customer this page speaks to, then the angle it leads with.</p>
              {buildErr && <ErrorStrip msg={buildErr} onRetry={runBuild} />}
              {personaErr && <ErrorStrip msg={personaErr} onRetry={loadPersonas} />}

              {personaLoading && (
                <div style={{ ...CARD, padding: 30, textAlign: 'center', marginTop: 18 }}>
                  <div className="bld-spin" style={{ width: 34, height: 34, borderRadius: '50%', border: `3px solid ${WASH}`, borderTopColor: ORANGE, margin: '0 auto 14px', animation: 'bldspin 1s linear infinite' }} />
                  <div style={{ fontSize: 14, fontWeight: 650 }}>Generating personas…</div>
                  <div style={{ fontSize: 12.5, color: FAINT, marginTop: 4 }}>Reading your product and brand voice.</div>
                  <style>{`@keyframes bldspin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}

              {!personaLoading && (personas || personaId === '__custom__') && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginTop: 18 }}>
                    {(personas || []).map((p) => {
                      const on = personaId === p.id
                      return (
                        <button key={p.id} onClick={() => { setPersonaId(p.id); setAngleId(null); setShowCustom(false) }} style={{ ...CARD, textAlign: 'left', cursor: 'pointer', padding: 14, color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : CARD.boxShadow as string }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name}</span>
                            <input type="radio" className="bld-radio" checked={on} readOnly />
                          </div>
                          <div style={{ fontSize: 12.5, color: SUB, marginTop: 5, lineHeight: 1.5 }}>{p.description}</div>
                        </button>
                      )
                    })}

                    {/* add your own */}
                    <button onClick={() => { setShowCustom(true); setPersonaId('__custom__'); setAngleId(null) }} style={{ ...CARD, textAlign: 'left', cursor: 'pointer', padding: 14, color: INK, borderStyle: 'dashed', borderColor: personaId === '__custom__' ? ORANGE : LINE, boxShadow: personaId === '__custom__' ? `0 0 0 2px ${ORANGE}` : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: personaId === '__custom__' ? ORANGE : INK }}>+ Add your own</span>
                        <input type="radio" className="bld-radio" checked={personaId === '__custom__'} readOnly />
                      </div>
                      <div style={{ fontSize: 12.5, color: SUB, marginTop: 5, lineHeight: 1.5 }}>Describe the customer in your own words.</div>
                    </button>
                  </div>

                  {/* custom persona free-text */}
                  {showCustom && personaId === '__custom__' && (
                    <div style={{ ...CARD, padding: 14, marginTop: 12 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 7 }}>Your customer</div>
                      <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Busy new parents who value convenience" style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: INK, outline: 'none', fontFamily: 'inherit' }} />
                      <textarea value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} placeholder="What do they care about? What problem are they trying to solve? (optional)" rows={3} style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: INK, outline: 'none', resize: 'vertical', fontFamily: 'inherit', marginTop: 8 }} />
                    </div>
                  )}

                  {/* angles for the chosen persona */}
                  {selectedPersona && (selectedPersona.angles?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <div style={{ ...eyebrow, marginBottom: 10 }}>Choose an angle</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
                        {selectedPersona.angles.map((a) => {
                          const on = angleId === a.id
                          return (
                            <button key={a.id} onClick={() => setAngleId(a.id)} style={{ ...CARD, textAlign: 'left', cursor: 'pointer', padding: 14, color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : CARD.boxShadow as string }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 14, fontWeight: 700 }}>{a.title}</span>
                                <input type="radio" className="bld-radio" checked={on} readOnly />
                              </div>
                              <div style={{ fontSize: 12.5, color: SUB, marginTop: 5, lineHeight: 1.5 }}>{a.promise}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {selectedPersona?.custom && (
                    <div style={{ fontSize: 12.5, color: FAINT, marginTop: 12 }}>We&rsquo;ll craft the angle for this custom persona during the build.</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── BUILDING ── */}
          {step === 'building' && (
            <div style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
              <div className="bld-spin" style={{ width: 44, height: 44, borderRadius: '50%', border: `4px solid ${WASH}`, borderTopColor: ORANGE, margin: '0 auto 22px', animation: 'bldspin 1s linear infinite' }} />
              <style>{`@keyframes bldspin{to{transform:rotate(360deg)}}`}</style>
              <h2 style={{ ...cardTitle, fontSize: 24 }}>Building your page</h2>
              <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', maxWidth: 340, marginInline: 'auto' }}>
                {STAGES.map((s, i) => {
                  const done = i < stageIdx, cur = i === stageIdx
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: done || cur ? 1 : 0.4 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: done ? GOOD : cur ? ORANGE : INSET, color: done || cur ? '#fff' : FAINT, flex: 'none' }}>{done ? '✓' : i + 1}</span>
                      <span style={{ fontSize: 14, fontWeight: cur ? 700 : 500, color: cur ? INK : SUB }}>{s}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── EDIT COPY ── */}
          {step === 'edit' && (
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <div>
                  <button onClick={() => { loadPages(); setStep('list') }} style={{ border: 'none', background: 'none', color: SUB, fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← My pages</button>
                  <div style={eyebrow}>Edit copy</div>
                  <h2 style={{ ...cardTitle, fontSize: 24, marginTop: 3 }}>Edit your page</h2>
                  <p style={{ fontSize: 13.5, color: SUB, marginTop: 5 }}>Change any wording, then save to preview and publish. Images stay as generated.</p>
                </div>
              </div>
              {editErr && <ErrorStrip msg={editErr} onRetry={saveEdit} />}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                {(editSchema || []).map((s) => {
                  const val = editContent[s.key]
                  const itemFields = ITEM_FIELDS[s.type]
                  return (
                    <div key={s.key} style={{ ...CARD, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{s.label}</div>
                      {s.hint && <div style={{ fontSize: 12, color: FAINT, marginTop: 2, lineHeight: 1.4 }}>{s.hint}</div>}

                      {/* array slots → edit each item's text fields */}
                      {itemFields ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                          {(Array.isArray(val) ? val : []).map((item: any, idx: number) => (
                            <div key={idx} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, background: INSET }}>
                              <div style={{ fontSize: 11, fontWeight: 800, color: FAINT, marginBottom: 8 }}>#{idx + 1}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {itemFields.map((f) => (
                                  f.area ? (
                                    <textarea key={f.field} value={String(item?.[f.field] ?? '')} onChange={(e) => setItemField(s.key, idx, f.field, e.target.value)} placeholder={f.label} rows={2} style={editArea} />
                                  ) : (
                                    <input key={f.field} value={String(item?.[f.field] ?? '')} onChange={(e) => setItemField(s.key, idx, f.field, e.target.value)} placeholder={f.label} style={editInput} />
                                  )
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : s.type === 'richtext' ? (
                        <textarea value={String(val ?? '')} onChange={(e) => setField(s.key, e.target.value)} rows={4} style={{ ...editArea, marginTop: 10 }} />
                      ) : s.type === 'number' ? (
                        <input type="number" value={String(val ?? '')} onChange={(e) => setField(s.key, e.target.value === '' ? '' : Number(e.target.value))} style={{ ...editInput, marginTop: 10, maxWidth: 160 }} />
                      ) : (
                        // text + image (image = the URL)
                        <input value={String(val ?? '')} onChange={(e) => setField(s.key, e.target.value)} placeholder={s.type === 'image' ? 'Image URL' : ''} style={{ ...editInput, marginTop: 10 }} />
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, position: 'sticky', bottom: 0, background: '#fff', paddingTop: 12, borderTop: `1px solid ${LINE2}` }}>
                <button onClick={() => { loadPages(); setStep('list') }} disabled={saving} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveEdit} disabled={saving} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save & preview →'}</button>
              </div>
            </div>
          )}

          {/* ── PREVIEW ── */}
          {step === 'preview' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                <div>
                  <button onClick={() => { loadPages(); setStep('list') }} style={{ border: 'none', background: 'none', color: SUB, fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← My pages</button>
                  <div style={eyebrow}>Preview</div>
                  <h2 style={{ ...cardTitle, fontSize: 24, marginTop: 3 }}>Your page is ready</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* device toggle */}
                  <div style={{ display: 'flex', background: INSET, border: `1px solid ${LINE}`, borderRadius: 999, padding: 4, gap: 3 }}>
                    {(['desktop', 'mobile'] as const).map((d) => (
                      <button key={d} onClick={() => setDevice(d)} style={{ border: 0, background: device === d ? '#fff' : 'transparent', color: device === d ? INK : SUB, fontWeight: device === d ? 700 : 600, fontSize: 13, padding: '7px 16px', borderRadius: 999, cursor: 'pointer', boxShadow: device === d ? `0 1px 2px rgba(20,18,15,.14)` : 'none', textTransform: 'capitalize' }}>{d}</button>
                    ))}
                  </div>
                  <button onClick={() => showToast('Saved as draft — you can reopen it any time.')} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '9px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Save as draft</button>
                  <button onClick={openThemePicker} disabled={publishing} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '9px 20px', fontWeight: 700, fontSize: 13.5, cursor: publishing ? 'default' : 'pointer', opacity: publishing ? 0.6 : 1 }}>Publish to Shopify →</button>
                </div>
              </div>
              {publishErr && <ErrorStrip msg={publishErr} onRetry={publish} />}
              {/* iframe preview */}
              <div style={{ background: INSET, border: `1px solid ${LINE}`, borderRadius: 16, padding: device === 'mobile' ? '20px 0' : 12, display: 'flex', justifyContent: 'center' }}>
                <iframe
                  title="Page preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin"
                  style={{ width: device === 'mobile' ? 390 : '100%', maxWidth: '100%', height: '72vh', border: device === 'mobile' ? `1px solid ${LINE}` : 'none', borderRadius: device === 'mobile' ? 24 : 10, background: '#fff', boxShadow: device === 'mobile' ? '0 20px 60px -24px rgba(20,18,15,.4)' : 'none' }}
                />
              </div>
            </div>
          )}

          {/* ── PUBLISHED ── */}
          {step === 'published' && (
            <div style={{ maxWidth: 520, margin: '48px auto', textAlign: 'center' }}>
              <div style={{ width: 60, height: 60, borderRadius: 999, background: '#e7f7ee', display: 'grid', placeItems: 'center', margin: '0 auto 18px', fontSize: 30 }}>🎉</div>
              <h2 style={{ ...cardTitle, fontSize: 26 }}>Published!</h2>
              <p style={{ fontSize: 14.5, color: SUB, marginTop: 8, lineHeight: 1.55 }}>Your page is now a native Shopify page.{previewUrl ? ' Use the theme preview link to see it staged under your chosen theme before it goes live.' : ' You can edit it any time inside Shopify.'}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
                {previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ background: ORANGE, color: '#fff', textDecoration: 'none', padding: '11px 24px', borderRadius: 999, fontSize: 14, fontWeight: 700 }}>Preview under theme →</a>
                )}
                {publishedUrl && (
                  <a href={publishedUrl} target="_blank" rel="noopener noreferrer" style={{ background: previewUrl ? '#fff' : ORANGE, color: previewUrl ? INK : '#fff', border: previewUrl ? `1px solid ${LINE}` : 'none', textDecoration: 'none', padding: '11px 24px', borderRadius: 999, fontSize: 14, fontWeight: 700 }}>View page →</a>
                )}
                <button onClick={() => { loadPages(); setStep('list') }} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '11px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>My pages</button>
                <button onClick={startNew} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '11px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Build another</button>
              </div>
            </div>
          )}

          {/* ── footer nav (steps 1-4 only) ── */}
          {typeof step === 'number' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, paddingTop: 18, borderTop: `1px solid ${LINE2}` }}>
              <button onClick={goBack} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{step === 1 ? '← My pages' : '← Back'}</button>
              {step === 4 ? (
                <button onClick={runBuild} disabled={!selectedPersona} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '11px 26px', fontWeight: 700, fontSize: 14, cursor: selectedPersona ? 'pointer' : 'default', opacity: selectedPersona ? 1 : 0.5 }}>Build page →</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {step === 3 && <button onClick={goNext} style={{ border: 'none', background: 'none', color: SUB, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Skip</button>}
                  <button onClick={goNext} disabled={!canNext} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '11px 26px', fontWeight: 700, fontSize: 14, cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.5 }}>Next →</button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── right-rail summary (steps 1-4) ── */}
        {typeof step === 'number' && (
          <aside style={{ ...CARD, padding: 16, position: 'sticky', top: 26 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT, marginBottom: 12 }}>Summary</div>
            <SummaryRow label="Template" value={selectedTemplate?.name} />
            <SummaryRow label="Product" value={selectedProduct?.title || (productId && !selectedProduct ? 'Selected' : undefined)} />
            <SummaryRow label="Research" value={researchName ? `${researchName} · ${researchMode === 'close' ? 'Stick closely' : 'Inspiration'}` : 'Skipped'} muted={!researchName} />
            <SummaryRow label="Persona" value={selectedPersona?.name} />
            <SummaryRow label="Angle" value={selectedAngle?.title} />
          </aside>
        )}
      </div>

      {/* ── theme picker modal (Atlas-style: detected from the connected store) ── */}
      {pickerOpen && (
        <div onClick={() => !publishing && setPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(20,18,15,.45)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...CARD, width: 'min(460px, 100%)', padding: 22 }}>
            <div style={eyebrow}>Publish to Shopify</div>
            <h3 style={{ ...cardTitle, fontSize: 22, marginTop: 4 }}>Which theme?</h3>
            <p style={{ fontSize: 13, color: SUB, marginTop: 6, lineHeight: 1.5 }}>Detected from your connected store. The page publishes as a native Shopify page — pick a theme to view it under. A draft theme lets you stage it before going live.</p>
            {publishErr && <ErrorStrip msg={publishErr} />}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
              {themesLoading && <SkeletonRows />}
              {!themesLoading && themes && themes.length === 0 && (
                <div style={{ fontSize: 13, color: SUB, background: INSET, borderRadius: 12, padding: 14, lineHeight: 1.5 }}>We couldn’t detect your themes — the page will publish to your live store.</div>
              )}
              {!themesLoading && (themes || []).map((t) => {
                const on = chosenTheme === t.id
                return (
                  <button key={t.id} onClick={() => setChosenTheme(t.id)} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px 14px', cursor: 'pointer', color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{t.name}{t.live && <span style={{ fontSize: 11, fontWeight: 800, color: GOOD, background: '#e7f7ee', borderRadius: 20, padding: '2px 9px' }}>Live</span>}</div>
                      <div style={{ fontSize: 12, color: FAINT, marginTop: 2, textTransform: 'capitalize' }}>{t.role === 'main' ? 'Published theme' : t.role}</div>
                    </div>
                    <input type="radio" className="bld-radio" checked={on} readOnly />
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button onClick={() => setPickerOpen(false)} disabled={publishing} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '9px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => publish(chosenTheme)} disabled={publishing || themesLoading} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '9px 22px', fontWeight: 700, fontSize: 13.5, cursor: (publishing || themesLoading) ? 'default' : 'pointer', opacity: (publishing || themesLoading) ? 0.6 : 1 }}>{publishing ? 'Publishing…' : 'Publish here →'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 120, background: INK, color: '#fff', padding: '12px 20px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, boxShadow: '0 16px 40px -12px rgba(0,0,0,.4)' }}>{toast}</div>
      )}
    </div>
  )
}

/* ── right-rail summary row ── */
function SummaryRow({ label, value, muted }: { label: string; value?: string; muted?: boolean }) {
  return (
    <div style={{ padding: '9px 0', borderTop: `1px solid ${LINE2}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: FAINT, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: value && !muted ? 650 : 500, color: value ? (muted ? SUB : INK) : FAINT, marginTop: 3, lineHeight: 1.4 }}>{value || 'Not set'}</div>
    </div>
  )
}

/* ── loading skeletons ── */
function SkeletonGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14, marginTop: 18 }}>
      {[0, 1].map((i) => <div key={i} style={{ ...CARD, padding: 12 }}><div style={{ height: 132, borderRadius: 12, background: INSET }} /><div style={{ height: 14, width: '50%', borderRadius: 6, background: INSET, marginTop: 12 }} /><div style={{ height: 11, width: '80%', borderRadius: 6, background: INSET, marginTop: 8 }} /></div>)}
    </div>
  )
}
function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => <div key={i} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 13, padding: 11 }}><div style={{ width: 52, height: 52, borderRadius: 10, background: INSET, flex: 'none' }} /><div style={{ flex: 1 }}><div style={{ height: 13, width: '60%', borderRadius: 6, background: INSET }} /><div style={{ height: 10, width: '35%', borderRadius: 6, background: INSET, marginTop: 8 }} /></div></div>)}
    </>
  )
}
