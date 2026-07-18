'use client'
/**
 * Remake modal (image) — "remake this winning ad with MY product", as a step-by-step wizard.
 *
 * The wizard only re-organises the PRESENTATION of the setup into light-themed steps
 * (Brand → Photos → Headline & style → Picture options → Review). Every piece of state, every
 * handler, and the exact generate()/edit() payloads are unchanged, so generation results are
 * identical to before. Format (picture vs video) is decided by the ad you clicked — the video
 * flow lives in CloneVideoModal.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Link2, Loader2, Download, Sparkles, Check, Library, ChevronLeft, ChevronRight, Trophy } from 'lucide-react'
import { flyToCreatives } from '@/lib/flyToCreatives'
import { creativeFilename } from '@/lib/filename'
import CloneGeneration from '@/components/motion/CloneGeneration'
import { refreshCredits, useCredits } from '@/components/credits/CreditCounter'
import { imagesAreFree } from '@/lib/plans'

type Photo = { id: string; src: string; label?: string } // src = data: URL (upload) or http URL (detected/brand)
type Brand = { id: string; name: string; website?: string | null; products?: { image_urls?: string[] }[] }

const LIME = '#dffe95'
const uid = () => Math.random().toString(36).slice(2)
// Scraped store URLs / R2-fallback hotlinks are often referrer-protected → a raw <img> renders
// broken. Route thumbnails through the weserv proxy (same as every other image surface). data: URLs
// (uploads) and our own R2 objects pass through untouched. Generation still uses the original src.
const cdn = (u: string) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? u : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=160&q=72&output=webp`

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(f)
  })
}

export default function CloneModal({ ad, onClose }: { ad: { id: string; pageId: string; pageName: string; assetImageUrl?: string; sourceThumb?: string }; onClose: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null)
  const [mode, setMode] = useState<'pick' | 'new'>('pick')

  // new-brand fields
  const [bName, setBName] = useState('')
  const [bSite, setBSite] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [colors, setColors] = useState<string[]>([])
  const [fonts, setFonts] = useState<{ heading?: string | null; body?: string | null }>({})
  const [logo, setLogo] = useState<string | null>(null)
  const [palette, setPalette] = useState<any>(null)
  const [saveAsBrand, setSaveAsBrand] = useState(true)

  // photos + selection (up to 4 go to the model)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])

  const [headline, setHeadline] = useState('')
  const [aspect, setAspect] = useState<'original' | '1:1' | '4:5' | '9:16'>('original')
  const [look, setLook] = useState('match')   // recast the on-image model (default keep the original)
  const [imageSize, setImageSize] = useState<'2K' | '4K'>('2K')
  const tier: 'pro' = 'pro'   // Pro (Nano Banana Pro) always — best product fidelity + text
  const [emailDaily, setEmailDaily] = useState(true)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [results, setResults] = useState<{ url: string; genId: string | null }[]>([])  // generated variations
  const errRef = useRef<string | null>(null)  // first per-variation failure message during async polling
  const [activeIdx, setActiveIdx] = useState(0)                    // which variation is open for edit/download
  const [count, setCount] = useState(1)                            // how many variations to generate
  const [brandId, setBrandId] = useState<string | null>(null)      // selected saved brand (for linking generations)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)                    // portal guard (SSR-safe)
  useEffect(() => { setMounted(true) }, [])

  // Wizard step (setup phase only): 0 Brand · 1 Photos · 2 Headline & style · 3 Picture options · 4 Review
  const [step, setStep] = useState(0)

  // Iterative edit loop (chat-style) — each edit charges credits, applied to the ACTIVE variation.
  const [editText, setEditText] = useState('')
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState<{ idx: number; url: string }[]>([]) // for undo

  const active = results[activeIdx] || null

  // Load the user's brands (+ quota) on open.
  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/brands')
        const j = await r.json()
        const bs: Brand[] = j.brands || []
        setBrands(bs)
        if (bs.length === 0) setMode('new')
      } catch { /* non-fatal */ }
    })()
  }, [])

  // ── Draft autosave — an accidental close of this modal used to wipe the whole setup. Persist the
  // configuration per-ad in localStorage and restore it on reopen, so no work is lost. ──
  const draftKey = `remake-draft:v1:${ad.id}${ad.assetImageUrl ? ':asset' : ''}`
  const [draftRestored, setDraftRestored] = useState(false)
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.mode) setMode(d.mode)
      if (d.brandId !== undefined) setBrandId(d.brandId)
      if (typeof d.bName === 'string') setBName(d.bName)
      if (typeof d.bSite === 'string') setBSite(d.bSite)
      if (typeof d.headline === 'string') setHeadline(d.headline)
      if (d.aspect) setAspect(d.aspect)
      if (d.look) setLook(d.look)
      if (d.imageSize) setImageSize(d.imageSize)
      if (typeof d.count === 'number') setCount(d.count)
      if (Array.isArray(d.photos)) setPhotos(d.photos)
      if (Array.isArray(d.selected)) setSelected(d.selected)
      if (typeof d.emailDaily === 'boolean') setEmailDaily(d.emailDaily)
      if (typeof d.saveAsBrand === 'boolean') setSaveAsBrand(d.saveAsBrand)
      if ((Array.isArray(d.photos) && d.photos.length) || d.headline || d.brandId) setDraftRestored(true)
    } catch { /* corrupt draft — ignore */ }
  }, [draftKey])
  useEffect(() => {
    if (!restoredRef.current) return
    const payload = { mode, brandId, bName, bSite, headline, aspect, look, imageSize, count, photos, selected, emailDaily, saveAsBrand }
    try { localStorage.setItem(draftKey, JSON.stringify(payload)) }
    catch {
      // Quota hit (large data: URL uploads) — persist the config without the heavy photo blobs.
      try { localStorage.setItem(draftKey, JSON.stringify({ ...payload, photos: photos.filter((p) => !p.src.startsWith('data:')) })) } catch { /* give up */ }
    }
  }, [draftKey, mode, brandId, bName, bSite, headline, aspect, look, imageSize, count, photos, selected, emailDaily, saveAsBrand])
  const clearDraft = () => {
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
    setMode(brands.length ? 'pick' : 'new'); setBrandId(null); setBName(''); setBSite('')
    setPhotos([]); setSelected([]); setHeadline(''); setAspect('original'); setLook('match')
    setImageSize('2K'); setCount(1); setDraftRestored(false)
  }

  const addPhotos = (list: Photo[]) => {
    setPhotos((p) => {
      const seen = new Set(p.map((x) => x.src))
      const fresh = list.filter((x) => !seen.has(x.src))
      const merged = [...p, ...fresh]
      // auto-select newly added, capped at 4 total
      setSelected((s) => Array.from(new Set([...s, ...fresh.map((f) => f.id)])).slice(0, 4))
      return merged
    })
  }

  // Pull the org's uploaded image Assets into the product-photo picker (spec §10, step 6).
  const [assetsPulled, setAssetsPulled] = useState(false)
  const pullAssets = async () => {
    const r = await fetch('/api/assets?type=image').then((r) => r.json()).catch(() => ({}))
    const list: Photo[] = (r.assets || []).filter((a: any) => a.file_url).map((a: any) => ({ id: 'asset:' + a.id, src: a.file_url, label: a.file_name || 'Asset' }))
    if (!list.length) { setErr('No image assets yet — upload some on the Assets page first.'); return }
    addPhotos(list); setAssetsPulled(true)
  }

  const pickBrand = (b: Brand) => {
    setMode('pick')
    setBrandId(b.id)
    setBName(b.name); setBSite(b.website || '')
    const imgs = (b.products || []).flatMap((p) => p.image_urls || [])
    const ph = imgs.slice(0, 8).map((u) => ({ id: uid(), src: u, label: 'saved' }))
    setPhotos(ph); setSelected(ph.slice(0, 4).map((p) => p.id))
  }

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const arr = await Promise.all(Array.from(files).slice(0, 8).map(async (f) => ({ id: uid(), src: await fileToDataUrl(f), label: 'upload' })))
    addPhotos(arr)
  }

  const detect = async () => {
    if (!bSite.trim()) return
    setDetecting(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/detect-product', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: bSite.trim() }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Could not read that site — upload photos instead.'); return }
      if (j.brandName && !bName.trim()) setBName(j.brandName)
      if (Array.isArray(j.colors)) setColors(j.colors)
      if (j.fonts) setFonts(j.fonts)
      if (j.logo) setLogo(j.logo)
      if (j.palette) setPalette(j.palette)
      const prodSrc = Array.from(new Set([...(j.productImages || []), ...(j.images || [])]))
      addPhotos(prodSrc.map((u: string) => ({ id: uid(), src: u, label: 'detected' })))
      if (!j.images?.length) setErr('No product photos found on that page — upload manually.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setDetecting(false) }
  }

  const toggleSel = (id: string) =>
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length >= 4 ? s : [...s, id]))

  // Remove a photo from the picker entirely (distinct from deselecting) — the ✕ makes removal
  // discoverable; before this the only way to "get rid of" a photo was a non-obvious click-to-deselect.
  const removePhoto = (id: string) =>
    setPhotos((p) => { setSelected((s) => s.filter((x) => x !== id)); return p.filter((x) => x.id !== id) })

  const generate = async () => {
    setErr(null)
    const chosen = photos.filter((p) => selected.includes(p.id)).map((p) => p.src)
    if (chosen.length === 0) { setErr('Add and select at least one product photo.'); return }
    setBusy(true); setResults([]); setActiveIdx(0); setHistory([])
    try {
      let useBrandId = brandId
      // If a new brand and "save" is on, persist it first (best-effort; http image URLs only).
      if (mode === 'new' && saveAsBrand && bName.trim()) {
        const httpImgs = chosen.filter((s) => /^https?:\/\//i.test(s))
        const rb = await fetch('/api/brands', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: bName.trim(), website: bSite.trim() || null, product_images: httpImgs, brand_kit: { colors, fonts, logo, palette } }),
        })
        const jb = await rb.json()
        if (rb.status === 402 && jb.error === 'brand_limit_reached') {
          setBusy(false)
          setErr(`You've used all ${jb.limit} brand slots on your plan. Upgrade to save more — or uncheck "Save as brand" to remake without saving.`)
          setQuota({ used: jb.used, limit: jb.limit })
          return
        }
        if (jb.quota) setQuota(jb.quota)
        if (jb.brand?.id) { useBrandId = jb.brand.id; setBrandId(jb.brand.id) }
      }

      // Opt into daily "new winning ads like this" emails (follows the ad's brand + email alerts on).
      if (emailDaily && !ad.assetImageUrl) {
        fetch('/api/follows', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId: ad.pageId, brandName: ad.pageName, action: 'set_email', email_alerts: true }),
        }).catch(() => {})
      }

      // Fire `count` clones in parallel — each reserves+charges+saves its own generation, so partial
      // success is fine (Gemini's inherent randomness makes the variations differ).
      const body = {
        // Clone from an uploaded ASSET (refImageUrl) or a discovery ad (adId).
        ...(ad.assetImageUrl ? { refImageUrl: ad.assetImageUrl } : { adId: ad.id }),
        productImages: chosen, tier, brandId: useBrandId || undefined,
        brandName: bName.trim() || undefined, colors, newHeadline: headline.trim() || undefined,
        aspectRatio: aspect, logo: logo || undefined, imageSize, palette: palette || undefined, look,
      }

      // ASYNC: enqueue `count` jobs (each reserves + returns a jobId in ~1s — no held-open request,
      // so no 504), then POLL each until it finishes. Generation runs on the server via waitUntil;
      // results are pushed in as they land so the user watches them appear one by one.
      const enq = await Promise.all(Array.from({ length: count }, () =>
        fetch('/api/discovery/clone-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(async (r) => { const j = await r.json().catch(() => ({})); return { ok: r.ok, j } })
          .catch((e) => ({ ok: false, j: { error: `Network error: ${String(e?.message || e)}` } }))
      ))
      const jobIds = enq.filter((e) => e.ok && e.j.jobId).map((e) => e.j.jobId as string)
      if (jobIds.length === 0) {
        const j = enq.find((e) => !e.ok)?.j || {}
        setErr(j.error === 'insufficient_credits' ? 'Not enough credits.'
          : j.error === 'Image generation not configured (GEMINI_API_KEY)' ? 'Remake isn’t switched on yet (missing API key).'
          : j.error || 'Couldn’t start the remake — try again.')
        return
      }
      refreshCredits()   // reservation already hit the balance

      // Poll all jobs in parallel. Each resolves to a url (done), null (failed), or 'timeout'.
      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
      const DEADLINE = Date.now() + 6 * 60_000   // generous — server maxDuration is 5 min
      let firstShown = false
      const pollOne = async (jobId: string): Promise<{ url: string; genId: string } | null> => {
        while (Date.now() < DEADLINE) {
          await sleep(2500)
          try {
            const s = await fetch(`/api/discovery/clone-image/status?id=${jobId}`).then((r) => r.json())
            if (s.done && s.url) {
              const item = { url: s.url as string, genId: (s.generationId as string) || jobId }
              setResults((prev) => [...prev, item])   // show it the moment it lands
              if (!firstShown) { firstShown = true; setActiveIdx(0); flyToCreatives(item.url) }
              return item
            }
            if (s.failed) { if (!errRef.current) errRef.current = s.error || 'One variation failed — credits refunded.'; return null }
          } catch { /* keep polling */ }
        }
        return null
      }
      errRef.current = null
      const done = await Promise.all(jobIds.map(pollOne))
      const okCount = done.filter(Boolean).length
      if (okCount === 0) setErr(errRef.current || 'Generation is taking longer than usual — check My Creatives in a minute.')
      else if (okCount < count) setErr(`${okCount} of ${count} variations generated${errRef.current ? ` — ${errRef.current}` : ''}.`)
      refreshCredits()   // reflect any refunds from failed variations
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setBusy(false) }
  }

  const applyEdit = async () => {
    if (!active || !editText.trim()) return
    setEditing(true); setErr(null)
    const idx = activeIdx, prevUrl = active.url
    try {
      const r = await fetch('/api/discovery/edit-image', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: prevUrl, instruction: editText.trim(), tier, parentId: active.genId || undefined, brandId: brandId || undefined }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErr(j.error === 'insufficient_credits' ? 'Not enough credits for this edit.' : j.error || 'Edit failed — try again.')
        return
      }
      setHistory((h) => [...h, { idx, url: prevUrl }])   // enable undo of this variation
      setResults((rs) => rs.map((x, i) => i === idx ? { url: j.image, genId: j.generationId || x.genId } : x))
      setEditText('')
      refreshCredits()   // each edit charges credits too
      flyToCreatives(j.image)   // edited version is a new saved creative
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setEditing(false) }
  }

  const undo = () => setHistory((h) => {
    if (!h.length) return h
    const last = h[h.length - 1]
    setResults((rs) => rs.map((x, i) => i === last.idx ? { ...x, url: last.url } : x))
    return h.slice(0, -1)
  })

  const { plan, pricing } = useCredits()
  const imagesFree = imagesAreFree(plan)       // Creator/Agency: image remakes + edits are free
  const cost = imageSize === '4K' ? 25 : 15   // 2K → image_clone_pro (15) · 4K → image_clone_4k (25)
  const totalCost = cost * count
  const editCost = pricing?.image_edit_pro?.credits ?? 15   // live DB price (image_edit_pro) so the shown cost always == what's charged
  const cr = (n: number) => imagesFree ? 'Free' : `${n} cr`   // label helper
  const hasResults = results.length > 0

  // ── Wizard plumbing ──────────────────────────────────────────
  const STEPS = [
    { t: 'Your brand', s: 'Logo & colors' },
    { t: 'Product photos', s: 'Up to 4' },
    { t: 'Headline & style', s: 'Words on the image' },
    { t: 'Picture options', s: 'Size · quality · versions' },
    { t: 'Review & create', s: 'See the total' },
  ]
  const brandName = mode === 'new' ? (bName.trim() || 'New brand') : (bName || 'your brand')
  const selectedPhotos = photos.filter((p) => selected.includes(p.id))
  const goNext = () => { if (step < STEPS.length - 1) setStep(step + 1); else generate() }

  if (!mounted) return null
  // Rendered through a portal to <body> so the fixed overlay escapes the virtualized ad card's
  // transform + overflow:hidden (which otherwise clipped it into a narrow strip).
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,10,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: hasResults ? 'min(980px, 96vw)' : 'min(920px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff', border: '1px solid #dfe4de', borderRadius: 20, color: L_INK, boxShadow: '0 30px 90px -30px rgba(23,37,28,0.4)' }}>
        {/* header — pastel gradient band */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 22px', borderBottom: '1px solid #e0eecb', background: HEADER_BG }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 800, fontSize: 16.5, letterSpacing: '-.01em' }}>
            <Sparkles size={17} color={GREEN} /> Remake this ad — make it yours
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid #dcebc4', background: 'rgba(255,255,255,0.8)', color: '#3c473e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={17} /></button>
        </div>

        {busy && !hasResults ? (
          <div style={{ background: '#f6f7f5' }}>
            <CloneGeneration helper="Making your ad · ~30–90 seconds · they appear as they’re ready · keep browsing" />
          </div>
        ) : hasResults ? (
          // ── Results + chat-style edit loop (light) ──
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, overflow: 'auto' }}>
            <div style={{ padding: 22, borderRight: `1px solid ${L_LINE}` }}>
              <SourceCard ad={ad} brandName={brandName} />
              <div style={{ marginTop: 16, fontSize: 13, color: L_MUTED, lineHeight: 1.6 }}>
                Your remake is ready. Keep editing it by just typing on the right — “make the background pink”, “move the logo up” — with full undo. Everything is saved in <b style={{ color: L_INK }}>My Creatives</b>.
              </div>
              <button onClick={() => { setResults([]); setActiveIdx(0); setHistory([]); setStep(0) }}
                style={{ ...btnGhost, marginTop: 18 }}>← Make another</button>
            </div>
            {active && (
              <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Label>{results.length > 1 ? `${results.length} versions` : 'Your remade ad'}</Label>
                  {history.some((h) => h.idx === activeIdx) && (
                    <button onClick={undo} style={{ background: 'transparent', border: `1px solid ${L_LINE}`, color: L_MUTED, borderRadius: 8, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↶ Undo</button>
                  )}
                </div>
                {results.length > 1 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {results.map((rz, i) => (
                      <button key={i} onClick={() => setActiveIdx(i)} style={{ width: 54, height: 54, borderRadius: 8, overflow: 'hidden', border: i === activeIdx ? `2px solid ${GREEN}` : `2px solid ${L_LINE}`, padding: 0, cursor: 'pointer', background: '#f1f3f0' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={rz.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: i === activeIdx ? 1 : 0.6 }} />
                      </button>
                    ))}
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div style={{ position: 'relative' }}>
                  <img src={active.url} alt="remade ad" style={{ width: '100%', borderRadius: 12, border: `1px solid ${L_LINE}`, opacity: editing ? 0.5 : 1 }} />
                  {editing && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: GREEN, gap: 8, fontSize: 13, fontWeight: 600 }}><Loader2 size={18} className="spin" /> Editing…</div>}
                </div>
                <div style={{ background: '#fcfdfb', border: `1px solid ${L_LINE}`, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyEdit() }}
                    placeholder="Tweak this creative — what to change? (headline, subhead, copy, colors, scene, background…)"
                    rows={2}
                    style={{ background: 'transparent', border: 'none', color: L_INK, fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11, color: L_FAINT }}>{cr(editCost)} per edit · ⌘↵ to apply</span>
                    <button onClick={applyEdit} disabled={editing || !editText.trim()} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12.5, opacity: (editing || !editText.trim()) ? 0.6 : 1 }}>
                      {editing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Apply edit · {cr(editCost)}
                    </button>
                  </div>
                </div>
                <a href={`/api/creatives/download?url=${encodeURIComponent(active.url)}&name=${encodeURIComponent(creativeFilename({ brand: bName.trim() || ad.pageName, index: activeIdx + 1, kind: 'clone' }))}`}
                  download={creativeFilename({ brand: bName.trim() || ad.pageName, index: activeIdx + 1, kind: 'clone' })} style={{ ...btnPrimary, textDecoration: 'none', justifyContent: 'center' }}>
                  <Download size={15} /> Download{results.length > 1 ? ' this version' : ''}
                </a>
                {err && <div style={errBox}>{err}</div>}
              </div>
            )}
          </div>
        ) : (
          // ── Setup wizard (light) ──
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* step rail */}
            <div style={{ width: 226, flexShrink: 0, background: L_SIDE, borderRight: `1px solid ${L_LINE}`, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }} className="sm-rail">
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.09em', color: L_FAINT, margin: '0 6px 10px', textTransform: 'uppercase' }}>5 quick steps</div>
              {STEPS.map((s, i) => (
                <button key={i} onClick={() => setStep(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 11, cursor: 'pointer', border: '1px solid ' + (i === step ? L_LINE : 'transparent'), background: i === step ? '#fff' : 'transparent', textAlign: 'left', fontFamily: 'inherit', width: '100%', boxShadow: i === step ? '0 1px 3px rgba(23,37,28,.07)' : 'none' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 99, background: i < step ? '#d8efc7' : (i === step ? FOREST : '#e8ede7'), color: i < step ? SEL_TEXT : (i === step ? LIME : L_MUTED), fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i < step ? '✓' : i + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: i === step ? FOREST : '#3c473e' }}>{s.t}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: L_FAINT }}>{s.s}</span>
                  </span>
                </button>
              ))}
              <div style={{ marginTop: 'auto', fontSize: 11, color: L_FAINT, lineHeight: 1.55, padding: '10px 8px 0', borderTop: `1px solid ${L_LINE}` }}>
                <b style={{ color: '#3c473e' }}>Your exact product, every time.</b><br />We never invent a different bottle, label or price.
              </div>
            </div>

            {/* pane */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 12px' }}>
                {draftRestored && (
                  <div style={{ fontSize: 11.5, color: SEL_TEXT, background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 10, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                    ↩ Restored your last setup for this ad.
                    <button onClick={clearDraft} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: GREEN, cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', fontFamily: 'inherit' }}>Start fresh</button>
                  </div>
                )}

                {/* STEP 1 — Brand */}
                {step === 0 && (
                  <section>
                    <SourceCard ad={ad} brandName={brandName} />
                    <Kicker>Step 1 of 5</Kicker>
                    <H2>Whose ad is this going to be?</H2>
                    <Lead>Pick your brand — we automatically use its <b>logo, colors and product photos</b> so the ad looks like it came from your team.</Lead>
                    {brands.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                        {brands.map((b) => (
                          <button key={b.id} onClick={() => pickBrand(b)} style={chip(mode === 'pick' && bName === b.name)}>{b.name}</button>
                        ))}
                        <button onClick={() => { setMode('new'); setBrandId(null); setBName(''); setBSite(''); setPhotos([]); setSelected([]) }} style={chipDashed(mode === 'new')}>＋ New brand</button>
                      </div>
                    )}
                    {/* Auto-loaded brand kit (saved brand) — confirmation only; the actual photos are
                        managed on the next step, so we don't duplicate the thumbnails here. */}
                    {mode === 'pick' && selectedPhotos.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 14px' }}>
                        <Check size={16} color={GREEN} strokeWidth={3} style={{ flexShrink: 0 }} />
                        <div style={{ fontSize: 12.5, color: SEL_TEXT, lineHeight: 1.5 }}>Loaded <b>{bName}</b>’s logo, colors &amp; {photos.length} product photo{photos.length === 1 ? '' : 's'}. You’ll choose which to use on the next step.</div>
                      </div>
                    )}
                    {mode === 'new' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="field"><FieldLabel>Brand name</FieldLabel><input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="e.g. AURA" style={input} /></div>
                        <div className="field">
                          <FieldLabel>Your website <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· we grab the logo, colors &amp; product photos for you</i></FieldLabel>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input value={bSite} onChange={(e) => setBSite(e.target.value)} placeholder="yourstore.com" onKeyDown={(e) => e.key === 'Enter' && detect()} style={{ ...input, flex: 1 }} />
                            <button onClick={detect} disabled={detecting || !bSite.trim()} style={btnGhost}>{detecting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Detect</button>
                          </div>
                        </div>
                        {(colors.length > 0 || fonts.heading || logo) && (
                          <div style={{ background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: SEL_TEXT }}>🎨 Brand kit detected</div>
                            {logo && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={logo} alt="logo" style={{ height: 22, maxWidth: 90, objectFit: 'contain', background: '#fff', borderRadius: 4, padding: 2, border: `1px solid ${L_LINE}` }} />
                                <span style={{ fontSize: 10.5, color: L_MUTED }}>logo — used in the ad</span>
                              </div>
                            )}
                            {colors.length > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {colors.slice(0, 8).map((c, i) => <span key={i} title={c} style={{ width: 20, height: 20, borderRadius: 5, background: c, border: '1px solid rgba(0,0,0,0.1)' }} />)}
                              </div>
                            )}
                            {fonts.heading && <div style={{ fontSize: 11.5, color: L_MUTED }}>Aa <b style={{ color: L_INK }}>{fonts.heading}</b>{fonts.body && fonts.body !== fonts.heading ? ` · ${fonts.body}` : ''}</div>}
                          </div>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: L_MUTED, cursor: 'pointer' }}>
                          <input type="checkbox" checked={saveAsBrand} onChange={(e) => setSaveAsBrand(e.target.checked)} style={{ accentColor: GREEN }} />
                          Save as a brand for reuse{quota ? ` (${quota.used}/${quota.limit === -1 ? '∞' : quota.limit} used)` : ''}
                        </label>
                      </div>
                    )}
                  </section>
                )}

                {/* STEP 2 — Photos */}
                {step === 1 && (
                  <section>
                    <Kicker>Step 2 of 5</Kicker>
                    <H2>Show us your product</H2>
                    <Lead>These photos are what we place <b>into</b> the ad. Clear photos on a plain background work best. Pick up to 4 — tap to select, ✕ to remove.</Lead>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {photos.map((p) => {
                        const on = selected.includes(p.id)
                        return (
                          <div key={p.id} onClick={() => toggleSel(p.id)} title={on ? 'Click to deselect' : 'Click to select'}
                            style={{ position: 'relative', width: 88, height: 88, borderRadius: 13, overflow: 'hidden', border: on ? `2px solid ${SEL_BORDER}` : `2px solid ${L_LINE}`, background: '#f1f3f0', cursor: 'pointer' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={cdn(p.src)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: on ? 1 : 0.5 }} />
                            {on && <span style={{ position: 'absolute', bottom: 4, right: 4, background: LIME, color: FOREST, borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} strokeWidth={3} /></span>}
                            <button onClick={(e) => { e.stopPropagation(); removePhoto(p.id) }} title="Remove photo" aria-label="Remove photo"
                              style={{ position: 'absolute', top: 4, right: 4, width: 19, height: 19, borderRadius: '50%', background: 'rgba(23,37,28,0.75)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                              <X size={11} strokeWidth={2.75} />
                            </button>
                          </div>
                        )
                      })}
                      <button onClick={() => fileRef.current?.click()} style={photoAdd}><Upload size={16} /> Upload</button>
                      {!assetsPulled && <button onClick={pullAssets} title="Use a file from your Assets library" style={photoAdd}><Library size={16} /> Assets</button>}
                      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
                    </div>
                    <InfoBar>💡 Selected photos come straight from your brand. The final ad shows <b>your exact product</b> — we never invent a different bottle, label or price.</InfoBar>
                  </section>
                )}

                {/* STEP 3 — Headline & style */}
                {step === 2 && (
                  <section>
                    <Kicker>Step 3 of 5</Kicker>
                    <H2>Headline &amp; who’s in the picture</H2>
                    <Lead>Type the exact words you want on the image — that guarantees perfect spelling. Leave it blank and we’ll write one for you.</Lead>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>New on-screen headline <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· optional</i></FieldLabel>
                      <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. 3-week hair fall challenge" style={{ ...input, width: '100%' }} />
                      <div style={{ fontSize: 11.5, color: L_FAINT, marginTop: 6 }}>💡 Your exact words = accurate on-image text. Otherwise the model writes (and sometimes misspells) its own.</div>
                    </div>
                    <div className="field">
                      <FieldLabel>If the ad shows a person <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· keep them, or recast</i></FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(['match', 'Pakistani', 'Indian', 'Arab', 'East Asian', 'Black', 'White', 'Hispanic'] as const).map((v) => (
                          <button key={v} onClick={() => setLook(v)} style={chip(look === v)}>{v === 'match' ? 'Match original' : v}</button>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {/* STEP 4 — Picture options */}
                {step === 3 && (
                  <section>
                    <Kicker>Step 4 of 5</Kicker>
                    <H2>Size, quality &amp; how many versions</H2>
                    <Lead>Pick the shape and quality, and how many different versions to generate.</Lead>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>Shape</FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {([['original', 'Same as original'], ['1:1', 'Square'], ['4:5', 'Feed 4:5'], ['9:16', 'Story 9:16']] as const).map(([v, label]) => (
                          <button key={v} onClick={() => setAspect(v)} style={chip(aspect === v)}>{label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>Quality</FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => setImageSize('2K')} style={chip(imageSize === '2K')}>2K — great for feeds · {cr(15)}</button>
                        <button onClick={() => setImageSize('4K')} style={chip(imageSize === '4K')}>4K — print-sharp · {cr(25)}</button>
                      </div>
                    </div>
                    <div className="field" style={{ marginBottom: 16 }}>
                      <FieldLabel>How many versions <i style={{ fontStyle: 'normal', fontWeight: 500, color: L_FAINT }}>· each is a little different — pick your favorite</i></FieldLabel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[1, 2, 4, 6, 8].map((n) => (<button key={n} onClick={() => setCount(n)} style={chip(count === n)}>{n}</button>))}
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, color: L_INK, cursor: 'pointer', background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 13px' }}>
                      <input type="checkbox" checked={emailDaily} onChange={(e) => setEmailDaily(e.target.checked)} style={{ marginTop: 2, accentColor: GREEN }} />
                      <span>📧 <b>Email me new winning ads like this, daily</b><br /><span style={{ color: L_MUTED, fontSize: 11.5 }}>Fresh top ads from {ad.pageName || 'this brand'} &amp; its niche — 2 credits per email, cancel anytime in Settings.</span></span>
                    </label>
                  </section>
                )}

                {/* STEP 5 — Review */}
                {step === 4 && (
                  <section>
                    <Kicker>Step 5 of 5</Kicker>
                    <H2>Ready — here’s your order</H2>
                    <Lead>Check it over, then create. It’s ready in about a minute and lands right here + in My Creatives.</Lead>
                    <div style={{ border: `1px solid ${L_LINE}`, borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
                      <ReviewRow k="Making" v={`Picture ad · ${count} version${count > 1 ? 's' : ''}`} onEdit={() => setStep(3)} />
                      <ReviewRow k="Brand" v={brandName} onEdit={() => setStep(0)} />
                      <ReviewRow k="Product photos" v={`${selectedPhotos.length} selected`} onEdit={() => setStep(1)} />
                      <ReviewRow k="Headline" v={headline.trim() || 'Auto-written'} onEdit={() => setStep(2)} />
                      <ReviewRow k="On the image" v={look === 'match' ? 'Match the original' : look} onEdit={() => setStep(2)} />
                      <ReviewRow k="Shape & quality" v={`${aspect === 'original' ? 'Original' : aspect} · ${imageSize}`} onEdit={() => setStep(3)} last />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 14, padding: '14px 18px' }}>
                      <b style={{ fontSize: 15 }}>Total</b>
                      <span style={{ fontSize: 19, fontWeight: 800, color: SEL_TEXT }}>{cr(totalCost)}{imagesFree && <small style={{ display: 'block', fontSize: 11.5, color: GREEN, fontWeight: 600, textAlign: 'right' }}>included in your plan</small>}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: L_FAINT, lineHeight: 1.6, marginTop: 10 }}>✅ After it generates you can keep editing by typing, download, or spin more versions. Failed variations refund automatically.</div>
                  </section>
                )}

                {err && <div style={{ ...errBox, marginTop: 16 }}>{err}</div>}
              </div>

              {/* footer nav */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', borderTop: `1px solid ${L_LINE}`, background: '#fcfdfb' }}>
                {step > 0 ? <button onClick={() => setStep(step - 1)} style={btnGhost}><ChevronLeft size={15} /> Back</button> : <span />}
                <span style={{ fontSize: 12, color: L_MUTED }}>{cr(totalCost)}{!imagesFree ? ' · charged when you create' : ''}</span>
                <button onClick={goNext} disabled={busy} style={{ ...btnPrimary, marginLeft: 'auto', opacity: busy ? 0.7 : 1 }}>
                  {step < STEPS.length - 1 ? <>Next <ChevronRight size={15} /></> : <><Sparkles size={15} /> Create my picture ad · {cr(totalCost)}</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:760px){.sm-rail{display:none!important}}`}</style>
    </div>,
    document.body,
  )
}

// ── The winning ad being remade (shown at the top of step 1 + the results view) ──
function SourceCard({ ad, brandName }: { ad: { pageName: string; assetImageUrl?: string; sourceThumb?: string }; brandName: string }) {
  const thumb = ad.sourceThumb || ad.assetImageUrl
  return (
    <div className="srcCard" style={{ display: 'flex', gap: 14, alignItems: 'center', background: '#fcfdfb', border: `1px solid ${L_LINE}`, borderRadius: 14, padding: '12px 14px', marginBottom: 18 }}>
      <div style={{ width: 60, height: 74, borderRadius: 10, flexShrink: 0, overflow: 'hidden', position: 'relative', background: 'linear-gradient(160deg,#dfe5dd,#c4cec2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 22 }}>
        {thumb
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={cdn(thumb)} alt="source ad" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (ad.pageName || '?').charAt(0).toUpperCase()}
        <span style={{ position: 'absolute', bottom: 4, left: 4, right: 4, background: 'rgba(23,37,28,0.85)', color: LIME, fontSize: 7.5, fontWeight: 800, textAlign: 'center', borderRadius: 5, padding: '2px 0', letterSpacing: '.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}><Trophy size={8} /> WINNING</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>The ad you’re remaking — {ad.pageName || 'this brand'}</div>
        <div style={{ fontSize: 11.5, color: L_MUTED, marginTop: 2, lineHeight: 1.5 }}>A proven winner. We rebuild its exact layout and energy around <b style={{ color: L_INK }}>{brandName}</b>’s product.</div>
      </div>
    </div>
  )
}

// ── light-theme tokens + primitives ──
const L_INK = '#161c17', L_MUTED = '#68756b', L_FAINT = '#94a096', L_LINE = '#e7ece7', L_SIDE = '#f6f8f5'
const FOREST = '#17251c', SEL_BG = '#f4fbe6', SEL_BORDER = '#a8cf6f', SEL_TEXT = '#2c4a1f', GREEN = '#3f8f4f'
const HEADER_BG = 'radial-gradient(90% 200% at 100% 0%, #fdf3cf 0%, transparent 50%),radial-gradient(80% 160% at 0% 30%, #e3f9d6 0%, transparent 55%),linear-gradient(120deg,#f6fceb,#f0fae2 45%,#edf8ee)'

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, color: L_INK, letterSpacing: '.01em' }}>{children}</div>
}
function Kicker({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: GREEN, textTransform: 'uppercase', marginBottom: 6 }}>{children}</div>
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.015em', margin: '0 0 6px' }}>{children}</h2>
}
function Lead({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13.5, color: L_MUTED, lineHeight: 1.6, maxWidth: 560, margin: '0 0 20px' }}>{children}</p>
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 700, color: '#3c473e', marginBottom: 6 }}>{children}</div>
}
function InfoBar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: SEL_BG, border: '1px solid #d8ebb9', borderRadius: 12, padding: '11px 13px', fontSize: 12.5, color: SEL_TEXT, lineHeight: 1.55, marginTop: 18 }}>{children}</div>
}
function ReviewRow({ k, v, onEdit, last }: { k: string; v: string; onEdit?: () => void; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '11px 16px', fontSize: 13, borderBottom: last ? 'none' : '1px solid #f1f4f0' }}>
      <span style={{ color: L_MUTED }}>{k}</span>
      <span style={{ fontWeight: 650, textAlign: 'right' }}>{v}{onEdit && <button onClick={onEdit} style={{ fontSize: 11, color: GREEN, fontWeight: 700, marginLeft: 8, cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit' }}>change</button>}</span>
    </div>
  )
}
const input: React.CSSProperties = { background: '#fff', border: `1.5px solid ${L_LINE}`, borderRadius: 12, padding: '11px 14px', color: L_INK, fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }
const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1.5px solid ${L_LINE}`, color: '#3c473e', borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: FOREST, color: LIME, border: 'none', borderRadius: 12, padding: '11px 20px', fontSize: 14, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }
const photoAdd: React.CSSProperties = { width: 88, height: 88, borderRadius: 13, border: '1.5px dashed #c4d0c2', background: '#fcfdfb', color: GREEN, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const errBox: React.CSSProperties = { background: '#fef2f2', border: '1px solid #fecaca', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? FOREST : '#fff', color: on ? LIME : '#333d35', border: `1.5px solid ${on ? FOREST : L_LINE}`, borderRadius: 99, padding: '9px 16px', fontSize: 13, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' })
const chipDashed = (on: boolean): React.CSSProperties => ({ ...chip(on), borderStyle: on ? 'solid' : 'dashed', color: on ? LIME : GREEN })
