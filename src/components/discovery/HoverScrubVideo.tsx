'use client'
/**
 * Hover-scrub video preview (Motion-style). On hover, moving the cursor left↔right scrubs through the
 * video's frames (see the whole ad without playing) with a scrub line. Click the lime play button to
 * play inline with a circular progress ring; a spinner ring shows while it buffers. Reduced-motion
 * safe: falls back to poster + play only. The <video> mounts lazily (on hover) so nothing downloads
 * until the user engages.
 */
import { useRef, useState } from 'react'

export default function HoverScrubVideo({ src, poster, brandBg = '#1c2b1c', initials = '', onPlayingChange, onError }: {
  src: string
  poster?: string
  brandBg?: string
  initials?: string
  onPlayingChange?: (playing: boolean) => void
  onError?: () => void   // fired if the video can't load (dead blob/YouTube src) so callers can fall back
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  const [ready, setReady] = useState(false)      // metadata loaded → scrub + play available
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)  // buffering after Play pressed
  const [progress, setProgress] = useState(0)     // 0..1 (scrub line while hovering, playhead while playing)
  const [imgLoaded, setImgLoaded] = useState(false)
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const setPlay = (p: boolean) => { setPlaying(p); onPlayingChange?.(p) }

  const onMove = (e: React.MouseEvent) => {
    if (reduce || playing) return
    const wrap = wrapRef.current; if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setProgress(ratio)                       // move the line immediately, even before the video loads
    const v = vidRef.current
    if (v && v.duration && isFinite(v.duration)) { try { v.currentTime = ratio * v.duration } catch { /* not seekable yet */ } }
  }

  const play = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = vidRef.current; if (!v) return
    setLoading(true); v.muted = false; v.currentTime = 0
    v.play().then(() => setPlay(true)).catch(() => { v.muted = true; v.play().then(() => setPlay(true)).catch(() => {}) })
  }
  const pause = (e: React.MouseEvent) => { e.stopPropagation(); vidRef.current?.pause(); setPlay(false) }

  const mountVideo = hover || playing
  const showScrub = hover && !playing && !reduce
  // Progress ring geometry (r=15, C=2πr≈94.25).
  const C = 94.25, off = C * (1 - progress)

  return (
    <div ref={wrapRef} onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); if (!playing) setProgress(0) }} onMouseMove={onMove}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: `linear-gradient(140deg, ${brandBg} 0%, #14181c 130%)` }}>

      {/* brand initials watermark until a frame paints */}
      {!imgLoaded && !ready && initials && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72, fontWeight: 900, color: 'rgba(255,255,255,0.10)', letterSpacing: '-.05em', userSelect: 'none' }}>{initials}</span>
      )}

      {/* poster frame */}
      {poster && (
        <img src={poster} alt="" loading="lazy" decoding="async" onLoad={() => setImgLoaded(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: imgLoaded && !(mountVideo && ready) ? 1 : (mountVideo && ready ? 0 : imgLoaded ? 1 : 0), transition: 'opacity .15s' }} />
      )}

      {/* lazily-mounted video */}
      {mountVideo && (
        <video ref={vidRef} key={src} src={src} muted playsInline preload="metadata"
          onLoadedMetadata={() => setReady(true)} onCanPlay={() => setLoading(false)} onWaiting={() => setLoading(true)} onError={() => onError?.()}
          onPlaying={() => setLoading(false)} onTimeUpdate={() => { if (playing) { const v = vidRef.current!; setProgress(v.duration ? v.currentTime / v.duration : 0) } }}
          onEnded={() => { setPlay(false); setProgress(0) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000', opacity: ready ? 1 : 0, transition: 'opacity .15s', zIndex: 2 }} />
      )}

      {/* Vertical scrub playhead at the cursor (Motion-style) — sweeps across as you move; the frame
          seeks to match. Plus a thin bottom progress bar. zIndex above the card's hover overlay. */}
      {showScrub && (
        <>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${progress * 100}%`, width: 2, background: '#fff', transform: 'translateX(-1px)', boxShadow: '0 0 8px rgba(0,0,0,.5)', zIndex: 9, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(0,0,0,.25)', zIndex: 9, pointerEvents: 'none' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: '#fff' }} />
          </div>
        </>
      )}

      {/* Play button (lime) — shown when not playing */}
      {!playing && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9, pointerEvents: 'none' }}>
          <button onClick={play} aria-label="Play" style={{ pointerEvents: 'auto', width: 48, height: 48, borderRadius: '50%', background: '#ff5a2c', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.35)', padding: 0, transition: 'transform .12s' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
            <span style={{ fontSize: 17, marginLeft: 3, color: '#0e1b12' }}>▶</span>
          </button>
        </div>
      )}

      {/* Progress + loading ring while playing */}
      {playing && (
        <div style={{ position: 'absolute', bottom: 10, right: 10, width: 40, height: 40, zIndex: 9 }}>
          <button onClick={pause} aria-label="Pause" style={{ position: 'absolute', inset: 0, width: 40, height: 40, borderRadius: '50%', background: 'rgba(14,27,18,.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff5a2c', fontSize: 13, backdropFilter: 'blur(4px)' }}>
            {loading ? '' : '⏸'}
          </button>
          <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
            <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="3" />
            <circle cx="20" cy="20" r="15" fill="none" stroke="#ff5a2c" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={loading ? C * 0.75 : off}
              style={loading ? { animation: 'hsv-spin 0.8s linear infinite', transformOrigin: '20px 20px' } : { transition: 'stroke-dashoffset .2s linear' }} />
          </svg>
        </div>
      )}

      <style>{`@keyframes hsv-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
