import React from 'react'
import { AbsoluteFill, Img, useVideoConfig } from 'remotion'

const POS: Record<string, React.CSSProperties> = {
  tl: { top: 48, left: 48 },
  tr: { top: 48, right: 48 },
  bl: { bottom: 48, left: 48 },
  br: { bottom: 48, right: 48 },
}

/** Brand logo, tasteful corner placement. Free to toggle / move / resize. */
export const LogoMark: React.FC<{ src: string; corner?: 'tl' | 'tr' | 'bl' | 'br'; scale?: number }> = ({
  src,
  corner = 'tr',
  scale = 0.12,
}) => {
  const { width } = useVideoConfig()
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', ...POS[corner] }}>
        <Img src={src} style={{ width: width * scale, height: 'auto', objectFit: 'contain' }} />
      </div>
    </AbsoluteFill>
  )
}
