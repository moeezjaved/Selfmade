'use client'
/**
 * My Creatives — the hub for everything the user generates.
 *  • Generations tab: gallery of saved clones/edits/inspired ads → open any to re-edit (credits),
 *    download, or delete.
 *  • Brands tab: view/edit/delete the brands that feed Clone & Script (name, site, voice, products),
 *    with the plan's brand-slot quota and add-brand (URL auto-detect / manual).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useIsMobile } from '@/lib/useIsMobile'
import { Sparkles, Store, Download, Trash2, Loader2, X, Pencil, Plus, Link2, Upload, Wand2 } from 'lucide-react'
import { creativeFilename } from '@/lib/filename'
import { refreshCredits } from '@/components/credits/CreditCounter'
import StudioModal from '../discovery/StudioModal'

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })
}

const DARK = '#1a3a1a', LIME = '#dffe95'
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: 'none', background: DARK, color: LIME, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
const btnGhost: React.CSSProperties = { ...btn, background: '#fff', color: DARK, border: '1px solid #cbd5cb' }
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#111', outline: 'none' }

type Gen = { id: string; image_url: string | null; type: string; tier: string; prompt?: string | null; brand_name?: string | null; source_ad_id?: string | null; source_thumb?: string | null; source_video_url?: string | null; media_type?: string; status?: string; created_at: string }
type Product = { id: string; name?: string | null; image_urls?: string[] }
type BrandKit = { colors?: string[]; extraColors?: string[]; palette?: Record<string, string>; fonts?: { heading?: string | null; body?: string | null; headingWeight?: string | null; bodyWeight?: string | null }; logo?: string | null }
type Brand = { id: string; name: string; website?: string | null; tone?: string | null; usps?: string[]; products?: Product[]; brand_kit?: BrandKit }

export default function MyCreativesPage() {
  return <Suspense fallback={null}><MyCreativesInner /></Suspense>
}

function MyCreativesInner() {
  const [tab, setTab] = useState<'generations' | 'brands'>('generations')
  const [studio, setStudio] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const params = useSearchParams()
  const router = useRouter()

  // Deep-link from the "Create Ad" sidebar item (/creative-studio?studio=1) opens the modal.
  useEffect(() => {
    if (params.get('studio')) { setStudio(true); router.replace('/creative-studio') }
  }, [params, router])

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111', margin: 0 }}>My Creatives</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Every ad you generate lives here — re-edit, download, and manage the brands behind them.</p>
        </div>
        <button onClick={() => setStudio(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 11, border: 'none', background: DARK, color: LIME, fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <Wand2 size={16} /> Create new ad
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #dde7dd' }}>
        <Tab on={tab === 'generations'} onClick={() => setTab('generations')}><Sparkles size={15} /> Generations</Tab>
        <Tab on={tab === 'brands'} onClick={() => setTab('brands')}><Store size={15} /> Brands</Tab>
      </div>
      {tab === 'generations' ? <Generations key={reloadKey} /> : <Brands />}
      {studio && <StudioModal onClose={() => { setStudio(false); setReloadKey(k => k + 1); setTab('generations') }} />}
    </div>
  )
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', border: 'none', background: 'transparent', borderBottom: on ? `2px solid ${DARK}` : '2px solid transparent', color: on ? '#111' : '#6b7280', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
      {children}
    </button>
  )
}

/* ───────────────────────── Generations gallery ───────────────────────── */
function Generations() {
  const [gens, setGens] = useState<Gen[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'clone' | 'edit' | 'inspired'>('all')
  const [open, setOpen] = useState<Gen | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/creatives')
    const j = await r.json()
    setGens(j.creatives || [])
  }, [])
  useEffect(() => { load() }, [load])

  // Poll any in-flight jobs until they finish, then refresh the gallery. Image clones and
  // animate/video jobs live on different status endpoints — pick by media_type.
  useEffect(() => {
    const processing = (gens || []).filter((g) => g.status === 'processing')
    if (processing.length === 0) return
    const t = setInterval(async () => {
      let anyDone = false
      await Promise.all(processing.map(async (g) => {
        const endpoint = g.media_type === 'image' ? 'clone-image' : 'animate'
        const r = await fetch(`/api/discovery/${endpoint}/status?id=${g.id}`).then((x) => x.json()).catch(() => ({}))
        if (r.done || r.failed) anyDone = true
      }))
      if (anyDone) load()
    }, 8000)
    return () => clearInterval(t)
  }, [gens, load])

  const shown = (gens || []).filter((g) => filter === 'all' || g.type === filter)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'clone', 'edit', 'inspired'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${filter === f ? DARK : '#cbd5cb'}`, background: filter === f ? DARK : '#fff', color: filter === f ? LIME : '#374151', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{f === 'clone' ? 'remake' : f}</button>
        ))}
      </div>

      {gens === null ? <div style={{ color: '#9ca3af' }}>Loading…</div>
        : shown.length === 0 ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            No creatives yet. Open <b style={{ color: DARK }}>Discovery</b>, hover any ad and hit <b style={{ color: DARK }}>Remake ad</b> — it’ll show up here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px,100%), 1fr))', gap: 14 }}>
            {shown.map((g) => (
              <div key={g.id} style={card}>
                <button onClick={() => g.status !== 'processing' && g.image_url && setOpen(g)} style={{ display: 'block', width: '100%', border: 'none', padding: 0, cursor: g.status === 'processing' || !g.image_url ? 'default' : 'pointer', background: '#0d120e', aspectRatio: '1', overflow: 'hidden', position: 'relative' }}>
                  {g.status === 'processing' ? (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', color: LIME, fontSize: 12, fontWeight: 600 }}><Loader2 size={20} className="spin" /> Generating {g.media_type === 'video' ? 'video' : 'ad'}…</div>
                  ) : !g.image_url ? (
                    // Draft / failed video jobs have no rendered file (e.g. approval never happened for
                    // lack of credits) — show an honest state tile, never an empty black <video>.
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', justifyContent: 'center', color: '#9fb0a4', fontSize: 12, fontWeight: 600, padding: 12, textAlign: 'center' }}>
                      {g.status === 'failed'
                        ? <><span style={{ fontSize: 20 }}>⚠️</span> Failed — credits refunded</>
                        : <><span style={{ fontSize: 20 }}>📝</span> Draft — not generated yet<span style={{ fontWeight: 400, fontSize: 11, color: '#6f7f73' }}>Open the ad in Discovery and hit Remake to finish it</span></>}
                    </div>
                  ) : g.media_type === 'video' ? (
                    <video src={g.image_url} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.image_url || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  {g.media_type === 'video' && g.status !== 'processing' && <span style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 6, fontSize: 10, fontWeight: 700, padding: '2px 6px' }}>🎬 Video</span>}
                  {/* Subtle "cloned from" chip — the competitor ad this output was cloned from, so the
                      user can eyeball source-vs-result without it dominating the card. */}
                  {g.status !== 'processing' && (g.source_thumb || g.source_video_url) && (
                    <span title="Remade from this ad" style={{ position: 'absolute', bottom: 6, left: 6, width: 34, height: 44, borderRadius: 5, overflow: 'hidden', border: '2px solid rgba(255,255,255,.82)', boxShadow: '0 2px 6px rgba(0,0,0,.45)', background: '#0d120e', opacity: 0.9 }}>
                      {g.source_thumb
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={g.source_thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <video src={g.source_video_url || ''} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 6.5, fontWeight: 800, textAlign: 'center', color: '#fff', background: 'rgba(0,0,0,.6)', letterSpacing: '.04em', padding: '1px 0' }}>SOURCE</span>
                    </span>
                  )}
                </button>
                <div style={{ padding: '9px 11px' }}>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
                    <Badge>{g.type}</Badge>{g.tier === 'pro' && <Badge tone="pro">Pro</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.brand_name || g.prompt || 'Untitled'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      {open && <GenerationModal gen={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'pro' }) {
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, textTransform: 'capitalize', background: tone === 'pro' ? DARK : '#eef5eb', color: tone === 'pro' ? LIME : '#3f6b3f' }}>{children}</span>
}

/* Full-view + re-edit (reuses the credit-charged edit endpoint; new edits are saved as generations). */
function GenerationModal({ gen, onClose, onChanged }: { gen: Gen; onClose: () => void; onChanged: () => void }) {
  const [img, setImg] = useState(gen.image_url)
  const [genId, setGenId] = useState(gen.id)
  const [instr, setInstr] = useState('')
  const tier: 'pro' = 'pro'   // Pro-only (Nano Banana Pro)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const editCost = 10   // Pro edit — matches image_edit_pro
  const isMobile = useIsMobile()
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  // Captions add-on (high-margin blade). Burns TikTok-style captions onto this finished video.
  const [capStyle, setCapStyle] = useState<'bold' | 'minimal' | 'boxed'>('bold')
  const [capLang, setCapLang] = useState('en')
  const [capColor, setCapColor] = useState('#dffe95')   // accent (highlight word, or box for 'boxed')
  const [capSize, setCapSize] = useState<'s' | 'm' | 'l'>('m')
  const [capBusy, setCapBusy] = useState(false)
  const [capErr, setCapErr] = useState<string | null>(null)
  // ── Tweak (video remakes): per-scene fixes (faithful) or whole-clip re-roll (UGC), same rail as
  // the post-render modal — so users can come back and fix a video LATER from My Creatives. ──
  const [tw, setTw] = useState<{ tweakable: boolean; ugcTweakable: boolean; scenes: { duration: number }[] } | null>(null)
  const [twSel, setTwSel] = useState<number | null>(null)
  const [twBusy, setTwBusy] = useState(false)
  const [twMsg, setTwMsg] = useState<string | null>(null)
  useEffect(() => {
    if (gen.type !== 'video_clone' || gen.media_type !== 'video' || !gen.image_url) return
    fetch(`/api/discovery/clone-video/status?id=${gen.id}`).then((r) => r.json())
      .then((st) => setTw({ tweakable: !!st.tweakable, ugcTweakable: !!st.ugcTweakable, scenes: st.tweakScenes || [] }))
      .catch(() => {})
  }, [gen.id, gen.type, gen.media_type, gen.image_url])
  const runTweak = async (body: Record<string, unknown>) => {
    if (twBusy) return
    setTwBusy(true); setTwMsg(null)
    try {
      const r = await fetch('/api/discovery/clone-video/tweak', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: gen.id, ...body }),
      }).then((x) => x.json())
      if (r.error) { setTwMsg(r.error === 'insufficient_credits' ? 'Not enough credits.' : r.error); setTwBusy(false); return }
      for (let i = 0; i < 200; i++) {
        await new Promise((res) => setTimeout(res, 4000))
        const st = await fetch(`/api/discovery/clone-video/status?id=${gen.id}`).then((x) => x.json()).catch(() => ({}))
        if (st.tweakError) { setTwMsg(`Tweak failed (${st.tweakError}) — original video untouched, charge refunded.`); break }
        if (st.status === 'done' && st.url && st.url !== img) { setImg(st.url); setTwMsg('Updated ✓'); setTwSel(null); onChanged(); break }
        if (st.status === 'done' && i > 2) { setTwMsg('Updated ✓'); setTwSel(null); break }
      }
    } catch (e: any) { setTwMsg(String(e?.message || e)) }
    setTwBusy(false)
  }
  const addCaptions = async () => {
    setCapBusy(true); setCapErr(null)
    try {
      const r = await fetch('/api/discovery/clone-video/captions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: genId, style: capStyle, captionLang: capLang, color: capColor, size: capSize }),
      })
      const j = await r.json()
      if (!r.ok || !j.jobId) { setCapErr(j.error === 'insufficient_credits' ? 'Not enough credits.' : (j.error || 'Could not start.')); setCapBusy(false); return }
      // Poll the new caption job to done, then swap the preview to the captioned version.
      for (let i = 0; i < 90; i++) {
        await new Promise((res) => setTimeout(res, 4000))
        const st = await fetch(`/api/discovery/clone-video/status?id=${j.jobId}`).then(x => x.json()).catch(() => ({}))
        if (st.status === 'done' && st.url) { setImg(st.url); setGenId(j.jobId); refreshCredits(); onChanged(); break }
        if (st.status === 'failed' || st.error) { setCapErr('Captioning failed — credits refunded.'); refreshCredits(); break }
      }
    } catch (e: any) { setCapErr(String(e?.message || e)) }
    finally { setCapBusy(false) }
  }

  // Force a real download. `<a download>` is ignored for cross-origin R2 URLs (browser just opens
  // them in a new tab), so fetch the bytes and save via an object URL instead.
  const downloadCreative = async (filename: string) => {
    if (!img || downloading) return
    setDownloading(true)
    try {
      const r = await fetch(img)
      const b = await r.blob()
      const u = URL.createObjectURL(b)
      const a = document.createElement('a'); a.href = u; a.download = filename; a.click()
      URL.revokeObjectURL(u)
    } catch { window.open(img, '_blank') }   // fallback if the fetch is blocked
    finally { setDownloading(false) }
  }
  const copyUrl = () => { if (img) { navigator.clipboard?.writeText(img); setCopied(true); setTimeout(() => setCopied(false), 1500) } }

  const applyEdit = async () => {
    if (!instr.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/edit-image', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: img, instruction: instr.trim(), tier, parentId: genId }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error === 'insufficient_credits' ? 'Not enough credits for this edit.' : j.error || 'Edit failed.'); return }
      setImg(j.image); if (j.generationId) setGenId(j.generationId); setInstr('')
      onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!confirm('Delete this creative?')) return
    await fetch(`/api/creatives?id=${gen.id}`, { method: 'DELETE' })
    onChanged(); onClose()
  }
  const isVideo = gen.media_type === 'video'

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', maxWidth: 900 }}>
        <div style={{ background: '#0d120e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative' }}>
          {isVideo
            ? <video src={img || ''} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8 }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={img || ''} alt="" style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8, opacity: busy ? 0.5 : 1 }} />}
          {busy && !isVideo && <div style={{ position: 'absolute', color: LIME, display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><Loader2 size={18} className="spin" /> Working…</div>}
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isVideo ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Your video</div>
              <button onClick={() => downloadCreative(creativeFilename({ brand: gen.brand_name, ext: 'mp4', kind: gen.type, date: new Date(gen.created_at) }))} disabled={downloading} style={{ ...btn, justifyContent: 'center' }}><Download size={15} /> {downloading ? 'Downloading…' : 'Download MP4'}</button>
              <button onClick={copyUrl} style={{ ...btnGhost, justifyContent: 'center' }}><Link2 size={15} /> {copied ? 'Copied ✓' : 'Copy URL'}</button>

              {/* ── Tweak — fix this remake later, right from My Creatives (same rail as the render
                  modal): per-scene chips for faithful, whole-clip fix chips for single-clip UGC. ── */}
              {tw && (tw.tweakable || tw.ugcTweakable) && (
                <div style={{ borderTop: '1px solid #eef2f0', marginTop: 6, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>🔧 Tweak this video</div>
                  {twBusy ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1a3a1a', fontSize: 12.5 }}><Loader2 size={14} className="spin" /> Tweaking… (~2–3 min, the video updates here)</div>
                  ) : tw.tweakable ? (<>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {tw.scenes.map((s, i) => (
                        <button key={i} onClick={() => setTwSel(twSel === i ? null : i)}
                          style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${twSel === i ? '#1a3a1a' : '#d1d5db'}`, background: twSel === i ? '#f0fdf4' : '#fff', color: '#1a3a1a' }}>
                          Scene {i + 1} · {s.duration}s
                        </button>
                      ))}
                    </div>
                    {twSel != null && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[['size', 'Product too big/small'], ['product', 'Product wrong'], ['action', 'Wrong action'], ['person', 'Person off'], ['closeup', 'Close-up'], ['redo', 'Redo']].map(([k, label]) => (
                          <button key={k} onClick={() => runTweak({ type: 'redo_scene', scene: twSel, chip: k })}
                            style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #d1d5db', background: '#fff', color: '#1a3a1a' }}>
                            {label} · 600cr
                          </button>
                        ))}
                        {tw.scenes.length > 2 && (
                          <button onClick={() => runTweak({ type: 'remove_scene', scene: twSel })}
                            style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #d1d5db', background: '#fff', color: '#15803d' }}>
                            Remove · free
                          </button>
                        )}
                      </div>
                    )}
                  </>) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[['size', 'Product too big/small'], ['product', 'Product looks wrong'], ['person', 'Person looks off'], ['action', 'Not using the product'], ['redo', 'Just re-roll it']].map(([k, label]) => (
                        <button key={k} onClick={() => runTweak({ type: 'redo_ugc', chip: k })}
                          style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid #d1d5db', background: '#fff', color: '#1a3a1a' }}>
                          {label} · 450cr
                        </button>
                      ))}
                    </div>
                  )}
                  {twMsg && <div style={{ fontSize: 11.5, color: twMsg === 'Updated ✓' ? '#15803d' : '#b91c1c' }}>{twMsg}</div>}
                </div>
              )}

              {/* Captions add-on — burn TikTok-style captions (85% of feed watches on mute). */}
              <div style={{ borderTop: '1px solid #eef2f0', marginTop: 6, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>✨ Add captions <span style={{ color: '#9ca3af', fontWeight: 500 }}>· 100 cr</span></div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['bold', 'minimal', 'boxed'] as const).map((s) => (
                    <button key={s} onClick={() => setCapStyle(s)} style={{ flex: 1, textTransform: 'capitalize', padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${capStyle === s ? '#1a3a1a' : '#d1d5db'}`, background: capStyle === s ? '#f0fdf4' : '#fff', color: '#1a3a1a' }}>{s}</button>
                  ))}
                </div>
                <select value={capLang} onChange={(e) => setCapLang(e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12.5, fontFamily: 'inherit' }}>
                  <option value="en">Captions in English</option>
                  <option value="ur">Captions in Urdu</option>
                  <option value="hi">Captions in Hindi</option>
                  <option value="ar">Captions in Arabic</option>
                </select>
                {/* Accent colour (highlighted word, or the box for 'boxed') + size. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: '#6b7280' }}>Colour</span>
                  {['#dffe95', '#ffffff', '#ffd60a', '#ff375f', '#0a84ff', '#000000'].map((c) => (
                    <button key={c} onClick={() => setCapColor(c)} title={c} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: capColor.toLowerCase() === c ? '2px solid #1a3a1a' : '1px solid #d1d5db' }} />
                  ))}
                  <input type="color" value={capColor} onChange={(e) => setCapColor(e.target.value)} title="Custom colour" style={{ width: 26, height: 26, padding: 0, border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', background: 'none' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: '#6b7280', marginRight: 2 }}>Size</span>
                  {([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setCapSize(v)} style={{ flex: 1, padding: '6px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${capSize === v ? '#1a3a1a' : '#d1d5db'}`, background: capSize === v ? '#f0fdf4' : '#fff', color: '#1a3a1a' }}>{l}</button>
                  ))}
                </div>
                {capErr && <div style={{ fontSize: 12, color: '#dc2626' }}>{capErr}</div>}
                <button onClick={addCaptions} disabled={capBusy} style={{ ...btn, justifyContent: 'center', opacity: capBusy ? 0.6 : 1 }}>
                  {capBusy ? <><Loader2 size={15} className="spin" /> Adding captions…</> : <><Sparkles size={15} /> Add captions · 100 cr</>}
                </button>
                <p style={{ fontSize: 10.5, color: '#9ca3af', margin: 0 }}>Caption language is independent of the voiceover — e.g. Urdu VO with English captions.</p>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Edit creative</div>
              <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={3}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyEdit() }}
                placeholder="Tweak this creative — headline, subhead, colors, scene, background…" style={{ ...input, resize: 'vertical' }} />
              {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>{err}</div>}
              <button onClick={applyEdit} disabled={busy || !instr.trim()} style={{ ...btn, justifyContent: 'center', opacity: (busy || !instr.trim()) ? 0.6 : 1 }}><Sparkles size={15} /> Apply edit · {editCost} cr</button>
              <button onClick={() => downloadCreative(creativeFilename({ brand: gen.brand_name, ext: (img || '').match(/\.(jpg|jpeg|webp|png)(\?|$)/i)?.[1] || 'png', kind: gen.type, date: new Date(gen.created_at) }))} disabled={downloading} style={{ ...btnGhost, justifyContent: 'center' }}><Download size={15} /> {downloading ? 'Downloading…' : 'Download'}</button>
              <button onClick={copyUrl} style={{ ...btnGhost, justifyContent: 'center' }}><Link2 size={15} /> {copied ? 'Copied ✓' : 'Copy URL'}</button>
            </>
          )}
          {(gen.source_thumb || gen.source_video_url) && (
            <a href={gen.source_ad_id ? `/discovery/${gen.source_ad_id}` : undefined} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', padding: 8, border: '1px solid #e2e8f0', borderRadius: 9 }}>
              <span style={{ width: 34, height: 44, borderRadius: 5, overflow: 'hidden', flexShrink: 0, background: '#0d120e', display: 'block' }}>
                {gen.source_thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={gen.source_thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <video src={gen.source_video_url || ''} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </span>
              <span style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}><b style={{ color: '#374151' }}>Remade from</b><br />the original ad{gen.source_ad_id ? ' →' : ''}</span>
            </a>
          )}
          <button onClick={del} style={{ ...btnGhost, justifyContent: 'center', color: '#b91c1c', borderColor: '#f0c4c4' }}><Trash2 size={15} /> Delete</button>
        </div>
      </div>
    </Overlay>
  )
}

/* ───────────────────────── Brands manager ───────────────────────── */
function Brands() {
  const [brands, setBrands] = useState<Brand[] | null>(null)
  const [edit, setEdit] = useState<Brand | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/brands')
    const j = await r.json()
    setBrands(j.brands || [])
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (id: string) => {
    if (!confirm('Delete this brand and its products?')) return
    await fetch(`/api/brands/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Brands feed Remake & Script — voice, USPs, and product photos. Slots are set by your plan.</div>
        <button onClick={() => setAdding(true)} style={btn}><Plus size={15} /> Add brand</button>
      </div>
      {brands === null ? <div style={{ color: '#9ca3af' }}>Loading…</div>
        : brands.length === 0 ? <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9ca3af' }}>No brands yet. Add one to start remaking ads with your product.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px,100%), 1fr))', gap: 14 }}>
              {brands.map((b) => {
                const imgs = (b.products || []).flatMap((p) => p.image_urls || []).slice(0, 4)
                return (
                  <div key={b.id} style={{ ...card, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>{b.name}</div>
                        {b.website && <div style={{ fontSize: 12, color: '#6b7280' }}>{b.website}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEdit(b)} title="Edit" style={{ ...btnGhost, padding: 7 }}><Pencil size={14} /></button>
                        <button onClick={() => del(b.id)} title="Delete" style={{ ...btnGhost, padding: 7, color: '#b91c1c', borderColor: '#f0c4c4' }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                      {imgs.length ? imgs.map((u, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={u} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                      )) : <div style={{ fontSize: 12, color: '#9ca3af' }}>No product photos yet</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      {edit && <BrandModal brand={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {adding && <AddBrandModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
    </div>
  )
}

function BrandModal({ brand, onClose, onSaved }: { brand: Brand; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(brand.name)
  const [website, setWebsite] = useState(brand.website || '')
  const [tone, setTone] = useState(brand.tone || '')
  const [usps, setUsps] = useState((brand.usps || []).join(', '))
  const [palette, setPalette] = useState<Record<string, string>>({ ...(brand.brand_kit?.palette || {}) })
  const [extra, setExtra] = useState<string[]>(brand.brand_kit?.extraColors || [])
  const [hFont, setHFont] = useState(brand.brand_kit?.fonts?.heading || '')
  const [hWeight, setHWeight] = useState(brand.brand_kit?.fonts?.headingWeight || '700')
  const [bFont, setBFont] = useState(brand.brand_kit?.fonts?.body || '')
  const [bWeight, setBWeight] = useState(brand.brand_kit?.fonts?.bodyWeight || '400')
  const [logo, setLogo] = useState(brand.brand_kit?.logo || '')
  const [photos, setPhotos] = useState<string[]>((brand.products || []).flatMap((p) => p.image_urls || []))
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoMsg, setPhotoMsg] = useState<string | null>(null)
  const [detectSite, setDetectSite] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const flatColors = Array.from(new Set([...Object.values(palette).filter(Boolean), ...extra]))
  const save = async () => {
    setBusy(true)
    await fetch(`/api/brands/${brand.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name, website, tone, usps: usps.split(',').map((s) => s.trim()).filter(Boolean),
        brand_kit: {
          palette, extraColors: extra, colors: flatColors, logo: logo || null,
          fonts: { heading: hFont || null, headingWeight: hWeight, body: bFont || null, bodyWeight: bWeight },
        },
      }),
    })
    setBusy(false); onSaved()
  }

  const addPhotos = async (images: string[]): Promise<string[]> => {
    if (!images.length) return photos
    setPhotoBusy(true)
    const r = await fetch(`/api/brands/${brand.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resource: 'photos', images }) })
    const j = await r.json()
    const merged = Array.isArray(j.image_urls) ? j.image_urls : photos
    setPhotos(merged); setPhotoBusy(false)
    return merged
  }
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    addPhotos(await Promise.all(Array.from(files).slice(0, 8).map(fileToDataUrl)))
  }
  const badFont = (v: string) => v.includes('(') || v.startsWith('--')
  const detect = async () => {
    const site = (detectSite.trim() || website.trim())
    if (!site) return
    setPhotoBusy(true); setPhotoMsg(null)
    try {
      const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: site }) })
      const j = await r.json()
      if (!r.ok) { setPhotoMsg(j.error || 'Could not read that site.'); return }
      // Refresh the kit: fill empty fields; also overwrite a font that leaked as a CSS var(...).
      if (j.palette && Object.keys(palette).length === 0) setPalette(j.palette)
      if (j.fonts?.heading && (!hFont.trim() || badFont(hFont))) setHFont(j.fonts.heading)
      if (j.fonts?.body && (!bFont.trim() || badFont(bFont))) setBFont(j.fonts.body)
      if (j.logo && !logo.trim()) setLogo(j.logo)
      // Accurate product shots first (Shopify /products.json), then fill with the rest of the images.
      const prod = Array.from(new Set([...(j.productImages || []), ...(j.images || [])]))
      const found = prod.length
      const before = photos.length
      const merged = found ? await addPhotos(prod.slice(0, 24)) : photos
      const added = Math.max(0, merged.length - before)
      setPhotoMsg(found === 0 ? 'No product images found on that page.'
        : added > 0 ? `Added ${added} new photo${added > 1 ? 's' : ''} (${found} found).`
        : `No new photos — the ${found} found are already saved.`)
    } finally { setPhotoBusy(false); setDetectSite('') }
  }
  const removePhoto = async (url: string) => {
    setPhotos((p) => p.filter((u) => u !== url))
    await fetch(`/api/brands/${brand.id}?photoUrl=${encodeURIComponent(url)}`, { method: 'DELETE' })
  }

  // Auto-detect + PERSIST the brand kit the first time a brand with a website has no colors yet, so it
  // never opens empty and survives reopen even if the user forgets to hit Save.
  useEffect(() => {
    const site = (brand.website || '').trim()
    if (!site || Object.keys(palette).length > 0) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: site }) })
        const j = await r.json()
        if (!r.ok || cancelled) return
        const nextPalette = j.palette && Object.keys(j.palette).length ? j.palette : palette
        const nextH = j.fonts?.heading || hFont
        const nextB = j.fonts?.body || bFont
        const nextLogo = logo || j.logo || ''
        setPalette(nextPalette); if (j.fonts?.heading) setHFont(nextH); if (j.fonts?.body) setBFont(nextB); if (!logo && j.logo) setLogo(nextLogo)
        // Persist immediately so a reopen shows it.
        await fetch(`/api/brands/${brand.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ brand_kit: {
            palette: nextPalette, extraColors: extra,
            colors: Array.from(new Set([...Object.values(nextPalette).filter(Boolean) as string[], ...extra])),
            fonts: { heading: nextH || null, headingWeight: hWeight, body: nextB || null, bodyWeight: bWeight },
            logo: nextLogo || null,
          } }),
        })
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 22, width: 480, maxWidth: '92vw', maxHeight: '88vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#111' }}>Edit brand</div>
        <Field label="Brand name"><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></Field>
        <Field label="Website"><input value={website} onChange={(e) => setWebsite(e.target.value)} style={input} /></Field>
        <Field label="Voice / tone"><input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. bold, playful, premium" style={input} /></Field>
        <Field label="USPs (comma-separated)"><input value={usps} onChange={(e) => setUsps(e.target.value)} placeholder="fast shipping, 30-day guarantee" style={input} /></Field>

        {/* Brand Kit — named color roles + typography, applied to every generated ad. */}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginTop: 4 }}>🎨 Brand kit — colors</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([['background', 'Background'], ['accent', 'Accent'], ['heading', 'Heading'], ['body', 'Body'], ['icon', 'Icon'], ['cta', 'CTA'], ['ctaText', 'CTA text']] as const).map(([key, label]) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>{label}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={palette[key] || '#ffffff'} onChange={(e) => setPalette((p) => ({ ...p, [key]: e.target.value }))} style={{ width: 34, height: 34, border: '1px solid #e2e8f0', borderRadius: 8, padding: 0, cursor: 'pointer', flexShrink: 0 }} />
                <input value={palette[key] || ''} onChange={(e) => setPalette((p) => ({ ...p, [key]: e.target.value }))} placeholder="#000000" style={{ ...input, flex: 1, fontSize: 12, padding: '7px 8px' }} />
              </div>
            </div>
          ))}
        </div>
        <Field label="Extra colors">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {extra.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f5f8f2', borderRadius: 8, padding: '3px 6px', fontSize: 11 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid #e2e8f0' }} />{c}
                <button onClick={() => setExtra((e) => e.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 0 }}><X size={11} /></button>
              </span>
            ))}
            <input type="color" onChange={(e) => setExtra((x) => Array.from(new Set([...x, e.target.value])))} style={{ width: 30, height: 30, border: '1px dashed #cbd5cb', borderRadius: 8, padding: 0, cursor: 'pointer' }} title="Add color" />
          </div>
        </Field>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginTop: 4 }}>Typography</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Heading font">
            <input value={hFont} onChange={(e) => setHFont(e.target.value)} placeholder="Plus Jakarta Sans" style={input} />
            <select value={hWeight} onChange={(e) => setHWeight(e.target.value)} style={{ ...input, marginTop: 6 }}>{['300', '400', '500', '600', '700', '800', '900'].map((w) => <option key={w} value={w}>Weight {w}</option>)}</select>
          </Field>
          <Field label="Body font">
            <input value={bFont} onChange={(e) => setBFont(e.target.value)} placeholder="Open Sans" style={input} />
            <select value={bWeight} onChange={(e) => setBWeight(e.target.value)} style={{ ...input, marginTop: 6 }}>{['300', '400', '500', '600', '700'].map((w) => <option key={w} value={w}>Weight {w}</option>)}</select>
          </Field>
        </div>
        <Field label="Logo URL (used as the brand mark in ads)">
          <input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" style={input} />
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="logo" style={{ height: 28, maxWidth: 140, objectFit: 'contain', marginTop: 8, background: '#f8fafc', borderRadius: 6, padding: 3, border: '1px solid #e2e8f0' }} />
          )}
        </Field>

        <Field label="Product photos">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((u) => (
              <div key={u} style={{ position: 'relative', width: 64, height: 64 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" style={{ width: '100%', height: '100%', borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                <button onClick={() => removePhoto(u)} title="Remove" style={{ position: 'absolute', top: -6, right: -6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b91c1c' }}><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} disabled={photoBusy} style={{ width: 64, height: 64, borderRadius: 8, border: '2px dashed #cbd5cb', background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: '#6b7280', fontSize: 10 }}>
              {photoBusy ? <Loader2 size={16} className="spin" /> : <><Upload size={15} /> Add</>}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={detectSite} onChange={(e) => setDetectSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} placeholder="…or detect from a website URL (blank = brand site)" style={{ ...input, flex: 1 }} />
            <button onClick={detect} disabled={photoBusy} style={btnGhost}>{photoBusy ? <Loader2 size={13} className="spin" /> : <Link2 size={14} />} Detect</button>
          </div>
          {photoMsg && <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 6 }}>{photoMsg}</div>}
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={save} disabled={busy || !name.trim()} style={{ ...btn, flex: 1, justifyContent: 'center', opacity: (busy || !name.trim()) ? 0.6 : 1 }}>{busy ? <Loader2 size={15} className="spin" /> : 'Save changes'}</button>
          <button onClick={onClose} style={btnGhost}>Done</button>
        </div>
      </div>
    </Overlay>
  )
}

function AddBrandModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [imgs, setImgs] = useState<string[]>([])
  const [kit, setKit] = useState<BrandKit>({})
  const [detecting, setDetecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const detect = async () => {
    if (!website.trim()) return
    setDetecting(true); setErr(null)
    try {
      const r = await fetch('/api/discovery/detect-product', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: website.trim() }) })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Could not read that site.'); return }
      if (j.brandName && !name.trim()) setName(j.brandName)
      setImgs(Array.from(new Set([...(j.productImages || []), ...(j.images || [])])).slice(0, 24))
      setKit({ colors: j.colors || [], fonts: j.fonts || {}, logo: j.logo || null, palette: j.palette || {} } as any)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setDetecting(false) }
  }
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), website: website.trim() || null, product_images: imgs, brand_kit: kit }) })
      const j = await r.json()
      if (r.status === 402 && j.error === 'brand_limit_reached') { setErr(`You've used all ${j.limit} brand slots on your plan. Upgrade to add more.`); return }
      if (!r.ok) { setErr(j.error || 'Could not save brand.'); return }
      onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 22, width: 460, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#111' }}>Add a brand</div>
        <Field label="Website (we’ll auto-detect your product)">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && detect()} placeholder="yourstore.com" style={{ ...input, flex: 1 }} />
            <button onClick={detect} disabled={detecting || !website.trim()} style={btnGhost}>{detecting ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Detect</button>
          </div>
        </Field>
        <Field label="Brand name"><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></Field>
        {imgs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {imgs.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
            ))}
          </div>
        )}
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={save} disabled={busy || !name.trim()} style={{ ...btn, flex: 1, justifyContent: 'center', opacity: (busy || !name.trim()) ? 0.6 : 1 }}>{busy ? <Loader2 size={15} className="spin" /> : 'Save brand'}</button>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
        </div>
      </div>
    </Overlay>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><div style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginBottom: 5 }}>{label}</div>{children}</label>
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', overflowY: 'auto', maxHeight: '92vh', maxWidth: '100%', position: 'relative', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, zIndex: 3, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        {children}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
