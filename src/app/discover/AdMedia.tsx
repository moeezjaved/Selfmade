'use client'
/**
 * AdMedia — one exhibited creative. Poster-first (never jumps), and for videos it
 * plays muted on hover (desktop) / when scrolled into view (mobile). This is the
 * museum's "motion is the emotion" law: the page feels faintly alive at rest, fully
 * alive on attention. Fills its parent; the parent grid sizes it.
 */
import { useEffect, useRef } from 'react'

export default function AdMedia({ img, video, href, className, badge }: { img: string; video?: string; href?: string; className?: string; badge?: string }) {
  const vref = useRef<HTMLVideoElement>(null)

  // Mobile: autoplay muted when mostly in view, pause when it leaves (Instagram physics).
  useEffect(() => {
    const v = vref.current
    if (!v || !video) return
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    if (!coarse) return
    const io = new IntersectionObserver((es) => {
      for (const e of es) { if (e.isIntersecting) v.play().catch(() => {}); else v.pause() }
    }, { threshold: 0.6 })
    io.observe(v)
    return () => io.disconnect()
  }, [video])

  const enter = () => { const v = vref.current; if (v) v.play().catch(() => {}) }
  const leave = () => { const v = vref.current; if (v) { v.pause(); try { v.currentTime = 0 } catch {} } }

  const inner = (
    <>
      {video
        ? <video ref={vref} src={video} poster={img} muted loop playsInline preload="none" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      <span className="admedia-scrim" />
      {video && <span className="admedia-play">▶</span>}
      {badge && <span className="admedia-badge">{badge}</span>}
    </>
  )

  const common = { className: `ad ${className || ''}`, onMouseEnter: enter, onMouseLeave: leave }
  return href
    ? <a href={href} {...common}>{inner}</a>
    : <div {...common}>{inner}</div>
}
