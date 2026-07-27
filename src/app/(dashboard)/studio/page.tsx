'use client'
/**
 * STUDIO — the two-pane creation surface (Ploy's editor, applied to ads).
 * LEFT: talk to Mello (reuses useChatStream + the real agent).
 * RIGHT: the canvas, with two modes:
 *   • Remake a winner — arrive with ?ad=&img= (from a competitor ad). The competitor's
 *     winning ad shows FIRST as the source; Mello opens with the pre-adaptation
 *     (/api/remake/adapt); Create runs the real clone engine (/api/discovery/clone-image,
 *     job-based → poll) and renders your version beside theirs.
 *   • Create fresh — analyze the brand's site (detect-product → kit + photos), angle,
 *     niche, then /api/discovery/generate-ad (sync).
 * Reuses the existing engines verbatim; the working modals are untouched.
 */
import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Upload, Download, Wand2, Loader2, ArrowUp, Check, Image as ImageIcon, Globe, Plus, Trophy, Play } from 'lucide-react'
import { useCredits, confirmCredits, refreshCredits } from '@/components/credits/CreditCounter'
import { useChatStream, type CreationEvent } from '@/components/mello/useChatStream'

// The video-clone flow (language · voice · free script · render) now lives INLINE in the canvas.
import MelloFace from '@/components/MelloFace'
import Working from '@/components/Working'
import InlineVideoRemake from './InlineVideoRemake'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Brand = { id: string; name: string; website?: string; brand_type?: string; brand_kit?: any; products?: { image_urls?: string[] }[] }
type Photo = { id: string; src: string }
type Kit = { colors: string[]; fonts: any; logo: string | null; palette: string | null }
// When Mello drives generation, she passes everything explicitly so generate() never reads stale state.
type GenOverride = {
  mode?: 'fresh' | 'remake'
  source?: { adId: string; img: string | null; brand: string | null } | null
  productImages?: string[]
  brandId?: string
  brandName?: string
  brandType?: string
  kit?: Kit
  headline?: string
  angle?: string
  niche?: string
  aspect?: 'original' | '4:5' | '1:1' | '9:16' | '16:9'
}
const uid = () => Math.random().toString(36).slice(2)
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })
const emptyKit = (): Kit => ({ colors: [], fonts: null, logo: null, palette: null })

const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }
const field: React.CSSProperties = { border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 13px', fontSize: 13.5, color: INK, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

function StudioInner() {
  const { balance } = useCredits()
  const params = useSearchParams()
  // Mello can drive the canvas: a `creation` event from the studio surface fires onCreation.
  // We route it through a ref so the handler always sees the latest state (no stale closure).
  const creationRef = useRef<(ev: CreationEvent) => void>(() => {})
  const chat = useChatStream({ surface: 'studio', onCreation: (ev) => creationRef.current(ev) })
  const [convId, setConvId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatStartedRef = useRef(false)   // once true, the remake-adapt effect must not overwrite the chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.messages])

  // mode + remake source — SEEDED from the URL at first render (not in an effect) so the remake canvas
  // (and the inline video flow) appears even if the client never hydrates (broken extensions).
  const _adParam = params.get('ad')
  const [mode, setMode] = useState<'fresh' | 'remake'>(_adParam ? 'remake' : 'fresh')
  const [source, setSource] = useState<{ adId: string; img: string | null; brand: string | null } | null>(_adParam ? { adId: _adParam, img: params.get('img'), brand: params.get('brand') } : null)
  const isVideo = params.get('type') === 'video'          // the winner is a video → the video-clone flow
  const vidParam = params.get('vid')                      // competitor's mp4 (for the source preview)
  // Some remake entry points pass only the poster (img=) and no vid= — resolve the source mp4 from the
  // ad id so the winner still plays (and the clone flow gets the real motion reference).
  const [resolvedVid, setResolvedVid] = useState<string | null>(null)
  useEffect(() => {
    if (!isVideo || vidParam || !_adParam) return
    fetch(`/api/discovery/ad/${_adParam}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const cre = Array.isArray(j?.ad?.creatives) ? j.ad.creatives : []
      const vid = cre.find((c: any) => c?.asset_type === 'video' && c?.r2_url)?.r2_url || j?.ad?.videoUrl || null
      if (vid) setResolvedVid(vid)
    }).catch(() => {})
  }, [isVideo, vidParam, _adParam])
  const vidUrl = vidParam || resolvedVid                  // param wins; else the resolved source mp4

  // brand + site
  const [brands, setBrands] = useState<Brand[]>([])
  const [bmode, setBmode] = useState<'pick' | 'new'>('pick')
  const [brandId, setBrandId] = useState<string>('')
  const [brandName, setBrandName] = useState('')
  const [website, setWebsite] = useState('')
  const [kit, setKit] = useState<Kit>(emptyKit())
  const [detecting, setDetecting] = useState(false)

  // creative inputs
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [headline, setHeadline] = useState('')
  const [angle, setAngle] = useState('')
  const [niches, setNiches] = useState<string[]>([])
  const [niche, setNiche] = useState('')
  const [aspect, setAspect] = useState<'original' | '4:5' | '1:1' | '9:16' | '16:9'>('4:5')
  // Parity with the old image modal: recast the person, quality, and how many versions.
  const [look, setLook] = useState('match')
  const [imgQuality, setImgQuality] = useState<'2K' | '4K'>('2K')
  const [variantCount, setVariantCount] = useState(1)

  // gen
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ url: string; genId: string | null } | null>(null)
  const [versions, setVersions] = useState<{ url: string; genId: string | null; kind: string }[]>([])
  const [work, setWork] = useState<{ id: string; image_url: string; type?: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [editText, setEditText] = useState(''); const [editing, setEditing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const perImage = imgQuality === '4K' ? 25 : 15
  const cost = isVideo ? 600 : perImage * variantCount
  // Once the user has analyzed a site or uploaded, the (slow) /api/brands auto-pick must NOT overwrite
  // their photos — that race is why analyzed photos "vanished after 5-10s".
  const touchedRef = useRef(false)
  const [winnerPlaying, setWinnerPlaying] = useState(false)   // click the lime button to play the winner video inline

  useEffect(() => {
    fetch('/api/brands').then(r => r.json()).then(j => {
      const bs: Brand[] = j.brands || []; setBrands(bs)
      if (touchedRef.current) return
      // On a deep-linked remake (?brand=Name), load THAT brand's kit — its logo, colors and product
      // photos are what the clone engine grounds on. Auto-picking bs[0] fed the engine the wrong
      // brand's logo, so the remade ad's logo came out reinvented. Fall back to bs[0] only if no match.
      const bnd = (params.get('brand') || '').trim().toLowerCase()
      const match = bnd ? bs.find(b => (b.name || '').trim().toLowerCase() === bnd) : null
      const pick = match || bs[0]
      if (pick) pickBrand(pick); else setBmode('new')
    }).catch(() => setBmode('new'))
    fetch('/api/discovery/niches').then(r => r.json()).then(j => setNiches(j.niches || [])).catch(() => {})
    fetch('/api/creatives').then(r => r.json()).then(j => setWork((j.creatives || []).filter((c: any) => c.media_type !== 'video' && c.status === 'done' && c.image_url).slice(0, 14))).catch(() => {})
    fetch('/api/mello/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(r => r.json()).then(j => { if (j?.conversation?.id) setConvId(j.conversation.id) }).catch(() => {})

    const adId = params.get('ad'); const img = params.get('img'); const bnd = params.get('brand')
    if (adId) {
      setMode('remake'); setSource({ adId, img: img || null, brand: bnd || null }); setAspect('original')
      chat.setHistory([{ role: 'assistant', content: 'Let me study this winning ad and adapt it for your brand…' }])
    } else {
      chat.setHistory([{ role: 'assistant', content: 'This is your studio. Analyze your website on the right so I know your brand — then pick product photos, set the angle, and hit Create. Or ask me here for an angle and a hook first.' }])
    }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Remake: once we know the brand, fetch Mello's pre-adaptation and speak it.
  useEffect(() => {
    if (mode !== 'remake' || !source?.adId) return
    fetch('/api/remake/adapt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adId: source.adId, brandId: brandId || undefined }) })
      .then(r => r.json()).then(d => {
        // Never overwrite an active conversation — the user may have already started chatting
        // (this effect re-runs when the brand loads/changes, and resolves async).
        if (chatStartedRef.current) return
        if (d?.adaptation) {
          const a = d.adaptation
          const lines = [`I studied this ${source.brand || d.adBrand || 'competitor'} ad. ${a.studied || ''}`.trim(),
            '', `Here's how I'd rebuild it for ${d.brand?.name || 'your brand'}:`,
            `• Hook: ${a.hook}`, ...(a.scenes || []).slice(0, 3).map((s: string) => `• ${s}`),
            '', 'Pick your product photos on the right and hit Remake.'].filter(x => x !== undefined)
          chat.setHistory([{ role: 'assistant', content: lines.join('\n') }])
        }
      }).catch(() => {})
  }, [mode, source?.adId, brandId])   // eslint-disable-line react-hooks/exhaustive-deps

  const pickBrand = (b: Brand) => {
    setBmode('pick'); setBrandId(b.id); setBrandName(b.name); setWebsite(b.website || '')
    const k = b.brand_kit || {}; setKit({ colors: k.colors || [], fonts: k.fonts || null, logo: k.logo || null, palette: k.palette || null })
    const imgs = (b.products || []).flatMap(p => p.image_urls || []).slice(0, 10)
    // Ground on the first 4 product photos (parity with the old clone modal) — more references =
    // a far more faithful bottle + logo. Selecting only 2 was starving the engine.
    const ph = imgs.map(u => ({ id: uid(), src: u })); setPhotos(ph); setSelected(ph.slice(0, 4).map(p => p.id))
  }
  const newBrand = () => { setBmode('new'); setBrandId(''); setBrandName(''); setWebsite(''); setKit(emptyKit()); setPhotos([]); setSelected([]) }

  const analyze = async () => {
    if (!website.trim()) return
    touchedRef.current = true   // stop a late brands-fetch from clobbering what we analyze
    setDetecting(true); setErr(null)
    try {
      const j = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: website.trim() }) }).then(r => r.json())
      if (j.brandName && !brandName.trim()) setBrandName(j.brandName)
      setKit({ colors: Array.isArray(j.colors) ? j.colors : [], fonts: j.fonts || null, logo: j.logo || null, palette: j.palette || null })
      const found = Array.from(new Set([...(j.productImages || []), ...(j.images || [])])) as string[]
      if (found.length) { const ph = found.slice(0, 10).map(u => ({ id: uid(), src: u })); setPhotos(p => [...ph, ...p]); setSelected(s => Array.from(new Set([...ph.slice(0, 4).map(p => p.id), ...s])).slice(0, 4)) }
      else setErr('Analyzed the site, but found no product photos — upload a couple below.')
    } catch { setErr('Couldn’t analyze that site — check the URL or upload photos manually.') } finally { setDetecting(false) }
  }

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    touchedRef.current = true
    const arr = await Promise.all(Array.from(files).slice(0, 6).map(async f => ({ id: uid(), src: await fileToDataUrl(f) })))
    setPhotos(p => [...arr, ...p]); setSelected(s => Array.from(new Set([...arr.map(a => a.id), ...s])).slice(0, 4))
  }
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : (s.length >= 4 ? s : [...s, id]))
  // Tell Mello what's already on the canvas so she can act on "remake this"/"tweak this" without asking.
  const canvasContext = () => {
    const b = brands.find(x => x.id === brandId)
    const lines: string[] = []
    if (mode === 'remake' && source?.adId) {
      lines.push(`A competitor winning ad is ALREADY OPEN on the canvas as the remake source (source_ad_id=${source.adId}${source.brand ? `, from ${source.brand}` : ''}${isVideo ? ', it is a VIDEO ad' : ''}). For "remake this" / "make my version", call create_ad with kind="remake" and OMIT source_ad_id — the canvas already has it.`)
    } else {
      lines.push('No competitor ad is open — the canvas is in fresh-create mode. For "make an ad"/"a fresh ad"/"a UGC version", call create_ad with kind="fresh".')
    }
    lines.push(`Selected brand: ${b?.name || brandName || 'none set'}${b?.brand_type ? ` (${b.brand_type})` : ''}.`)
    lines.push(`${selected.length} product photo(s) selected of ${photos.length} available.${photos.length === 0 ? ' No product photos yet — tell the user to analyze their site or upload before you generate.' : ''}`)
    lines.push(result ? 'There IS a generated image on the canvas now — for "tweak"/"change it"/"bigger logo", call create_ad with kind="tweak" and the instruction.' : 'No generated image yet — tweak is unavailable until something is generated.')
    return lines.join('\n')
  }
  const send = () => { const t = draft.trim(); if (!t || !convId || chat.streaming) return; chatStartedRef.current = true; setDraft(''); chat.sendMessage(convId, t, canvasContext()) }
  // Every generate/tweak becomes a version you can revert to (Ploy's Versions).
  const land = (url: string, genId: string | null, kind: string) => { setResult({ url, genId }); setVersions(v => [...v, { url, genId, kind }]) }
  // Open a past creation from My Work into the canvas — tweak or download it again.
  const openWork = (c: { id: string; image_url: string }) => { setResult({ url: c.image_url, genId: c.id }); setVersions([{ url: c.image_url, genId: c.id, kind: 'saved' }]); setErr(null); setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60) }

  const generate = async (ov?: GenOverride) => {
    setErr(null)
    if (busy) return
    // Resolve every input from the explicit override first (Mello-driven), else current UI state.
    const useMode = ov?.mode ?? mode
    const useSource = ov?.source !== undefined ? ov.source : source
    // Video winner → handled by the inline video flow (InlineVideoRemake) in the canvas, not here.
    if (useMode === 'remake' && isVideo) return
    const chosen = ov?.productImages ?? photos.filter(p => selected.includes(p.id)).map(p => p.src)
    if (!chosen.length) { setErr('Select at least one product photo (analyze your site or upload).'); return }
    if (!confirmCredits(useMode === 'remake' ? 'remake this ad' : 'create an ad', cost, balance)) return
    const useKit = ov?.kit ?? kit
    const useHeadline = ov?.headline ?? headline
    const useAngle = ov?.angle ?? angle
    const useNiche = ov?.niche ?? niche
    const useAspect = ov?.aspect ?? aspect
    const useBrandName = ov?.brandName ?? brandName
    const useBrandType = ov?.brandType ?? brands.find(b => b.id === (ov?.brandId ?? brandId))?.brand_type
    setBusy(true); setResult(null)
    try {
      // A brand-new brand (manual flow only): save it first so the kit persists.
      let useBrandId = ov?.brandId ?? brandId
      if (!ov && bmode === 'new' && brandName.trim()) {
        const httpImgs = chosen.filter(s => /^https?:\/\//i.test(s))
        const jb = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: brandName.trim(), website: website.trim() || null, product_images: httpImgs, brand_kit: kit }) }).then(r => r.json()).catch(() => ({}))
        if (jb?.brand?.id) { useBrandId = jb.brand.id; setBrandId(jb.brand.id) }
      }

      if (useMode === 'remake' && useSource?.adId) {
        // clone the competitor's winner (job-based → poll). Recast the person (look),
        // pick the quality, and fan out N versions — one job each (they render in parallel).
        const body = {
          adId: useSource.adId, productImages: chosen, tier: 'pro', brandId: useBrandId || undefined,
          productType: useBrandType || 'physical', brandName: useBrandName.trim() || undefined,
          colors: useKit.colors, palette: useKit.palette || undefined, logo: useKit.logo || undefined,
          newHeadline: useHeadline.trim() || undefined, aspectRatio: useAspect, imageSize: imgQuality,
          look,   // always send (default 'match') — byte-identical to the old clone modal's payload
        }
        const jobIds: string[] = []
        for (let v = 0; v < variantCount; v++) {
          const enq = await fetch('/api/discovery/clone-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const ej = await enq.json().catch(() => ({}))
          if (enq.ok && ej.jobId) jobIds.push(ej.jobId)
          else if (v === 0) { setErr(ej.error === 'insufficient_credits' ? 'Not enough credits.' : ej.error || 'Couldn’t start the remake.'); return }
        }
        const pending = new Set(jobIds)
        let landedAny = false
        for (let i = 0; i < 160 && pending.size; i++) {
          await sleep(2500)
          for (const jid of Array.from(pending)) {
            const s = await fetch(`/api/discovery/clone-image/status?id=${jid}`).then(r => r.json()).catch(() => ({}))
            if (s.done && s.url) { land(s.url, s.generationId || jid, 'remake'); pending.delete(jid); landedAny = true }
            else if (s.failed) { pending.delete(jid); if (!landedAny && pending.size === 0) setErr(s.error || 'The remake failed — credits were refunded.') }
          }
        }
        if (!landedAny && pending.size) setErr('Still working — check My Creatives in a minute.')
        refreshCredits()
      } else {
        // fresh create (sync) — fan out N versions
        const body = {
          brandId: useBrandId || undefined, productImages: chosen, brandName: useBrandName.trim() || undefined,
          colors: useKit.colors, palette: useKit.palette || undefined, fonts: useKit.fonts, logo: useKit.logo || undefined,
          newHeadline: useHeadline.trim() || undefined, angle: useAngle.trim() || undefined, niche: useNiche || undefined,
          aspectRatio: useAspect === 'original' ? '4:5' : useAspect, imageSize: imgQuality,
        }
        let landedAny = false
        for (let v = 0; v < variantCount; v++) {
          const r = await fetch('/api/discovery/generate-ad', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const t = await r.text(); let j: any; try { j = JSON.parse(t) } catch { j = { error: `HTTP ${r.status}` } }
          if (!r.ok || !j?.url) { if (!landedAny) { setErr(j?.error === 'insufficient_credits' ? 'Not enough credits.' : j?.error || 'Generation failed — try again.'); return } break }
          land(j.url, j.generationId || null, 'fresh'); landedAny = true
        }
        refreshCredits()
      }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const applyEditWith = async (instruction: string) => {
    if (!result || !instruction.trim() || editing) return
    setEditing(true); setErr(null)
    try {
      const j = await fetch('/api/discovery/edit-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: result.url, instruction: instruction.trim(), tier: 'pro', parentId: result.genId, brandId: brandId || undefined }) }).then(r => r.json())
      const newUrl = j?.url || j?.image
      if (!newUrl) { setErr(j?.error === 'insufficient_credits' ? 'Not enough credits for an edit.' : j?.error || 'Edit failed.'); return }
      land(newUrl, j.generationId || result.genId, 'tweak'); setEditText(''); refreshCredits()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setEditing(false) }
  }
  const applyEdit = () => applyEditWith(editText)
  const download = () => { if (result) { const a = document.createElement('a'); a.href = result.url; a.download = 'selfmade-ad.png'; a.target = '_blank'; a.click() } }

  // ── Mello drives the canvas ── she calls create_ad → the server emits a `creation` event →
  // this maps it onto the canvas and runs the SAME generate()/applyEditWith() the buttons use.
  // Reassigned every render so it always sees the latest brand/photo/result state.
  creationRef.current = (ev: CreationEvent) => {
    setErr(null)
    if (ev.kind === 'tweak') {
      const instr = (ev.instruction || '').trim()
      if (!instr) { setErr('Tell me what to change and I’ll tweak the image.'); return }
      if (!result) { setErr('Make or open an ad first, then I can tweak it.'); return }
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
      applyEditWith(instr)
      return
    }
    // Resolve which brand to use (named → matched, else current, else first).
    let b: Brand | undefined
    if (ev.brand_name) { const q = ev.brand_name.toLowerCase(); b = brands.find(x => x.name.toLowerCase().includes(q)) }
    b = b || brands.find(x => x.id === brandId) || brands[0]
    const ov: GenOverride = {}
    if (b) {
      pickBrand(b)
      const k = b.brand_kit || {}
      ov.brandId = b.id; ov.brandName = b.name; ov.brandType = b.brand_type
      ov.kit = { colors: k.colors || [], fonts: k.fonts || null, logo: k.logo || null, palette: k.palette || null }
      ov.productImages = (b.products || []).flatMap(p => p.image_urls || []).slice(0, 2)
    }
    if (ev.angle) { ov.angle = ev.angle; setAngle(ev.angle) }
    if (ev.headline) { ov.headline = ev.headline; setHeadline(ev.headline) }
    if (ev.niche) { ov.niche = ev.niche; setNiche(ev.niche) }
    if (ev.kind === 'remake') {
      const sid = ev.source_ad_id || source?.adId
      if (!sid) { setErr('Tell me which ad to remake, or open one first.'); return }
      const src = { adId: sid, img: source?.adId === sid ? (source?.img ?? null) : null, brand: b?.name || null }
      ov.mode = 'remake'; ov.source = src; ov.aspect = 'original'
      setMode('remake'); setSource(src); setAspect('original')
    } else {
      ov.mode = 'fresh'; setMode('fresh')
    }
    // Video remakes collect the product photo inside the guided video flow — don't block them here.
    const videoRemake = ov.mode === 'remake' && isVideo
    if (!videoRemake && (!ov.productImages || !ov.productImages.length)) { setErr('Add a product photo on the right (analyze your site or upload) and I’ll generate.'); return }
    generate(ov)
  }

  const kitReady = kit.colors.length > 0 || kit.logo || kit.palette
  const remake = mode === 'remake'

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* ── LEFT · Mello ── */}
      <div style={{ width: 360, flexShrink: 0, borderRight: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 18px', borderBottom: `1px solid ${LINE}` }}>
          <MelloFace size={30} />
          <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Mello</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
          {chat.messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 14, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '88%', fontSize: 13.5, lineHeight: 1.6, padding: '10px 13px', borderRadius: 14, background: m.role === 'user' ? FOREST : '#f2f5f0', color: m.role === 'user' ? '#eef5eb' : INK, whiteSpace: 'pre-wrap' }}>
                {m.content || (m.streaming ? <span style={{ opacity: .6 }}>…</span> : '')}
                {m.error && <span style={{ color: '#d64545' }}>{m.error}</span>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: '#f6f8f5', border: `1px solid ${LINE}`, borderRadius: 14, padding: '8px 10px' }}>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} placeholder="Ask Mello…" style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: INK, fontFamily: 'inherit', maxHeight: 120 }} />
            <button onClick={send} disabled={!draft.trim() || chat.streaming} style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: draft.trim() ? FOREST : '#dfe4de', color: draft.trim() ? LIME : '#9aa79a', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}><ArrowUp size={16} /></button>
          </div>
        </div>
      </div>

      {/* ── RIGHT · the canvas ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#fbfcfa' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '26px 26px 90px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: INK }}>{remake ? 'Remake this winner' : 'Create an ad'}</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 3, marginBottom: 20 }}>{remake ? 'Their proven ad, rebuilt around your product.' : 'The more Mello knows about your brand, the better the ad. Start with your website.'}</div>

          {/* ── REMAKE: the competitor's winner, shown FIRST ── */}
          {remake && (
            <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', marginBottom: 24, flexWrap: 'wrap' }}>
              <div style={{ width: 220 }}>
                <div style={label}><Trophy size={12} style={{ verticalAlign: -1, marginRight: 4 }} />The winner</div>
                <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#0d120e', aspectRatio: '4/5' }}>
                  {isVideo && vidUrl && winnerPlaying
                    ? <video src={vidUrl} poster={source?.img || undefined} autoPlay controls playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : source?.img
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={source.img} alt="competitor ad" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#6b7d6e', fontSize: 12, textAlign: 'center', padding: 16 }}>{source?.brand || 'Competitor'} ad</div>}
                  {/* lime play button (same as Discovery) — click to play the winner inline */}
                  {isVideo && !winnerPlaying && (
                    <button onClick={() => vidUrl && setWinnerPlaying(true)} aria-label="Play the winning ad"
                      title={vidUrl ? 'Play' : 'Preview unavailable'} disabled={!vidUrl}
                      style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', border: 'none', background: 'rgba(0,0,0,0.15)', cursor: vidUrl ? 'pointer' : 'default' }}>
                      <span style={{ width: 46, height: 46, borderRadius: '50%', background: LIME, display: 'grid', placeItems: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
                        <Play size={20} color={FOREST} fill={FOREST} style={{ marginLeft: 2 }} />
                      </span>
                    </button>
                  )}
                </div>
              </div>
              <div style={{ width: 220 }}>
                <div style={label}>Your version</div>
                <div style={{ borderRadius: 14, border: `1.5px solid ${LINE}`, background: '#0d120e', aspectRatio: '4/5', overflow: 'hidden', display: busy ? 'block' : 'grid', placeItems: 'center', color: MUTED, fontSize: 12, textAlign: 'center', padding: result && !busy ? 0 : 16 }}>
                  {isVideo ? 'Approve the script, then your video renders — it also lands in My Creatives.' : busy
                    ? <Working tone="forest" lines={remake
                        ? ['studying the reference ad', 'grounding on your product & logo', 'building your version']
                        : ['reading your product', 'sketching the concept', 'building your ad']} />
                    : result ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={result.url} alt="your version" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : 'Appears here after Remake'}
                </div>
              </div>
            </div>
          )}

          {/* Brand */}
          <div style={{ marginBottom: 20 }}>
            <div style={label}>Your brand</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: brands.length ? 12 : 0 }}>
              {brands.map(b => (
                <button key={b.id} onClick={() => pickBrand(b)} style={{ border: `1.5px solid ${bmode === 'pick' && brandId === b.id ? GREEN : LINE}`, background: bmode === 'pick' && brandId === b.id ? '#f4fbe6' : '#fff', color: INK, borderRadius: 100, padding: '7px 14px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer' }}>{b.name}</button>
              ))}
              <button onClick={newBrand} style={{ border: `1.5px dashed ${bmode === 'new' ? GREEN : LINE}`, background: bmode === 'new' ? '#f4fbe6' : '#fff', color: bmode === 'new' ? GREEN : MUTED, borderRadius: 100, padding: '7px 14px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Plus size={13} /> New brand</button>
            </div>
            {bmode === 'new' && <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Brand name" style={{ ...field, maxWidth: 320, marginBottom: 10 }} />}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
                <Globe size={15} color={MUTED} style={{ position: 'absolute', left: 12, top: 12 }} />
                <input value={website} onChange={e => setWebsite(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') analyze() }} placeholder="yourbrand.com — I’ll pull your colors, logo & products" style={{ ...field, paddingLeft: 34 }} />
              </div>
              <button onClick={analyze} disabled={detecting || !website.trim()} style={{ background: FOREST, color: LIME, border: 'none', borderRadius: 10, padding: '11px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>{detecting ? <><Loader2 size={14} className="spin" /> Analyzing…</> : 'Analyze site'}</button>
            </div>
            {kitReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 12, color: MUTED, fontWeight: 600 }}>
                <Check size={14} color={GREEN} /> Brand kit loaded
                <span style={{ display: 'inline-flex', gap: 4 }}>{(kit.colors || []).slice(0, 5).map((c, i) => <span key={i} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid rgba(0,0,0,.08)' }} />)}</span>
                {kit.logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={kit.logo} alt="logo" style={{ height: 18, borderRadius: 3 }} />}
              </div>
            )}
          </div>

          {/* product photos */}
          <div style={{ marginBottom: 20 }}>
            <div style={label}>Your product photos <span style={{ color: '#aab0a6', fontWeight: 600 }}>· pick up to 4</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(82px, 1fr))', gap: 9 }}>
              {photos.map(p => {
                const on = selected.includes(p.id)
                return (
                  <button key={p.id} onClick={() => toggle(p.id)} style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: `2px solid ${on ? GREEN : LINE}`, background: '#fff', cursor: 'pointer', padding: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {on && <span style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', background: GREEN, color: '#fff', display: 'grid', placeItems: 'center' }}><Check size={13} /></span>}
                  </button>
                )
              })}
              <button onClick={() => fileRef.current?.click()} style={{ aspectRatio: '1', borderRadius: 12, border: `2px dashed ${LINE}`, background: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', color: MUTED }}>
                <span style={{ display: 'grid', placeItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, justifyItems: 'center' }}><Upload size={16} />Upload</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => onUpload(e.target.files)} />
            {photos.length === 0 && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>Analyze your site above, or upload product photos.</div>}
          </div>

          {/* angle + niche (fresh only) */}
          {!remake && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div><div style={label}>Angle</div><input value={angle} onChange={e => setAngle(e.target.value)} placeholder="e.g. founder story, problem/solution" style={field} /></div>
              <div><div style={label}>Niche</div>
                <select value={niche} onChange={e => setNiche(e.target.value)} style={{ ...field, appearance: 'auto' as any }}>
                  <option value="">Auto-detect</option>
                  {niches.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}
          <div style={{ marginBottom: 20 }}><div style={label}>Headline <span style={{ color: '#aab0a6', fontWeight: 600 }}>· optional</span></div>
            <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder={remake ? 'Keep theirs, or write your own' : 'Leave blank and Mello writes it'} style={field} />
          </div>

          {/* aspect */}
          <div style={{ marginBottom: 22 }}>
            <div style={label}>Format</div>
            <div style={{ display: 'inline-flex', background: '#eef2ec', borderRadius: 100, padding: 3, flexWrap: 'wrap' }}>
              {(remake ? ['original', '4:5', '1:1', '9:16', '16:9'] : ['4:5', '1:1', '9:16', '16:9']).map(a => (
                <button key={a} onClick={() => setAspect(a as any)} style={{ border: 'none', borderRadius: 100, padding: '7px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer', background: aspect === a ? '#fff' : 'transparent', color: aspect === a ? INK : MUTED }}>{a === 'original' ? 'Match theirs' : a}</button>
              ))}
            </div>
          </div>

          {/* Look · Quality · Versions — the rest of the old image modal, inline. Image flows only. */}
          {!(remake && isVideo) && (
            <>
              {remake && (
                <div style={{ marginBottom: 20 }}>
                  <div style={label}>If the ad shows a person</div>
                  <div style={{ fontSize: 11.5, color: MUTED, margin: '2px 0 8px' }}>Recast them for your audience — or keep the original casting.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {['match', 'Pakistani', 'Indian', 'Arab', 'East Asian', 'Black', 'White', 'Hispanic'].map(l => (
                      <button key={l} onClick={() => setLook(l)} style={{ border: `1.5px solid ${look === l ? GREEN : LINE}`, background: look === l ? '#f2f8ea' : '#fff', color: look === l ? INK : MUTED, borderRadius: 100, padding: '7px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{l === 'match' ? 'Keep original' : l}</button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, marginBottom: 22 }}>
                <div>
                  <div style={label}>Quality</div>
                  <div style={{ display: 'inline-flex', background: '#eef2ec', borderRadius: 100, padding: 3 }}>
                    {(['2K', '4K'] as const).map(q => (
                      <button key={q} onClick={() => setImgQuality(q)} style={{ border: 'none', borderRadius: 100, padding: '7px 15px', fontSize: 12, fontWeight: 800, cursor: 'pointer', background: imgQuality === q ? '#fff' : 'transparent', color: imgQuality === q ? INK : MUTED }}>{q}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 5 }}>{imgQuality === '4K' ? 'Sharper — 25 credits each' : 'Standard — 15 credits each'}</div>
                </div>

                <div>
                  <div style={label}>Versions</div>
                  <div style={{ display: 'inline-flex', background: '#eef2ec', borderRadius: 100, padding: 3 }}>
                    {[1, 2, 4, 6, 8].map(n => (
                      <button key={n} onClick={() => setVariantCount(n)} style={{ border: 'none', borderRadius: 100, padding: '7px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer', background: variantCount === n ? '#fff' : 'transparent', color: variantCount === n ? INK : MUTED }}>{n}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 5 }}>{variantCount === 1 ? 'One design' : `${variantCount} designs to pick from`}</div>
                </div>
              </div>
            </>
          )}

          {/* video remake → the inline video flow (language · voice · free script · render), no modal */}
          {remake && isVideo && source?.adId && (
            <InlineVideoRemake
              sourceAdId={source.adId} sourceVideoUrl={vidUrl || undefined} sourcePoster={source.img || undefined}
              brandId={brandId || undefined} brandType={brands.find(b => b.id === brandId)?.brand_type}
              productImages={photos.filter(p => selected.includes(p.id)).map(p => p.src)} brandName={brandName || undefined}
              onDone={() => fetch('/api/creatives').then(r => r.json()).then(j => setWork((j.creatives || []).filter((c: any) => c.media_type !== 'video' && c.status === 'done' && c.image_url).slice(0, 14))).catch(() => {})}
            />
          )}

          {/* generate (image fresh + image remake) */}
          {!result && !(remake && isVideo) && (
            <button onClick={() => generate()} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: busy ? '#dfe4de' : LIME, color: FOREST, border: 'none', borderRadius: 100, padding: '14px 28px', fontSize: 15, fontWeight: 850, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? <><Loader2 size={17} className="spin" /> {remake ? 'Rebuilding… ~40s' : 'Designing… ~30s'}</> : <><Wand2 size={17} /> {remake ? 'Remake this' : 'Create ad'} · {cost} credits</>}
            </button>
          )}
          {err && <div style={{ marginTop: 12, fontSize: 13, color: '#b42318', background: '#fef2f2', border: '1px solid #fecdca', borderRadius: 10, padding: '9px 12px', maxWidth: 460 }}>{err}</div>}

          {/* result actions (image shown in the two-col above for remake; standalone for fresh) */}
          {result && (
            <div ref={resultRef} style={{ marginTop: 8, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {!remake && /* eslint-disable-next-line @next/next/no-img-element */ <img src={result.url} alt="Your ad" style={{ width: 320, maxWidth: '100%', borderRadius: 16, border: `1px solid ${LINE}`, boxShadow: '0 30px 60px -30px rgba(23,37,28,.4)', display: 'block' }} />}
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{remake ? 'Your version is ready.' : 'Here’s your ad.'}</div>
                <div style={{ fontSize: 13, color: MUTED, margin: '5px 0 16px', lineHeight: 1.55 }}>Love it? Approve and download. Want a change? Tell Mello and she’ll tweak this exact image.</div>
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                  <button onClick={download} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '11px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}><Download size={15} /> Approve &amp; download</button>
                  <button onClick={() => { setResult(null); setVersions([]); setErr(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: INK, border: `1.5px solid ${LINE}`, borderRadius: 100, padding: '11px 18px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}><ImageIcon size={15} /> Another</button>
                </div>
                <div style={{ marginTop: 18 }}>
                  <div style={label}>Tweak it</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyEdit() }} placeholder="e.g. darker background, bigger logo" style={field} />
                    <button onClick={applyEdit} disabled={editing || !editText.trim()} style={{ background: LIME, color: FOREST, border: 'none', borderRadius: 10, padding: '0 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>{editing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}{editing ? '' : 'Tweak'}</button>
                  </div>
                </div>

                {/* Versions — every tweak is a version you can revert to */}
                {versions.length > 1 && (
                  <div style={{ marginTop: 18 }}>
                    <div style={label}>Versions</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {versions.map((v, i) => (
                        <button key={i} onClick={() => setResult({ url: v.url, genId: v.genId })} title={v.kind} style={{ position: 'relative', width: 52, height: 66, borderRadius: 9, overflow: 'hidden', border: `2px solid ${result?.url === v.url ? GREEN : LINE}`, background: '#0d120e', cursor: 'pointer', padding: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={v.url} alt={`v${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 8.5, fontWeight: 800, color: '#fff', background: 'rgba(8,12,9,.6)', padding: '1px 0', textAlign: 'center' }}>v{i + 1}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Click a version to bring it back — the newest is your current.</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── MY WORK — recent creations; click to reopen, tweak, or download ── */}
          {work.length > 0 && (
            <div style={{ marginTop: 40, borderTop: `1px solid ${LINE}`, paddingTop: 22 }}>
              <div style={label}>My recent work</div>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                {work.map(c => (
                  <button key={c.id} onClick={() => openWork(c)} title="Open" style={{ flexShrink: 0, width: 96, aspectRatio: '4/5', borderRadius: 12, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#0d120e', cursor: 'pointer', padding: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.image_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

export default function StudioPage() {
  return <Suspense fallback={null}><StudioInner /></Suspense>
}
