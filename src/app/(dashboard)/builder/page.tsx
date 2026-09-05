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
import { useSearchParams } from 'next/navigation'
import { useIsMobile } from '@/lib/useIsMobile'
import { PALETTES, DEFAULT_PALETTE_ID } from '@/lib/builder/palettes'
import BuilderEditor from './BuilderEditor'

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

type Step = 'list' | 1 | 2 | 3 | 4 | 'building' | 'preview' | 'published' | 'edit' | 'editor'
type SavedPage = { id: string; type: string; template_id: string; product_name: string; status: string; shopify_url?: string; created_at: string }
type StoreTheme = { id: number; name: string; role: string; live: boolean }
type EditSlot = { key: string; type: string; label: string; hint?: string }
// which fields are editable inside each array-slot item (image:true → upload / AI-generate control)
const ITEM_FIELDS: Record<string, { field: string; label: string; area?: boolean; image?: boolean }[]> = {
  list: [{ field: 'label', label: 'Label' }, { field: 'body', label: 'Detail' }],
  costs: [{ field: 'label', label: 'Where' }, { field: 'body', label: 'Cost' }],
  timeline: [{ field: 'label', label: 'When' }, { field: 'body', label: 'What changed', area: true }, { field: 'thumb', label: 'Image', image: true }],
  reasons: [{ field: 'label', label: 'Tag' }, { field: 'title', label: 'Heading' }, { field: 'body', label: 'Body', area: true }, { field: 'image', label: 'Image', image: true }],
  testimonials: [{ field: 'name', label: 'Name' }, { field: 'city', label: 'City' }, { field: 'quote', label: 'Quote', area: true }],
  faq: [{ field: 'q', label: 'Question' }, { field: 'a', label: 'Answer', area: true }],
}

const STEP_LABELS = ['Template', 'Product', 'Research', 'Persona & angle']
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese (Brazil)', 'Portuguese (Portugal)', 'Dutch', 'Polish', 'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Turkish', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Arabic', 'Hindi', 'Urdu']

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
  const isMobile = useIsMobile()
  const search = useSearchParams()
  // The click-anywhere visual editor is now the DEFAULT way to edit a page. `?editor=form` opts back to
  // the classic copy form (kept as a rollback while the team pressure-tests the visual editor).
  const editorV2 = search?.get('editor') !== 'form'
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
  const [language, setLanguage] = useState('English')
  const [paletteId, setPaletteId] = useState(DEFAULT_PALETTE_ID)
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
  const [importedProduct, setImportedProduct] = useState<any | null>(null)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState('')
  const importProduct = useCallback(async () => {
    const url = importUrl.trim()
    if (!url || importing) return
    setImporting(true); setImportErr('')
    try {
      const r = await fetch('/api/builder/import-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not import that URL.')
      setImportedProduct(j.product)      // becomes the selected product
      setProductId(null)                 // imported product replaces any Shopify pick
    } catch (e: any) { setImportErr(e?.message || 'Could not import that URL.') }
    finally { setImporting(false) }
  }, [importUrl, importing])
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
    // Shopify products go through persona/angle; an imported (pasted-URL) product builds directly.
    if (!tplId || (!productId && !importedProduct)) return
    setBuildErr(''); setStep('building'); setStageIdx(0)
    // cosmetic staged progress while the real request runs
    const timers: any[] = []
    STAGES.forEach((_, i) => { if (i > 0) timers.push(setTimeout(() => setStageIdx(i), i * 1400)) })
    try {
      const r = await fetch('/api/builder/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: tplId, productId: productId || '',
          importedProduct: importedProduct || undefined,
          persona: selectedPersona, angle: selectedAngle,
          research: researchPayload(),
          language,
          paletteId,
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
  }, [tplId, productId, importedProduct, selectedPersona, selectedAngle])   // eslint-disable-line react-hooks/exhaustive-deps

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
  const [publishKind, setPublishKind] = useState<string>('')            // 'product' | 'home' | …
  const [publishTarget, setPublishTarget] = useState<'this' | 'selected' | 'store'>('this')
  const [needsScopes, setNeedsScopes] = useState(false)
  // 'Selected products' multi-select
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pickProducts, setPickProducts] = useState<Product[] | null>(null)
  const [pickQ, setPickQ] = useState('')
  useEffect(() => {
    if (!pickerOpen || publishTarget !== 'selected') return
    let on = true
    const t = setTimeout(async () => {
      try { const r = await fetch(`/api/builder/products?q=${encodeURIComponent(pickQ)}`); const j = await r.json(); if (on) setPickProducts(j.products || []) } catch { if (on) setPickProducts([]) }
    }, pickProducts ? 300 : 0)
    return () => { on = false; clearTimeout(t) }
  }, [pickerOpen, publishTarget, pickQ]) // eslint-disable-line react-hooks/exhaustive-deps
  const openThemePicker = useCallback(async () => {
    setPickerOpen(true); setPublishErr(''); setNeedsScopes(false)
    // Learn the page kind so the modal can offer product-page targeting (this / selected / whole store).
    if (pageId) fetch(`/api/builder/drafts?id=${encodeURIComponent(pageId)}`).then((r) => r.json()).then((j) => setPublishKind(j?.kind || '')).catch(() => {})
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
  }, [themes, pageId])

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

  const [deleting, setDeleting] = useState<string | null>(null)
  const deleteDraft = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name || 'this page'}"? This can't be undone.`)) return
    setDeleting(id)
    try {
      const r = await fetch(`/api/builder/drafts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('delete_failed')
      setPages((prev) => (prev || []).filter((p) => p.id !== id))
    } catch { setToast('Could not delete that page.'); setTimeout(() => setToast(''), 3200) }
    finally { setDeleting(null) }
  }, [])

  /* ── inline copy editor for a saved page ── */
  const [editSchema, setEditSchema] = useState<EditSlot[] | null>(null)
  const [editContent, setEditContent] = useState<Record<string, any>>({})
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [editHasVisual, setEditHasVisual] = useState(false)   // page was edited in the visual editor
  const editDraft = useCallback(async (id: string) => {
    setOpening(id); setEditErr('')
    try {
      const r = await fetch(`/api/builder/drafts?id=${encodeURIComponent(id)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not open')
      setPageId(j.pageId || id)
      setEditSchema(j.schema || [])
      setEditContent(j.content || {})
      setEditHasVisual(!!j.hasVisualEdits)
      setPublishedUrl(j.shopifyUrl || '')
      setStep('edit')
    } catch { setToast('Could not open that page.'); setTimeout(() => setToast(''), 3200) }
    finally { setOpening(null) }
  }, [])

  // Open the click-anywhere visual editor for a saved page (now the default editor).
  const openVisualEditor = useCallback((id: string) => { setPageId(id); setStep('editor') }, [])
  const setField = (key: string, value: any) => setEditContent((c) => ({ ...c, [key]: value }))
  const setItemField = (key: string, idx: number, field: string, value: any) => setEditContent((c) => {
    const arr = Array.isArray(c[key]) ? [...c[key]] : []
    arr[idx] = { ...(arr[idx] || {}), [field]: value }
    return { ...c, [key]: arr }
  })
  const saveEdit = useCallback(async () => {
    if (!pageId) return
    // This page was hand-edited in the visual editor — saving the form's copy discards those changes.
    if (editHasVisual && !window.confirm('This page was edited in the visual editor. Saving here replaces it with this form’s copy and discards those visual changes. Continue?')) return
    setSaving(true); setEditErr('')
    try {
      const r = await fetch('/api/builder/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, content: editContent, discardVisualEdits: editHasVisual }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not save')
      setPreviewHtml(j.previewHtml || '')
      setPublishErr('')
      setStep('preview')
      loadPages()
    } catch (e: any) { setEditErr(e?.message || 'Could not save') }
    finally { setSaving(false) }
  }, [pageId, editContent, editHasVisual, loadPages])

  /* ── reset all wizard state and start a brand-new page ── */
  const startNew = useCallback(() => {
    setStep(1); setTplId(null); setProductId(null); setImportedProduct(null); setImportUrl(''); setImportErr(''); setQ(''); clearResearch()
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
        body: JSON.stringify({ pageId, themeId: themeId ?? undefined, themeLive: theme?.live ?? undefined, target: publishTarget, productIds: publishTarget === 'selected' ? selectedIds : undefined }),
      })
      const j = await r.json()
      // Product/home pages publish into the theme — that needs theme access the store may not have granted yet.
      if (r.status === 409 && j?.error === 'needs_theme_scopes') { setNeedsScopes(true); setPublishErr(''); return }
      if (!r.ok) throw new Error(j?.message || j?.error || 'Import failed — please try again')
      setPublishedUrl(j.url || '')
      setPreviewUrl(j.previewUrl || '')
      setPickerOpen(false)
      setStep('published')
    } catch (e: any) { setPublishErr(e?.message || 'Import failed — please try again') }
    finally { setPublishing(false) }
  }, [pageId, themes, publishTarget, selectedIds])

  /* ── step gating ── */
  const canNext = (
    step === 1 ? !!tplId :
    step === 2 ? (!!productId || !!importedProduct) :
    step === 3 ? true :          // research is optional
    false
  )
  const goNext = () => {
    if (step === 1) setStep(2)
    // Imported (pasted-URL) products skip persona/angle and build straight away.
    else if (step === 2) { if (importedProduct && !productId) runBuild(); else setStep(3) }
    else if (step === 3) setStep(4)
  }
  const goBack = () => {
    if (step === 1) setStep('list')
    else if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
    else if (step === 4) setStep(3)
    else if (step === 'preview') setStep(4)
    else if (step === 'building') setStep(4)
  }

  const selectedTemplate = (templates || []).find((t) => t.id === tplId) || null
  const selectedProduct = importedProduct || (products || []).find((p) => p.id === productId) || null

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
        @keyframes bldspin { to { transform: rotate(360deg); } }
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
      <div style={{ maxWidth: step === 'editor' ? 1320 : 1080, margin: '0 auto', padding: '26px', display: 'grid', gridTemplateColumns: (isMobile || step === 'list' || step === 'preview' || step === 'published' || step === 'building' || step === 'edit' || step === 'editor') ? '1fr' : 'minmax(0,1fr) 300px', gap: 24, alignItems: 'start' }}>
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
                          <button onClick={() => deleteDraft(pg.id, pg.product_name)} disabled={deleting === pg.id} title="Delete page" style={{ border: `1px solid ${LINE}`, background: '#fff', color: '#9a2b2b', borderRadius: 999, padding: '8px 14px', fontWeight: 600, fontSize: 13, cursor: deleting === pg.id ? 'default' : 'pointer', opacity: deleting === pg.id ? 0.6 : 1 }}>{deleting === pg.id ? 'Deleting…' : 'Delete'}</button>
                          <button onClick={() => editorV2 ? openVisualEditor(pg.id) : editDraft(pg.id)} disabled={opening === pg.id} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: opening === pg.id ? 'default' : 'pointer' }}>{editorV2 ? '✨ Edit' : 'Edit'}</button>
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

              {/* language — the page copy is generated in this language; shown once a template is chosen */}
              {tplId && <div style={{ ...CARD, marginTop: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Language</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>The page copy is written in this language.</div>
                </div>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', fontSize: 14, color: INK, background: '#fff', outline: 'none', fontFamily: 'inherit', minWidth: 180 }}>
                  {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>}

              {/* colour palette — re-skins the whole generated page; shown once a template is chosen */}
              {tplId && <div style={{ ...CARD, marginTop: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Colour palette</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>Sets the accent + gradient for the whole page. You can fine-tune copy and images later.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
                  {PALETTES.map((p) => {
                    const on = paletteId === p.id
                    return (
                      <button key={p.id} type="button" onClick={() => setPaletteId(p.id)} title={p.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, border: `2px solid ${on ? INK : LINE}`, borderRadius: 12, padding: 7, background: '#fff', cursor: 'pointer' }}>
                        <span style={{ display: 'flex', width: 62, height: 34, borderRadius: 7, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)' }}>
                          {p.swatch.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: on ? 800 : 600, color: on ? INK : SUB }}>{p.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>}
            </div>
          )}

          {/* ── STEP 2 · PRODUCT ── */}
          {step === 2 && (
            <div>
              <h2 style={cardTitle}>Pick a product</h2>
              <p style={{ fontSize: 14, color: SUB, marginTop: 6 }}>Import a product via URL from any website, or select one from your connected store.</p>

              {/* import via URL — Amazon / Etsy / Shopify / AliExpress / any site */}
              <div style={{ ...CARD, marginTop: 16, padding: '16px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Import via URL</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>Paste a product page link and we’ll pull its title, price, photos and description.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') importProduct() }} placeholder="https://www.amazon.com/dp/… or any product URL" style={{ flex: 1, minWidth: 220, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', fontSize: 14, color: INK, outline: 'none', fontFamily: 'inherit' }} />
                  <button onClick={importProduct} disabled={!importUrl.trim() || importing} style={{ border: 0, background: importUrl.trim() && !importing ? ORANGE : INSET, color: importUrl.trim() && !importing ? '#fff' : FAINT, borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: importUrl.trim() && !importing ? 'pointer' : 'default' }}>{importing ? 'Importing…' : 'Add product'}</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12, color: FAINT }}>
                  <span style={{ fontWeight: 600 }}>Works with</span>
                  {['🛒 Amazon', '🎨 Etsy', '🛍️ Shopify', '📦 AliExpress', '🌐 Any website'].map((c) => (
                    <span key={c} style={{ border: `1px solid ${LINE}`, borderRadius: 999, padding: '3px 10px', color: SUB, fontWeight: 600 }}>{c}</span>
                  ))}
                </div>
                {importErr && <div style={{ fontSize: 12.5, color: '#9a2b2b', marginTop: 10 }}>{importErr}</div>}
                {importedProduct && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 14, border: `2px solid ${ORANGE}`, boxShadow: `0 0 0 2px ${ORANGE}`, borderRadius: 12, padding: 11, background: '#fff' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', flex: 'none' }}><Thumb src={importedProduct.image} seed={0} height={52} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{importedProduct.title}</div>
                      <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{importedProduct.price ? `${importedProduct.price} · ` : ''}{(importedProduct.images?.length || 0)} photo{(importedProduct.images?.length || 0) === 1 ? '' : 's'} imported</div>
                    </div>
                    <button onClick={() => { setImportedProduct(null); setImportUrl('') }} title="Remove" style={{ border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 999, padding: '6px 12px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Remove</button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 4px', color: FAINT, fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}>
                <span style={{ flex: 1, height: 1, background: LINE }} /> OR SELECT FROM YOUR CATALOG <span style={{ flex: 1, height: 1, background: LINE }} />
              </div>

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
                      <button key={p.id} onClick={() => { setProductId(p.id); setImportedProduct(null) }} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', cursor: 'pointer', padding: 11, font: 'inherit', color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : CARD.boxShadow as string }}>
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
                                  f.image ? (
                                    <div key={f.field}>
                                      <div style={{ fontSize: 11.5, fontWeight: 700, color: FAINT, marginBottom: 2 }}>{f.label}</div>
                                      <ImageEditor value={typeof item?.[f.field] === 'string' ? item[f.field] : ''} onChange={(url) => setItemField(s.key, idx, f.field, url)} />
                                    </div>
                                  ) : f.area ? (
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
                      ) : s.type === 'image' ? (
                        <ImageEditor value={typeof val === 'string' ? val : ''} onChange={(url) => setField(s.key, url)} />
                      ) : s.type === 'video' ? (
                        <MediaEditor value={typeof val === 'string' ? val : ''} onChange={(url) => setField(s.key, url)} pageId={pageId} />
                      ) : (
                        <input value={String(val ?? '')} onChange={(e) => setField(s.key, e.target.value)} style={{ ...editInput, marginTop: 10 }} />
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
          {step === 'editor' && pageId && (
            <BuilderEditor
              pageId={pageId}
              onBack={() => { loadPages(); setStep('list') }}
              onPublish={() => { setStep('preview'); openThemePicker() }}
            />
          )}

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
                  {editorV2 && pageId && (
                    <button onClick={() => openVisualEditor(pageId)} style={{ border: `1px solid ${ORANGE}`, background: WASH, color: ORANGE, borderRadius: 999, padding: '9px 18px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>✨ Edit page</button>
                  )}
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
                {/* One contextual link: on a DRAFT-theme publish the live URL doesn't carry the new page yet,
                    so "Preview under theme" is the only link that shows the work; on a LIVE publish it IS the
                    page. Two near-identical buttons (QA: "both land on the same page") collapse to one. */}
                {(previewUrl || publishedUrl) && (
                  <a href={previewUrl || publishedUrl} target="_blank" rel="noopener noreferrer" style={{ background: ORANGE, color: '#fff', textDecoration: 'none', padding: '11px 24px', borderRadius: 999, fontSize: 14, fontWeight: 700 }}>{previewUrl ? 'Preview under theme →' : 'View page →'}</a>
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
                  <button onClick={goNext} disabled={!canNext} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '11px 26px', fontWeight: 700, fontSize: 14, cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.5 }}>{step === 2 && importedProduct && !productId ? 'Generate page →' : 'Next →'}</button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── right-rail summary (steps 1-4; hidden on mobile to avoid the cramped 2-column overlap) ── */}
        {typeof step === 'number' && !isMobile && (
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
          <div onClick={(e) => e.stopPropagation()} style={{ ...CARD, width: 'min(460px, 100%)', padding: 22, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
            <div style={eyebrow}>Publish to Shopify</div>
            <h3 style={{ ...cardTitle, fontSize: 22, marginTop: 4 }}>{needsScopes ? 'One quick step' : 'Where should it go?'}</h3>
            {needsScopes ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6 }}>Product & home pages publish as <b>native, editable sections</b> straight into your theme (so they replace the real product/home page — not a separate page). That needs theme access your store hasn’t granted yet.</p>
                <p style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6, marginTop: 10 }}>Reconnect your store and add <code style={{ fontSize: 12 }}>read_themes, write_themes</code> to the app’s scopes — takes a minute.</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                  <button onClick={() => setPickerOpen(false)} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '9px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Later</button>
                  <Link href="/connect/shopify" style={{ background: ORANGE, color: '#fff', textDecoration: 'none', borderRadius: 999, padding: '9px 20px', fontWeight: 700, fontSize: 13.5 }}>Reconnect store →</Link>
                </div>
              </div>
            ) : (<>
            <p style={{ fontSize: 13, color: SUB, marginTop: 6, lineHeight: 1.5 }}>{publishKind === 'product' || publishKind === 'home'
              ? 'Publishes as native, editable sections into your theme — it replaces your real ' + (publishKind === 'home' ? 'home page' : 'product page') + '. Pick a theme (a draft theme stages it before going live).'
              : 'Publishes as a native Shopify page. Pick a theme to view it under — a draft theme stages it before going live.'}</p>
            {publishErr && <ErrorStrip msg={publishErr} />}
            {publishKind === 'product' && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Apply this page to…</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {([['this', 'Just this product', 'Only the product you built it from — others keep their pages.'], ['selected', 'Selected products', 'Pick which products get this page — each shows its own details.'], ['store', 'All products', 'Every product gets this design; each shows its own photo, price & details.']] as const).map(([v, l, d]) => {
                    const on = publishTarget === v
                    return (
                      <button key={v} onClick={() => setPublishTarget(v)} style={{ ...CARD, display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', padding: '11px 13px', cursor: 'pointer', color: INK, borderColor: on ? ORANGE : LINE, boxShadow: on ? `0 0 0 2px ${ORANGE}` : 'none' }}>
                        <input type="radio" className="bld-radio" checked={on} readOnly style={{ marginTop: 2 }} />
                        <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{d}</div></div>
                      </button>
                    )
                  })}
                </div>
                {publishTarget === 'selected' && (
                  <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                    <input value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="Search products…" style={{ width: '100%', border: 0, borderBottom: `1px solid ${LINE}`, padding: '10px 12px', fontSize: 13, outline: 'none', color: INK, boxSizing: 'border-box' }} />
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {pickProducts === null && <div style={{ padding: 14, fontSize: 12.5, color: FAINT }}>Loading products…</div>}
                      {pickProducts && pickProducts.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: FAINT }}>No products found.</div>}
                      {(pickProducts || []).map((p) => {
                        const on = selectedIds.includes(String(p.id))
                        return (
                          <button key={p.id} onClick={() => setSelectedIds((s) => on ? s.filter((x) => x !== String(p.id)) : [...s, String(p.id)])} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, borderBottom: `1px solid ${LINE2}`, background: on ? WASH : '#fff', padding: '8px 12px', cursor: 'pointer' }}>
                            <span style={{ width: 17, height: 17, borderRadius: 4, border: `1.5px solid ${on ? ORANGE : LINE}`, background: on ? ORANGE : '#fff', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, flex: 'none' }}>{on ? '✓' : ''}</span>
                            {p.image && <img src={p.image} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', flex: 'none' }} />}
                            <span style={{ fontSize: 13, color: INK, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ padding: '8px 12px', fontSize: 12, color: SUB, background: INSET, borderTop: `1px solid ${LINE}` }}>{selectedIds.length} selected</div>
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '38vh', overflowY: 'auto' }}>
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
              {(() => { const blocked = publishing || themesLoading || (publishKind === 'product' && publishTarget === 'selected' && selectedIds.length === 0); return (
              <button onClick={() => publish(chosenTheme)} disabled={blocked} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '9px 22px', fontWeight: 700, fontSize: 13.5, cursor: blocked ? 'default' : 'pointer', opacity: blocked ? 0.6 : 1 }}>{publishing ? 'Publishing…' : 'Publish here →'}</button>
              ) })()}
            </div>
            </>)}
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 120, background: INK, color: '#fff', padding: '12px 20px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, boxShadow: '0 16px 40px -12px rgba(0,0,0,.4)' }}>{toast}</div>
      )}
    </div>
  )
}

/* ── image slot editor: keep the current image, upload your own, or generate one with AI ── */
function ImageEditor({ value, onChange }: { value?: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState<'upload' | 'gen' | null>(null)
  const [prompt, setPrompt] = useState('')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (f: File | null) => {
    if (!f) return
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { setErr('Please pick a JPEG, PNG, WebP or GIF.'); return }
    if (f.size > 8 * 1024 * 1024) { setErr('Image must be under 8MB.'); return }
    setBusy('upload'); setErr('')
    try {
      const dataB64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read')); r.readAsDataURL(f)
      })
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'upload', dataB64, mimeType: f.type }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Upload failed')
      onChange(j.url)
    } catch (e: any) { setErr(e?.message || 'Upload failed') }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = '' }
  }

  const generate = async () => {
    if (!prompt.trim()) { setErr('Describe the image you want first.'); return }
    setBusy('gen'); setErr('')
    try {
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'generate', prompt: prompt.trim() }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.reason || j?.error || 'Could not generate')
      onChange(j.url); setPrompt('')
    } catch (e: any) { setErr(e?.message || 'Could not generate') }
    finally { setBusy(null) }
  }

  const btn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '8px 14px', fontWeight: 650, fontSize: 13, cursor: 'pointer' }
  return (
    <div style={{ marginTop: 10 }}>
      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 96, height: 96, borderRadius: 12, overflow: 'hidden', flex: 'none', background: INSET, border: `1px solid ${LINE}`, display: 'grid', placeItems: 'center' }}>
          {value ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 11, color: FAINT }}>No image</span>}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy === 'upload' ? 'Uploading…' : '⬆ Upload'}</button>
            {value && <button onClick={() => onChange('')} disabled={!!busy} style={btn}>Remove</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe an image to generate…" onKeyDown={(e) => { if (e.key === 'Enter') generate() }} style={{ ...editInput, flex: 1 }} />
            <button onClick={generate} disabled={!!busy} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>{busy === 'gen' ? 'Generating…' : '✨ AI · 15 cr'}</button>
          </div>
          {err && <div style={{ fontSize: 12, color: '#9a2b2b', marginTop: 6 }}>{err}</div>}
        </div>
      </div>
    </div>
  )
}

/* ── video/media slot editor: upload a customer video (or image) straight to storage (presigned) ── */
const UGC_LANGS: [string, string][] = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['hi', 'Hindi'], ['pt', 'Portuguese']]

function MediaEditor({ value, onChange, pageId }: { value?: string; onChange: (url: string) => void; pageId?: string }) {
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const isVideo = !!value && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(value)

  // ── AI UGC video generation (studio Seedance pipeline) ──
  const [gen, setGen] = useState<'idle' | 'form' | 'working'>('idle')
  const [ugcCost, setUgcCost] = useState<number | null>(null)
  const [dur, setDur] = useState(15)
  const [look, setLook] = useState('')
  const [lang, setLang] = useState('en')
  const [refUrl, setRefUrl] = useState('')
  const [refBusy, setRefBusy] = useState(false)
  const refFileRef = useRef<HTMLInputElement>(null)
  const [voice, setVoice] = useState('nova')
  const [aspect, setAspect] = useState('9:16')
  const [vibe, setVibe] = useState('')
  const [prog, setProg] = useState('Starting…')

  const onRefFile = async (f: File | null) => {
    if (!f) return
    if (!/^video\//.test(f.type)) { setErr('Reference must be a video.'); return }
    if (f.size > 120 * 1024 * 1024) { setErr('Reference must be under 120MB.'); return }
    setRefBusy(true); setErr('')
    try {
      const r = await fetch('/api/builder/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: f.type, size: f.size }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Upload failed')
      await new Promise<void>((res, rej) => { const xhr = new XMLHttpRequest(); xhr.open('PUT', j.uploadUrl); xhr.setRequestHeader('Content-Type', f.type); xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error('Upload failed'))); xhr.onerror = () => rej(new Error('Upload failed')); xhr.send(f) })
      setRefUrl(j.publicUrl)
    } catch (e: any) { setErr(e?.message || 'Reference upload failed') }
    finally { setRefBusy(false); if (refFileRef.current) refFileRef.current.value = '' }
  }
  const pollRef = useRef<any>(null)
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current) }, [])

  const openGen = async () => {
    setGen('form'); setErr('')
    try { const r = await fetch('/api/builder/ugc-video?cost=1'); const j = await r.json(); if (r.ok) setUgcCost(j.cost ?? null) } catch { /* ignore */ }
  }
  const poll = (jobId: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/builder/ugc-video?jobId=${encodeURIComponent(jobId)}`)
        const j = await r.json()
        if (j.status === 'done' && j.url) { onChange(j.url); setGen('idle'); return }
        if (j.status === 'failed') { setErr(j.error || 'Generation failed — you were not charged.'); setGen('idle'); return }
        setProg(j.progress?.label ? `${j.progress.label}${j.progress.pct ? ` · ${j.progress.pct}%` : ''}` : 'Rendering your video…')
      } catch { /* keep polling */ }
      poll(jobId)
    }, 5000)
  }
  const generate = async () => {
    if (!pageId) { setErr('Save the page first, then generate.'); return }
    setGen('working'); setErr(''); setProg('Analyzing your product…')
    try {
      const r = await fetch('/api/builder/ugc-video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId, duration: dur, characterLook: look.trim(), language: lang, referenceUrl: refUrl.trim(), voice, aspect, vibe: vibe.trim() }) })
      const j = await r.json(); if (!r.ok || !j.jobId) throw new Error(j?.error || 'Could not start generation')
      poll(j.jobId)
    } catch (e: any) { setErr(e?.message || 'Could not start generation'); setGen('idle') }
  }

  const onFile = async (f: File | null) => {
    if (!f) return
    if (!/^(video|image)\//.test(f.type)) { setErr('Pick a video or image file.'); return }
    if (f.size > 120 * 1024 * 1024) { setErr('File must be under 120MB.'); return }
    setBusy(true); setErr(''); setPct(0)
    try {
      const r = await fetch('/api/builder/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: f.type, size: f.size }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Upload failed')
      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', j.uploadUrl)
        xhr.setRequestHeader('Content-Type', f.type)
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)) }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error('Upload failed')))
        xhr.onerror = () => rej(new Error('Upload failed'))
        xhr.send(f)
      })
      onChange(j.publicUrl)
    } catch (e: any) { setErr(e?.message || 'Upload failed') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const btn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '8px 14px', fontWeight: 650, fontSize: 13, cursor: 'pointer' }
  return (
    <div style={{ marginTop: 10 }}>
      <input ref={fileRef} type="file" accept="video/*,image/*" onChange={(e) => onFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 72, height: 110, borderRadius: 10, overflow: 'hidden', flex: 'none', background: INSET, border: `1px solid ${LINE}`, display: 'grid', placeItems: 'center' }}>
          {value ? (isVideo ? <video src={value} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : <span style={{ fontSize: 18, opacity: 0.4 }}>▶</span>}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => fileRef.current?.click()} disabled={busy || gen === 'working'} style={{ ...btn, opacity: (busy || gen === 'working') ? 0.6 : 1 }}>{busy ? `Uploading… ${pct}%` : '⬆ Upload video'}</button>
            {gen === 'idle' && <button onClick={openGen} disabled={busy} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>✨ Generate UGC</button>}
            {value && gen === 'idle' && <button onClick={() => onChange('')} disabled={busy} style={btn}>Remove</button>}
          </div>

          {gen === 'form' && (() => {
            const fld: React.CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, marginTop: 3, background: '#fff', fontFamily: 'inherit' }
            const lbl: React.CSSProperties = { fontSize: 12, color: SUB, display: 'block' }
            return (
            <div onClick={() => setGen('idle')} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,18,15,.5)', display: 'grid', placeItems: 'center', padding: 20 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(470px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 22 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Generate a UGC video</div>
                <div style={{ fontSize: 12.5, color: SUB, margin: '2px 0 14px' }}>Built from this product, in your style.</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={lbl}>Duration<select value={dur} onChange={(e) => setDur(Number(e.target.value))} style={fld}>{[8, 10, 15, 20, 30].map((d) => <option key={d} value={d}>{d} seconds</option>)}</select></label>
                  <label style={lbl}>Language<select value={lang} onChange={(e) => setLang(e.target.value)} style={fld}>{UGC_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
                  <label style={lbl}>Voice<select value={voice} onChange={(e) => setVoice(e.target.value)} style={fld}>{[['nova', 'Nova (warm F)'], ['shimmer', 'Shimmer (bright F)'], ['onyx', 'Onyx (deep M)'], ['echo', 'Echo (calm M)']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
                  <label style={lbl}>Format<select value={aspect} onChange={(e) => setAspect(e.target.value)} style={fld}>{[['9:16', 'Vertical 9:16'], ['1:1', 'Square 1:1'], ['16:9', 'Wide 16:9']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
                </div>
                <label style={{ ...lbl, marginTop: 10 }}>Creator look<input value={look} onChange={(e) => setLook(e.target.value)} placeholder="e.g. Pakistani woman, 25–30, warm and friendly" style={fld} /></label>
                <label style={{ ...lbl, marginTop: 10 }}>Vibe / tone<input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="e.g. excited, honest, casual" style={fld} /></label>
                <div style={{ ...lbl, marginTop: 10 }}>Reference clip <span style={{ color: FAINT }}>— a short UGC video whose style the new one follows</span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                    <input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="Paste a video URL…" style={{ ...fld, marginTop: 0, flex: 1 }} />
                    <input ref={refFileRef} type="file" accept="video/*" onChange={(e) => onRefFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                    <button onClick={() => refFileRef.current?.click()} disabled={refBusy} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 8, padding: '8px 12px', fontWeight: 650, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>{refBusy ? 'Uploading…' : '⬆ Upload'}</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${LINE2}`, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, color: FAINT }}>A few minutes · refunded if it fails</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setGen('idle')} style={btn}>Cancel</button>
                    <button onClick={generate} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Generate{ugcCost != null ? ` — ${ugcCost.toLocaleString()} credits` : ''}</button>
                  </div>
                </div>
              </div>
            </div>
          )})()}

          {gen === 'working' && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', background: INSET }}>
              <span className="bld-spin" style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${WASH}`, borderTopColor: ORANGE, animation: 'bldspin 1s linear infinite', flex: 'none' }} />
              <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{prog}</span>
            </div>
          )}

          {gen === 'idle' && <div style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>Upload MP4 / WebM / MOV (up to 120MB), or ✨ generate a UGC clip from your product.</div>}
          {err && <div style={{ fontSize: 12, color: '#9a2b2b', marginTop: 6 }}>{err}</div>}
        </div>
      </div>
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
