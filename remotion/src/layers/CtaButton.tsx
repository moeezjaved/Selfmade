import React from 'react'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

/** Editable CTA button — text, colour, timing all free to change. Springs in when it appears. */
export const CtaButton: React.FC<{
  text: string
  bg?: string
  fg?: string
  atSec: number
  durationSec: number
}> = ({ text, bg = '#639922', fg = '#ffffff', atSec, durationSec }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  if (t < atSec || t > atSec + durationSec) return null

  const local = frame - Math.round(atSec * fps)
  const pop = spring({ frame: local, fps, config: { damping: 14, stiffness: 160 } })
  const scale = interpolate(pop, [0, 1], [0.8, 1])

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 0 110px' }}>
      <div
        style={{
          transform: `scale(${scale})`,
          background: bg,
          color: fg,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 800,
          fontSize: 52,
          padding: '26px 56px',
          borderRadius: 999,
          boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}
