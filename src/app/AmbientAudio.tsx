'use client'

/**
 * Ambient background music for the landing page.
 *
 * Rules (per product):
 *  - NEVER autoplays. It starts only on the first genuine *click* anywhere on the page —
 *    scrolling, hovering or moving the mouse must not start it (browsers block bare autoplay
 *    anyway, and a click is a real user gesture that satisfies the play() policy).
 *  - A round speaker button sits at the bottom-left; clicking it toggles sound on/off.
 *  - The on/off choice is remembered across visits (localStorage). If the visitor turned it
 *    off before, it stays silent and shows the muted icon.
 */
import { useEffect, useRef, useState } from 'react'

const SRC = '/paper-kite-drift.mp3'
const VOLUME = 0.32
const PREF_KEY = 'sf_ambient_muted' // '1' = user chose silence
const MAX_PLAYS = 2 // play the track twice, then stop

export default function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  // userMuted starts true so we never fight the browser before we know the pref; corrected on mount.
  const mutedPrefRef = useRef(false)
  const playCountRef = useRef(0) // how many times the track has finished this run

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.volume = VOLUME

    let muted = false
    try { muted = localStorage.getItem(PREF_KEY) === '1' } catch {}
    mutedPrefRef.current = muted

    const tryStart = () => {
      if (mutedPrefRef.current) return
      const a = audioRef.current
      if (!a || !a.paused) return
      playCountRef.current = 0
      a.play().then(() => setPlaying(true)).catch(() => {})
    }

    // Start on the first real click only — not scroll, not pointermove.
    const onFirstClick = () => { tryStart(); window.removeEventListener('click', onFirstClick) }
    window.addEventListener('click', onFirstClick)

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    // Manual loop, capped at MAX_PLAYS: replay until we've played it twice, then stop.
    const onEnded = () => {
      playCountRef.current += 1
      const a = audioRef.current
      if (!a) return
      if (playCountRef.current < MAX_PLAYS) {
        a.currentTime = 0
        a.play().catch(() => {})
      } else {
        // played twice — stop for good
        a.pause()
        setPlaying(false)
      }
    }
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)

    return () => {
      window.removeEventListener('click', onFirstClick)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      mutedPrefRef.current = false
      playCountRef.current = 0 // turning it back on restarts the two-play run
      try { localStorage.setItem(PREF_KEY, '0') } catch {}
      el.play().then(() => setPlaying(true)).catch(() => {})
    } else {
      mutedPrefRef.current = true
      try { localStorage.setItem(PREF_KEY, '1') } catch {}
      el.pause()
      setPlaying(false)
    }
  }

  return (
    <>
      <audio ref={audioRef} src={SRC} preload="auto" playsInline aria-hidden />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Turn music off' : 'Turn music on'}
        aria-pressed={playing}
        title={playing ? 'Sound on' : 'Sound off'}
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          zIndex: 60,
          width: 44,
          height: 44,
          borderRadius: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 6px 20px -6px rgba(0,0,0,0.25)',
          color: '#1c1917',
          cursor: 'pointer',
          transition: 'transform .18s ease, background .18s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        {playing ? <SpeakerOn /> : <SpeakerOff />}
      </button>
    </>
  )
}

function SpeakerOn() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a9 9 0 0 1 0 12" />
    </svg>
  )
}

function SpeakerOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}
