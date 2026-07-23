'use client'
/**
 * Reveal — the museum's whisper of motion. Each room fades/rises in as you reach it.
 * FAIL-OPEN by design: rooms are fully visible without JS; this only ARMS them (hides,
 * then reveals on scroll) once JS confirms it can also un-hide them. If the script
 * never runs, nothing is ever hidden. Respects prefers-reduced-motion.
 */
import { useEffect } from 'react'

export default function Reveal() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const els = Array.from(document.querySelectorAll('[data-reveal]'))
    if (!els.length) return
    els.forEach((el) => el.classList.add('rv-armed'))
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('rv-in'); io.unobserve(e.target) }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return null
}
