import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

/** Full-frame end card (headline + CTA) that fades in over the last beat. Free to edit. */
export const EndCard: React.FC<{
  headline: string
  cta?: string
  atSec: number
  colors?: { text?: string; accent?: string; cta?: string }
}> = ({ headline, cta, atSec, colors }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  if (t < atSec) return null

  const local = frame - Math.round(atSec * fps)
  const opacity = interpolate(local, [0, 12], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        opacity,
        background: colors?.accent || '#dffe95',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 40,
        padding: 80,
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 800,
          fontSize: 78,
          lineHeight: 1.1,
          color: colors?.text || '#17251c',
          textAlign: 'center',
        }}
      >
        {headline}
      </div>
      {cta ? (
        <div
          style={{
            background: colors?.cta || '#17251c',
            color: '#ffffff',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 800,
            fontSize: 48,
            padding: '24px 52px',
            borderRadius: 999,
          }}
        >
          {cta}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
