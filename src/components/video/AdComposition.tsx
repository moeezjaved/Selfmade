/**
 * App-side Remotion composition — the SAME timeline the render worker uses, rendered live in the
 * browser via @remotion/player. Self-contained (footage + all layers inline) so the Next app doesn't
 * reach into the standalone remotion/ package. Keep this in sync with remotion/src/AdComposition.tsx;
 * Step 4 will unify them by having the render worker import this file.
 */
import React from 'react'
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Series, interpolate, spring, useCurrentFrame, useVideoConfig, Img } from 'remotion'
import type { Timeline, CaptionCue } from '@/lib/video/timeline'

const sec = (s: number, fps: number) => Math.max(1, Math.round(s * fps))

const Captions: React.FC<{ cues: CaptionCue[]; font?: string; color?: string; style?: string }> = ({ cues, font, color = '#fff', style = 'block' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const active = cues.find((c) => t >= c.startSec && t < c.endSec)
  if (!active) return null
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 64px 220px' }}>
      <div style={{ fontFamily: font || 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: 60, lineHeight: 1.15, color, textAlign: 'center', textShadow: '0 2px 12px rgba(0,0,0,.6)', background: style === 'block' ? 'rgba(0,0,0,.45)' : 'transparent', padding: style === 'block' ? '10px 22px' : 0, borderRadius: 12, maxWidth: '90%' }}>
        {active.text}
      </div>
    </AbsoluteFill>
  )
}

const CtaButton: React.FC<{ text: string; bg?: string; fg?: string; atSec: number; durationSec: number }> = ({ text, bg = '#639922', fg = '#fff', atSec, durationSec }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  if (t < atSec || t > atSec + durationSec) return null
  const pop = spring({ frame: frame - Math.round(atSec * fps), fps, config: { damping: 14, stiffness: 160 } })
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 0 110px' }}>
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.8, 1])})`, background: bg, color: fg, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: 52, padding: '26px 56px', borderRadius: 999, boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
        {text}
      </div>
    </AbsoluteFill>
  )
}

const CORNER: Record<string, React.CSSProperties> = { tl: { top: 48, left: 48 }, tr: { top: 48, right: 48 }, bl: { bottom: 48, left: 48 }, br: { bottom: 48, right: 48 } }

export const AdComposition: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const fps = timeline.fps || 30
  const footage =
    timeline.format === 'ugc' ? (
      <OffthreadVideo src={timeline.scenes[0]?.src} startFrom={sec(timeline.scenes[0]?.trimStart || 0, fps)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <Series>
        {timeline.scenes.map((s) => (
          <Series.Sequence key={s.id} durationInFrames={sec(s.durationSec, fps)}>
            <OffthreadVideo src={s.src} startFrom={sec(s.trimStart || 0, fps)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Series.Sequence>
        ))}
      </Series>
    )

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {footage}
      {timeline.audio?.voiceover ? <Audio src={timeline.audio.voiceover} /> : null}
      {timeline.audio?.music?.src ? <Audio src={timeline.audio.music.src} volume={Math.pow(10, (timeline.audio.music.gainDb ?? -14) / 20)} /> : null}
      {timeline.layers.map((l, i) => {
        if (l.type === 'captions') return <Captions key={i} cues={l.cues} font={l.font || timeline.brand?.font?.body || undefined} color={l.color} style={l.style} />
        if (l.type === 'cta') return <CtaButton key={i} text={l.text} bg={l.bg || timeline.brand?.colors?.cta} fg={l.fg} atSec={l.atSec} durationSec={l.durationSec} />
        if (l.type === 'logo') return (
          <AbsoluteFill key={i}><div style={{ position: 'absolute', ...CORNER[l.corner || 'tr'] }}><Img src={l.src} style={{ width: 1080 * (l.scale || 0.12), height: 'auto', objectFit: 'contain' }} /></div></AbsoluteFill>
        )
        if (l.type === 'endcard') return (
          <Sequence key={i} from={sec(l.atSec, fps)}>
            <AbsoluteFill style={{ background: timeline.brand?.colors?.accent || '#ff5a2c', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 40, padding: 80 }}>
              <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: 78, lineHeight: 1.1, color: timeline.brand?.colors?.text || '#141d15', textAlign: 'center' }}>{l.headline}</div>
              {l.cta ? <div style={{ background: timeline.brand?.colors?.cta || '#141d15', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: 48, padding: '24px 52px', borderRadius: 999 }}>{l.cta}</div> : null}
            </AbsoluteFill>
          </Sequence>
        )
        return null
      })}
    </AbsoluteFill>
  )
}
