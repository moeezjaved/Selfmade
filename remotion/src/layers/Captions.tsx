import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CaptionCue } from '../../../src/lib/video/timeline'

/**
 * Editable caption layer — brand font, perfect timing, ZERO AI spelling errors
 * (this is React text, not pixels burned by the image model). Changing it is free.
 */
export const Captions: React.FC<{
  cues: CaptionCue[]
  font?: string
  color?: string
  style?: 'karaoke' | 'block' | 'line'
}> = ({ cues, font, color = '#ffffff', style = 'line' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const active = cues.find((c) => t >= c.startSec && t < c.endSec)
  if (!active) return null

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 64px 220px' }}>
      <div
        style={{
          fontFamily: font || 'Inter, system-ui, sans-serif',
          fontWeight: 800,
          fontSize: 60,
          lineHeight: 1.15,
          color,
          textAlign: 'center',
          textShadow: '0 2px 12px rgba(0,0,0,0.6)',
          background: style === 'block' ? 'rgba(0,0,0,0.45)' : 'transparent',
          padding: style === 'block' ? '10px 22px' : 0,
          borderRadius: 12,
          maxWidth: '90%',
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  )
}
