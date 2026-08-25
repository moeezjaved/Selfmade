'use client'

/**
 * Storyboard-before-generation (Phase 2). Renders a job's analysis (beat_sheet + script) as editable
 * scene cards BEFORE Seedance runs. On a 'review' job, editing the script + hitting Generate approves
 * it (spends credits, worker generates only the approved plan). Read-only for already-generated jobs.
 */
import React, { useEffect, useRef, useState } from 'react'

type Scene = { index: number; role: string; time: string | null; action: string; scriptLine: string; thumb?: string | null; preview?: string | null; preview_source?: string | null; shows?: string | null }
type Board = {
  jobId: string; status: string; editable: boolean; hookType: string | null; suggestedMode: string
  sceneCount: number; durationSeconds: number | null; script: string; scenes: Scene[]
  castSheet?: string | null; characterLook?: string | null
  cast?: { id: string; look: string; sheet: string | null }[]
  heroProduct?: string | null; rejectedProduct?: string | null
  userAssets?: { locations: Asset[]; props: Asset[] }
}
type Asset = { id: string; label: string; url: string }

const ROLE_LABEL: Record<string, string> = { hook: 'Hook', body: 'Body', cta: 'CTA' }

export default function Storyboard({ jobId, embedded, mode, maxScenes, resyncScript, resyncKey, onScript, onSceneCount }: {
  jobId?: string
  /** Embedded in the remake modal: hide the title + own Approve button (the modal's Create button drives). */
  embedded?: boolean
  /** 'ugc' | 'cinematic' — for UGC the keyframes DON'T drive the render (Seedance generates the creator
   * from text), so we skip generating them entirely (no wasted Pro credit) and show a script-only plan.
   * Cinematic animates the approved keyframes, so it keeps them. */
  mode?: 'ugc' | 'cinematic'
  /** Cap the scene cards to the chosen output length (~1 scene per 3s) so what's shown = what renders
   * and each scene's voiceover is a full sentence, not a fragment. Extra source scenes are dropped. */
  maxScenes?: number
  /** When the parent re-paces the script (length picker), it bumps resyncKey with the new resyncScript
   * so we re-split the voiceover across the scenes — the storyboard tracks the re-paced script. */
  resyncScript?: string
  resyncKey?: number
  onScript?: (joinedScript: string) => void
  onSceneCount?: (n: number) => void
}) {
  // Keyframes now show for BOTH modes. They USED to be hidden for UGC ("preview-only + wasteful") — but
  // since Seedance 2.5 the worker feeds each scene's APPROVED keyframe into the UGC segment path too, so
  // the storyboard is what the user is buying: approve/regenerate/upload frames BEFORE paying, whatever
  // the mode. Script-only UGC left the founder with "just a script and a Generate button" (no visibility).
  const showKeyframes = true
  const [board, setBoard] = useState<Board | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [generating, setGenerating] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const id = jobId || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('jobId') : null)
    fetch(`/api/discovery/clone-video/storyboard${id ? `?jobId=${id}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setErr(j.error); return }
        setBoard(j)
        // Cap the cards to the chosen length (~1 scene/3s) and re-split the FULL script across the kept
        // scenes — otherwise a 71s source shows 10 cards with 1-2-word fragments under a 15s pick.
        let sc: Scene[] = j.scenes || []
        if (maxScenes && sc.length > maxScenes) {
          const kept = sc.slice(0, maxScenes)
          const words = String(j.script || '').trim().split(/\s+/).filter(Boolean)
          const per = Math.max(1, Math.ceil(words.length / kept.length))
          sc = kept.map((s: Scene, i: number) => ({ ...s, scriptLine: words.slice(i * per, (i + 1) * per).join(' ') }))
        }
        setScenes(sc)
      })
      .catch((e) => setErr(String(e)))
  }, [jobId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Embedded: keep the parent modal's script + scene count in sync with the storyboard edits, so its
  // Create button generates exactly the plan shown here.
  useEffect(() => {
    if (!embedded || !scenes.length) return
    onScript?.(scenes.map((s) => s.scriptLine).join(' ').trim())
    onSceneCount?.(scenes.length)
  }, [scenes, embedded])   // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState<Record<number, boolean>>({})
  const [genErr, setGenErr] = useState<Record<number, string>>({})
  const [zoom, setZoom] = useState<string | null>(null)   // enlarged keyframe (click a thumbnail)
  // Generate (or regenerate) a keyframe for one scene — a cheap image preview of what THIS scene will
  // look like with your product/creator, BEFORE paying video prices. The worker animates it on approve.
  const genKeyframe = async (s: Scene, opts: { force?: boolean } = {}) => {
    if (!board?.editable || busy[s.index]) return
    setBusy((b) => ({ ...b, [s.index]: true })); setGenErr((e) => ({ ...e, [s.index]: '' }))
    // One call, with a single retry when the image model is momentarily busy (Gemini congestion) — a
    // transient blip shouldn't leave a permanent hole in the storyboard the way it used to.
    const once = () => fetch('/api/discovery/clone-video/keyframe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // opts.force = a DELIBERATE click on Regenerate — allowed to replace a user-uploaded frame. The
      // auto-gen loop never passes it, so uploads can't be trashed implicitly.
      body: JSON.stringify({ jobId: board.jobId, sceneIndex: s.index, action: s.action, scriptLine: s.scriptLine, ...(opts.force ? { force: true } : {}) }),
    }).then((x) => x.json()).catch(() => ({ error: 'network' }))
    try {
      let r = await once()
      if (!r?.preview && /busy|network|429|503/i.test(String(r?.error || ''))) { await new Promise((res) => setTimeout(res, 3500)); r = await once() }
      if (r?.preview) setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, preview: r.preview, preview_source: 'ai' } : x))
      else setGenErr((e) => ({ ...e, [s.index]: /busy/i.test(String(r?.error || '')) ? 'Image model busy — tap to retry' : (r?.error || 'Could not generate') }))
    } catch { setGenErr((e) => ({ ...e, [s.index]: 'Could not generate — try again' })) } finally { setBusy((b) => ({ ...b, [s.index]: false })) }
  }

  // UPLOAD-YOUR-OWN: the founder drops in their own image for this scene (a real product shot, brand
  // photo, or a specific model). Presign → PUT to R2 → tell the keyframe route the KEY; it becomes the
  // approved keyframe the worker builds the video from. This is the "I know exactly what I'll get" path.
  const uploadKeyframe = async (s: Scene, file: File | null) => {
    if (!board?.editable || !file || busy[s.index]) return
    setBusy((b) => ({ ...b, [s.index]: true })); setGenErr((e) => ({ ...e, [s.index]: '' }))
    try {
      const pre = await fetch('/api/assets/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileType: file.type, sizeBytes: file.size }) }).then((x) => x.json()).catch(() => ({}))
      if (!pre?.uploadUrl || !pre?.key) throw new Error(pre?.message || 'Could not start the upload')
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'content-type': pre.fileType || file.type }, body: file })
      if (!put.ok) throw new Error('Upload failed')
      const r = await fetch('/api/discovery/clone-video/keyframe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: board.jobId, sceneIndex: s.index, uploadedKey: pre.key }),
      }).then((x) => x.json()).catch(() => ({ error: 'network' }))
      if (r?.preview) setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, preview: r.preview, preview_source: 'user' } : x))
      else throw new Error(r?.error || 'Could not save the image')
    } catch (e: any) { setGenErr((er) => ({ ...er, [s.index]: /image|jp|png|type/i.test(String(e?.message)) ? 'Use a JPG or PNG image' : (e?.message || 'Upload failed — try again') })) }
    finally { setBusy((b) => ({ ...b, [s.index]: false })) }
  }

  const autoRan = useRef(false)   // hoisted: regenerateCast resets it so the storyboard redraws with the new creator

  // HERO CHARACTER SHEET — the locked creator (incl. any recast look, e.g. "Pakistani" when the source
  // was American). Shown at the top so the founder SEES who'll be on camera and can regenerate them BEFORE
  // paying for a single second of video. Minted lazily by the first scene keyframe; regenerable here.
  const [cast, setCast] = useState<string | null>(null)
  const [castBusy, setCastBusy] = useState(false)
  const [castErr, setCastErr] = useState('')
  useEffect(() => { if (board?.castSheet) setCast(board.castSheet) }, [board?.castSheet])
  const refreshCast = async () => {
    if (!board?.jobId) return
    try { const j = await fetch(`/api/discovery/clone-video/storyboard?jobId=${board.jobId}`, { cache: 'no-store' }).then((r) => r.json()); if (j?.castSheet) setCast(j.castSheet) } catch { /* ok */ }
  }
  const regenerateCast = async () => {
    if (!board?.editable || castBusy) return
    setCastBusy(true); setCastErr('')
    try {
      const r = await fetch('/api/discovery/clone-video/keyframe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: board.jobId, sceneIndex: 0, regenerateCast: true }),
      }).then((x) => x.json()).catch(() => ({ error: 'network' }))
      if (r?.castSheet) {
        setCast(r.castSheet)
        // The scenes were drawn against the OLD person — clear the AI ones so they redraw with the new creator.
        setScenes((prev) => prev.map((s) => s.preview_source === 'user' ? s : { ...s, preview: null, preview_source: null }))
        autoRan.current = false
      } else setCastErr(r?.error || 'Could not redraw the creator — try again')
    } catch { setCastErr('Could not redraw the creator — try again') } finally { setCastBusy(false) }
  }

  // ── FULL CAST (A/B/C…): every distinct on-camera person, each redrawable/uploadable BEFORE video spend.
  // Falls back to the single-creator panel above when the analysis found no people[] list (older jobs).
  const [castList, setCastList] = useState<{ id: string; look: string; sheet: string | null }[]>([])
  const [castBusyMap, setCastBusyMap] = useState<Record<string, boolean>>({})
  const [castErrMap, setCastErrMap] = useState<Record<string, string>>({})
  useEffect(() => { if (Array.isArray(board?.cast)) setCastList(board!.cast!) }, [board?.cast])
  const setMemberSheet = (id: string, sheet: string | null) => setCastList((prev) => prev.map((m) => m.id === id ? { ...m, sheet } : m))
  // Which cast letter a shot features (mirror of the server parse; unlabelled → the lead "A").
  const sceneLetterOf = (a?: string) => { const m = String(a || '').match(/\b(?:person|man|woman|guy|girl|male|female|lady|dude)\s+([A-E])\b/i) || String(a || '').match(/\b([B-E])\b/); return m ? m[1].toUpperCase() : 'A' }
  // After a person is (re)drawn, re-lock their scenes to the new sheet: clear the AI keyframes of the
  // scenes featuring that letter and redraw them (they now reference cast_sheets[letter]). Keeps uploads.
  const relockScenesFor = (id: string) => {
    const affected = scenes.filter((s) => s.preview_source !== 'user' && sceneLetterOf(s.action || s.scriptLine) === id)
    if (!affected.length) return
    setScenes((prev) => prev.map((s) => affected.some((a) => a.index === s.index) ? { ...s, preview: null, preview_source: null } : s))
    affected.forEach((s) => { genKeyframe({ ...s, preview: null }) })
  }
  // ── ASSET SHELF: reusable location/prop photos the founder uploads once; the generator uses them as
  // references (a real location locks that setting; props are passed to matching scenes). Additive. ──
  const [assets, setAssets] = useState<{ locations: Asset[]; props: Asset[] }>({ locations: [], props: [] })
  const [assetBusy, setAssetBusy] = useState<Record<string, boolean>>({})
  useEffect(() => { if (board?.userAssets) setAssets({ locations: board.userAssets.locations || [], props: board.userAssets.props || [] }) }, [board?.userAssets])
  const uploadAsset = async (kind: 'location' | 'prop', file: File | null) => {
    if (!board?.editable || !file) return
    const k = `up-${kind}`
    setAssetBusy((m) => ({ ...m, [k]: true }))
    try {
      const pre = await fetch('/api/assets/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileType: file.type, sizeBytes: file.size }) }).then((x) => x.json()).catch(() => ({}))
      if (!pre?.uploadUrl || !pre?.key) throw new Error('upload start failed')
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'content-type': pre.fileType || file.type }, body: file })
      if (!put.ok) throw new Error('upload failed')
      const r = await fetch('/api/discovery/clone-video/keyframe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: board.jobId, assetOp: true, assetKind: kind, uploadedKey: pre.key }) }).then((x) => x.json()).catch(() => ({}))
      if (r?.userAssets) setAssets({ locations: r.userAssets.locations || [], props: r.userAssets.props || [] })
    } catch { /* surface nothing loud — user can retry */ } finally { setAssetBusy((m) => ({ ...m, [k]: false })) }
  }
  const removeAsset = async (kind: 'location' | 'prop', id: string) => {
    if (!board?.editable) return
    setAssets((a) => ({ ...a, [kind === 'prop' ? 'props' : 'locations']: a[kind === 'prop' ? 'props' : 'locations'].filter((x) => x.id !== id) }))
    try { await fetch('/api/discovery/clone-video/keyframe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: board.jobId, assetOp: true, assetKind: kind, remove: true, assetId: id }) }) } catch { /* optimistic */ }
  }
  const relabelAsset = async (kind: 'location' | 'prop', id: string, label: string) => {
    if (!board?.editable) return
    try { await fetch('/api/discovery/clone-video/keyframe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: board.jobId, assetOp: true, assetKind: kind, assetId: id, label }) }) } catch { /* best-effort */ }
  }
  // Toggle whether a scene shows YOUR product (✅ hero) or the RIVAL/bad item (🚫 rejected, e.g. a vape),
  // then redraw it — so the user can say "show the vape here, not Aura." Persists the intent on the beat.
  const toggleShows = async (s: Scene) => {
    if (!board?.editable) return
    const next = s.shows === 'rejected' ? 'hero' : 'rejected'
    setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, shows: next, preview: null, preview_source: null } : x))
    try {
      await fetch('/api/discovery/clone-video/keyframe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: board.jobId, sceneIndex: s.index, setShows: next }) })
    } catch { /* best-effort — the redraw below still uses the new local intent */ }
    genKeyframe({ ...s, preview: null })
  }
  const drawCastMember = async (id: string, look: string, opts: { relock?: boolean } = {}) => {
    if (!board?.editable || castBusyMap[id]) return
    setCastBusyMap((m) => ({ ...m, [id]: true })); setCastErrMap((e) => ({ ...e, [id]: '' }))
    try {
      const r = await fetch('/api/discovery/clone-video/keyframe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: board.jobId, castOp: true, castLetter: id, look }),
      }).then((x) => x.json()).catch(() => ({ error: 'network' }))
      // relock defaults TRUE — a manual redraw re-locks existing scenes. The initial auto-pass passes
      // relock:false: it draws the cast FIRST, then the scenes, so there's nothing yet to re-lock.
      if (r?.sheet) { setMemberSheet(id, r.sheet); if (id === 'A') setCast(r.sheet); if (opts.relock !== false) relockScenesFor(id) }
      else setCastErrMap((e) => ({ ...e, [id]: r?.error || 'Could not draw — try again' }))
    } catch { setCastErrMap((e) => ({ ...e, [id]: 'Could not draw — try again' })) }
    finally { setCastBusyMap((m) => ({ ...m, [id]: false })) }
  }
  const uploadCastMember = async (id: string, file: File | null) => {
    if (!board?.editable || !file || castBusyMap[id]) return
    setCastBusyMap((m) => ({ ...m, [id]: true })); setCastErrMap((e) => ({ ...e, [id]: '' }))
    try {
      const pre = await fetch('/api/assets/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileType: file.type, sizeBytes: file.size }) }).then((x) => x.json()).catch(() => ({}))
      if (!pre?.uploadUrl || !pre?.key) throw new Error(pre?.message || 'Could not start the upload')
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'content-type': pre.fileType || file.type }, body: file })
      if (!put.ok) throw new Error('Upload failed')
      const r = await fetch('/api/discovery/clone-video/keyframe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: board.jobId, castOp: true, castLetter: id, uploadedKey: pre.key }),
      }).then((x) => x.json()).catch(() => ({ error: 'network' }))
      if (r?.sheet) { setMemberSheet(id, r.sheet); if (id === 'A') setCast(r.sheet); relockScenesFor(id) }
      else throw new Error(r?.error || 'Could not save the image')
    } catch (e: any) { setCastErrMap((er) => ({ ...er, [id]: /image|jp|png|type/i.test(String(e?.message)) ? 'Use a JPG or PNG image' : (e?.message || 'Upload failed') })) }
    finally { setCastBusyMap((m) => ({ ...m, [id]: false })) }
  }

  // Auto-generate a keyframe for every scene that has none — the storyboard should show its visual plan
  // on load, not wait for per-scene clicks. Sequential (gentle on the image quota), runs once per job;
  // persisted previews mean a reload skips already-generated scenes and never re-charges the model.
  useEffect(() => {
    if (autoRan.current || !board?.editable || !scenes.length || !showKeyframes) return
    autoRan.current = true
    // Regenerate a scene if it has NO preview, OR a STALE one — a keyframe URL that belongs to a
    // different job (the beats can carry a previous analysis's previews, which is how old-run women
    // kept showing). A fresh keyframe for THIS job uses the reference frame + gender lock.
    // A USER-uploaded frame is never stale — it lives at an assets URL with no jobId in it, and the
    // founder chose it. Without this guard the auto-gen loop regenerated over uploads and the AI path
    // overwrote them in the DB.
    const stale = (s: Scene) => s.preview_source !== 'user' && (!s.preview || (!!board?.jobId && !s.preview.includes(board.jobId)))
    // Fill the whole board fast: do the FIRST scene alone (it mints the shared cast sheet so every
    // other scene locks to the same presenter), then generate the rest with light concurrency (2 at a
    // time) so a 5-scene storyboard appears in ~two waves instead of five slow serial renders. Previews
    // persist, so a reload never re-charges an already-drawn scene.
    ;(async () => {
      // CAST FIRST: draw every detected person's locked sheet BEFORE any scene, so each scene keyframe
      // locks to a real approved face (cast_sheets[letter]) instead of inventing its own — no post-hoc
      // re-lock, the storyboard is consistent from the first render. Sequential: the Pro image model
      // 503s under parallel load. (relock:false — there are no scenes drawn yet to re-lock.)
      // Read board.cast directly (not the castList STATE, which may not have committed yet when this
      // one-shot effect fires — that race let scenes draw before the cast on a fresh open).
      const roster = Array.isArray(board?.cast) ? board.cast : []
      for (const m of roster.filter((x) => !x.sheet)) await drawCastMember(m.id, m.look, { relock: false })
      // THEN the scenes — they now reference the cast sheets just minted.
      const todo = scenes.filter(stale)
      if (!todo.length) return
      const [first, ...rest] = todo
      await genKeyframe(first)
      refreshCast()   // surface the lead creator right away
      const CONC = 2
      for (let i = 0; i < rest.length; i += CONC) await Promise.all(rest.slice(i, i + CONC).map((s) => genKeyframe(s)))
    })()
  }, [board, scenes.length, cast])   // eslint-disable-line react-hooks/exhaustive-deps

  // Parent re-paced the script (length picker) → re-split it evenly across the current scenes so the
  // storyboard voiceover shows the NEW length's script, matching what will render.
  const lastResync = useRef(0)
  useEffect(() => {
    if (!resyncKey || resyncKey === lastResync.current || !resyncScript || !scenes.length) return
    lastResync.current = resyncKey
    const words = resyncScript.trim().split(/\s+/).filter(Boolean)
    setScenes((prev) => {
      // A longer pick allows MORE scenes (up to what the source has), a shorter pick trims — the card
      // count always tracks the chosen length, and the re-paced script re-splits across what's kept.
      const capped = maxScenes && prev.length > maxScenes ? prev.slice(0, maxScenes) : prev
      const per = Math.max(1, Math.ceil(words.length / Math.max(1, capped.length)))
      return capped.map((s, i) => ({ ...s, scriptLine: words.slice(i * per, (i + 1) * per).join(' ') }))
    })
  }, [resyncKey, maxScenes])   // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i: number, dir: -1 | 1) => setScenes((prev) => {
    const j = i + dir
    if (j < 0 || j >= prev.length) return prev
    const next = [...prev];[next[i], next[j]] = [next[j], next[i]]; return next
  })
  const remove = (index: number) => setScenes((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.index !== index)))

  const generate = async () => {
    if (!board?.editable) return
    setGenerating(true)
    const script = scenes.map((s) => s.scriptLine).join(' ').trim()
    // Scene count follows the edited storyboard, so the worker shoots exactly the scenes you kept.
    await fetch('/api/discovery/clone-video/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: board.jobId, script, mode: board.suggestedMode, sceneCount: scenes.length }),
    }).catch(() => {})
    setGenerating(false)
  }

  if (err) return <div style={{ color: '#a33', fontSize: 14 }}>Couldn’t load a storyboard: {err}</div>
  if (!board || !mounted) return <div style={{ fontSize: 14, color: '#6f6d5a' }}>Loading the storyboard…</div>

  const chip: React.CSSProperties = { fontSize: 12, color: '#20321c', background: '#eef7d6', borderRadius: 999, padding: '4px 11px', fontWeight: 700 }

  // Storyboard-first: show the founder the full visual plan (every scene drawn with their product +
  // the SAME cast) BEFORE they pay for a single second of video. Track how many frames are drawn so
  // the header shows progress and the Approve button waits until the board is complete.
  const isCurrent = (s: Scene) => !!s.preview && (!board?.jobId || s.preview.includes(board.jobId))
  const drawnCount = scenes.filter(isCurrent).length
  const drawing = showKeyframes && board.editable && Object.values(busy).some(Boolean)
  const boardIncomplete = showKeyframes && board.editable && drawnCount < scenes.length

  return (
    <div>
      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,25,20,.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}>
          <img src={zoom} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {board.hookType && <span style={chip}>Hook: {board.hookType}</span>}
        <span style={chip}>{(mode ? mode === 'cinematic' : board.suggestedMode === 'faithful') ? 'Cinematic' : 'UGC'}</span>
        <span style={chip}>{scenes.length || board.sceneCount} scenes</span>
        {board.durationSeconds && <span style={chip}>~{Math.round(board.durationSeconds)}s</span>}
        <span style={{ ...chip, background: board.editable ? '#ff5a2c' : '#f0efe8', color: board.editable ? '#141d15' : '#6f6d5a' }}>
          {board.editable ? 'Editable — nothing generated yet' : 'Already generated (read-only)'}
        </span>
        {showKeyframes && board.editable && boardIncomplete && (
          <span style={{ ...chip, background: '#fff6df', color: '#7a5b12' }}>
            🎨 Drawing your storyboard… {drawnCount}/{scenes.length}
          </span>
        )}
      </div>

      {/* YOUR CREATOR — the locked hero character sheet. This is who'll be on camera in EVERY scene
          (incl. a recast look, e.g. Pakistani when the source was American). Approve or redraw them
          BEFORE spending a credit on video — the whole point of storyboard-first. */}
      {/* FULL CAST — every distinct person the analysis found (A/B/C…), each locked to a sheet the founder
          can redraw or upload BEFORE any video spend. Shown when the analysis returned a people[] list. */}
      {showKeyframes && board.editable && castList.length > 0 && (
        <div style={{ border: '1px solid #e6ece2', borderRadius: 12, padding: '12px 14px', background: '#fbfcfa', marginBottom: 12 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872', marginBottom: 8 }}>
            Your cast · {castList.length} {castList.length === 1 ? 'person' : 'people'} locked across the video
            {board.characterLook && board.characterLook.toLowerCase() !== 'match' ? <> · recast as <b>{board.characterLook}</b></> : null}
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2 }}>
            {castList.map((m) => {
              const busy = !!castBusyMap[m.id]
              return (
                <div key={m.id} style={{ width: 128, flexShrink: 0, border: '1px solid #e6ece2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                  <div style={{ width: '100%', aspectRatio: '9/16', background: '#eef2ec', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {m.sheet
                      ? <img src={m.sheet} alt="" onClick={() => setZoom(m.sheet!)} title="Click to enlarge" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
                      : <span style={{ fontSize: 10, color: '#a7b09e', textAlign: 'center', padding: 6 }}>Not drawn yet</span>}
                    {busy && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#3a7d2c' }}>…</div>}
                  </div>
                  <div style={{ padding: '7px 8px' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: '#20321c' }}>Person {m.id}{m.id === 'A' ? ' · main' : ''}</div>
                    <div style={{ fontSize: 10.5, color: '#66755d', lineHeight: 1.35, marginTop: 2, maxHeight: 42, overflow: 'hidden' }}>{m.look || 'On-camera person'}</div>
                    {castErrMap[m.id] && <div style={{ fontSize: 10, color: '#a15a25', marginTop: 3 }}>{castErrMap[m.id]}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                      <button onClick={() => drawCastMember(m.id, m.look)} disabled={busy} style={{ flex: 1, fontSize: 10.5, fontWeight: 700, color: '#20321c', background: '#fff', border: '1px solid #d7ddd2', borderRadius: 7, padding: '5px 6px', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{busy ? '…' : m.sheet ? '↻ Redraw' : 'Draw'}</button>
                      <label style={{ fontSize: 10.5, fontWeight: 700, color: '#20321c', background: '#fff', border: '1px solid #d7ddd2', borderRadius: 7, padding: '5px 7px', cursor: busy ? 'default' : 'pointer' }} title="Upload your own person">
                        ↑
                        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { uploadCastMember(m.id, e.target.files?.[0] || null); e.currentTarget.value = '' }} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Legacy single-creator panel — only for older jobs whose analysis has no people[] list. */}
      {showKeyframes && board.editable && castList.length === 0 && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', border: '1px solid #e6ece2', borderRadius: 12, padding: '12px 14px', background: '#fbfcfa', marginBottom: 12 }}>
          <div style={{ width: 72, aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', background: '#eef2ec', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
            {cast
              ? <img src={cast} alt="" onClick={() => setZoom(cast)} title="Click to enlarge" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
              : <span style={{ fontSize: 10, color: '#a7b09e', textAlign: 'center', padding: 4 }}>{castBusy ? '…' : 'drawing…'}</span>}
            {castBusy && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#3a7d2c' }}>…</div>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872', marginBottom: 3 }}>Your creator · on camera in every scene</div>
            <div style={{ fontSize: 13, color: '#20321c', lineHeight: 1.45 }}>
              {board.characterLook && board.characterLook.toLowerCase() !== 'match'
                ? <>Recast as <b>{board.characterLook}</b>. This exact person is locked across the whole video — check they look right before you generate.</>
                : <>Matched to the reference creator. This exact person is locked across the whole video — check they look right before you generate.</>}
            </div>
            {castErr && <div style={{ fontSize: 11, color: '#a15a25', marginTop: 4 }}>{castErr}</div>}
          </div>
          <button onClick={regenerateCast} disabled={castBusy} style={{ fontSize: 11.5, fontWeight: 700, color: '#20321c', background: '#fff', border: '1px solid #d7ddd2', borderRadius: 8, padding: '7px 12px', cursor: castBusy ? 'default' : 'pointer', flexShrink: 0, fontFamily: 'inherit' }}>
            {castBusy ? 'Redrawing…' : cast ? '↻ Redraw creator' : 'Draw creator'}
          </button>
        </div>
      )}

      {/* ASSET SHELF — upload real location photos + props so the clone uses YOUR world, not an AI guess. */}
      {showKeyframes && board.editable && (
        <div style={{ border: '1px solid #e6ece2', borderRadius: 12, padding: '12px 14px', background: '#fbfcfa', marginBottom: 12 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872', marginBottom: 2 }}>Your assets · optional — make it look like your world</div>
          <div style={{ fontSize: 11.5, color: '#66755d', marginBottom: 10 }}>Upload a real location photo (we lock scenes in it) or a prop. Label a location to match it to a scene’s setting. Leave empty and we’ll generate them.</div>
          {(['location', 'prop'] as const).map((kind) => {
            const listKey = kind === 'prop' ? 'props' : 'locations'
            const list = assets[listKey]
            const busy = !!assetBusy[`up-${kind}`]
            return (
              <div key={kind} style={{ marginBottom: kind === 'location' ? 12 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#20321c', marginBottom: 6 }}>{kind === 'location' ? '📍 Locations' : '🎁 Props / other'}</div>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }}>
                  {list.map((a) => (
                    <div key={a.id} style={{ width: 110, flexShrink: 0, border: '1px solid #e6ece2', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                      <div style={{ width: '100%', aspectRatio: '1/1', background: '#eef2ec', position: 'relative' }}>
                        <img src={a.url} alt="" onClick={() => setZoom(a.url)} title="Click to enlarge" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} />
                        <button onClick={() => removeAsset(kind, a.id)} title="Remove" style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}>×</button>
                      </div>
                      <input defaultValue={a.label} placeholder={kind === 'location' ? 'name (e.g. kitchen)' : 'name'} onBlur={(e) => relabelAsset(kind, a.id, e.target.value)} style={{ width: '100%', border: 'none', borderTop: '1px solid #eef2ec', fontSize: 10.5, padding: '5px 7px', fontFamily: 'inherit', outline: 'none', background: '#fff' }} />
                    </div>
                  ))}
                  <label style={{ width: 110, flexShrink: 0, aspectRatio: '1/1', border: '1px dashed #cdd6c6', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: busy ? 'default' : 'pointer', color: '#66755d', fontSize: 11, fontWeight: 700 }}>
                    {busy ? '…' : <>＋ Upload<span style={{ fontSize: 9.5, fontWeight: 400, color: '#a7b09e' }}>{kind === 'location' ? 'a real place' : 'a prop'}</span></>}
                    <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { uploadAsset(kind, e.target.files?.[0] || null); e.currentTarget.value = '' }} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {scenes.map((s, i) => (
          <div key={s.index} style={{ display: 'grid', gridTemplateColumns: showKeyframes ? '56px 96px 1fr' : '56px 1fr', gap: 14, border: '1px solid #e6ece2', borderRadius: 12, padding: '14px 16px', background: '#fff', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 26, color: '#141d15', lineHeight: 1 }}>{i + 1}</div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872' }}>{ROLE_LABEL[s.role] || 'Scene'}</div>
              {s.time && <div style={{ fontSize: 10, color: '#a7b09e', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>{s.time}</div>}
              {board.editable && (
                <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" style={{ border: '1px solid #e6ece2', background: '#fff', borderRadius: 5, width: 20, height: 20, cursor: i === 0 ? 'default' : 'pointer', color: '#66755d', fontSize: 11, lineHeight: 1, padding: 0 }}>↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === scenes.length - 1} aria-label="Move down" style={{ border: '1px solid #e6ece2', background: '#fff', borderRadius: 5, width: 20, height: 20, cursor: i === scenes.length - 1 ? 'default' : 'pointer', color: '#66755d', fontSize: 11, lineHeight: 1, padding: 0 }}>↓</button>
                  <button onClick={() => remove(s.index)} disabled={scenes.length <= 1} aria-label="Remove scene" style={{ border: '1px solid #f0dada', background: '#fff', borderRadius: 5, width: 20, height: 20, cursor: scenes.length <= 1 ? 'default' : 'pointer', color: '#b3564e', fontSize: 11, lineHeight: 1, padding: 0 }}>✕</button>
                </div>
              )}
            </div>
            {showKeyframes && <div>
              <div style={{ width: 96, aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', background: '#eef2ec', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {(s.preview || s.thumb)
                  ? <img src={s.preview || s.thumb || ''} alt="" onClick={() => s.preview && setZoom(s.preview)} title={s.preview ? 'Click to enlarge' : ''} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: s.preview ? 'zoom-in' : 'default' }} />
                  : <span style={{ fontSize: 20, color: '#b4bdad' }}>▦</span>}
                {s.preview && <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', color: '#fff', background: s.preview_source === 'user' ? '#141d15' : '#ff5a2c', borderRadius: 4, padding: '1px 4px' }}>{s.preview_source === 'user' ? 'YOURS' : 'AI'}</span>}
                {busy[s.index] && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#3a7d2c', fontWeight: 700 }}>…</div>}
              </div>
              {board.editable && (
                <button onClick={() => genKeyframe(s, { force: true })} disabled={busy[s.index]} style={{ width: 96, marginTop: 5, fontSize: 10.5, fontWeight: 700, color: '#20321c', background: '#fff', border: '1px solid #d7ddd2', borderRadius: 6, padding: '4px 0', cursor: busy[s.index] ? 'default' : 'pointer' }}>
                  {busy[s.index] ? 'Generating…' : s.preview ? 'Regenerate' : 'Preview scene'}
                </button>
              )}
              {board.editable && (
                <label style={{ display: 'block', width: 96, marginTop: 4, fontSize: 10.5, fontWeight: 700, textAlign: 'center', color: '#66755d', background: '#f7f9f4', border: '1px dashed #cdd6c6', borderRadius: 6, padding: '4px 0', cursor: busy[s.index] ? 'default' : 'pointer' }}>
                  ⬆ Upload yours
                  <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy[s.index]} onChange={(e) => { uploadKeyframe(s, e.target.files?.[0] || null); e.currentTarget.value = '' }} style={{ display: 'none' }} />
                </label>
              )}
              {genErr[s.index] && <div style={{ width: 96, marginTop: 4, fontSize: 9.5, color: '#a15a25', lineHeight: 1.3 }}>{genErr[s.index]}</div>}
            </div>}
            <div style={{ minWidth: 0 }}>
              {/* SHOT — what's SHOWN. For UGC (no keyframes) this is just the beat description; for Cinematic, editing + Regenerate redraws the image. */}
              {showKeyframes && <><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872' }}>Shot — what’s shown{board.editable && <span style={{ textTransform: 'none', letterSpacing: 0, color: '#a7b09e', fontWeight: 400 }}> · edit, then Regenerate</span>}</span>
                {/* STORY TAG — click to toggle: ✅ your product ⇄ 🚫 the rival/bad item (e.g. a vape). */}
                {board.editable
                  ? <button onClick={() => toggleShows(s)} title="Click to switch what this scene shows (your product ⇄ the rival/vape)" style={{ fontSize: 10, fontWeight: 800, cursor: 'pointer', borderRadius: 999, padding: '2px 8px', fontFamily: 'inherit', ...(s.shows === 'rejected' ? { color: '#9a3412', background: '#fbe7e1', border: '1px solid #f0cbba' } : { color: '#1f6b2e', background: '#e8f4ea', border: '1px solid #bfe0c6' }) }}>{s.shows === 'rejected' ? `🚫 ${board.rejectedProduct || 'rival item'}` : '✅ Your product'} ⇄</button>
                  : (s.shows === 'rejected'
                      ? <span style={{ fontSize: 10, fontWeight: 800, color: '#9a3412', background: '#fbe7e1', border: '1px solid #f0cbba', borderRadius: 999, padding: '1px 7px' }}>🚫 {board.rejectedProduct || 'rival item'}</span>
                      : s.shows === 'hero' ? <span style={{ fontSize: 10, fontWeight: 800, color: '#1f6b2e', background: '#e8f4ea', border: '1px solid #bfe0c6', borderRadius: 999, padding: '1px 7px' }}>✅ Your product</span> : null)}
              </div>
              <input
                value={s.action}
                disabled={!board.editable}
                onChange={(e) => setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, action: e.target.value } : x))}
                placeholder="Describe the shot — e.g. close-up of hands applying the face wash on the cheek"
                style={{ width: '100%', fontSize: 12.5, color: '#20321c', border: '1px solid #e6ece2', borderRadius: 8, padding: '7px 10px', marginBottom: 10, background: board.editable ? '#fff' : '#faf9f5', fontFamily: 'inherit' }}
              /></>}
              {/* VOICEOVER — what's SAID (the spoken line — this drives BOTH UGC and Cinematic renders). */}
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7a8872', marginBottom: 4 }}>Voiceover — what’s said</div>
              <textarea
                value={s.scriptLine}
                disabled={!board.editable}
                onChange={(e) => setScenes((prev) => prev.map((x) => x.index === s.index ? { ...x, scriptLine: e.target.value } : x))}
                rows={2}
                style={{ width: '100%', fontSize: 13.5, lineHeight: 1.5, color: '#20321c', border: '1px solid #e6ece2', borderRadius: 8, padding: '8px 10px', resize: 'vertical', background: board.editable ? '#fff' : '#faf9f5', fontFamily: 'inherit' }}
              />
            </div>
          </div>
        ))}
      </div>

      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
          <button onClick={generate} disabled={!board.editable || generating || drawing}
            style={{ fontSize: 14, fontWeight: 800, padding: '11px 22px', borderRadius: 999, cursor: (board.editable && !drawing) ? 'pointer' : 'default', border: 'none', background: (board.editable && !drawing) ? '#141d15' : '#d7ddd2', color: '#fff' }}>
            {generating ? 'Starting generation…' : drawing ? `Drawing your storyboard… ${drawnCount}/${scenes.length}` : board.editable ? 'Approve & generate →' : 'Already generated'}
          </button>
          <span style={{ fontSize: 12, color: '#8a9880' }}>Review the storyboard first — editing it is free. Seedance only shoots once you approve.</span>
        </div>
      )}
    </div>
  )
}
