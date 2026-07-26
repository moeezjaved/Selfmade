import React from 'react'
import { Audio } from 'remotion'

/** Background music bed. gainDb (e.g. -14) → linear volume so it sits under the VO. Free to swap. */
export const MusicTrack: React.FC<{ src: string; gainDb?: number }> = ({ src, gainDb = -14 }) => {
  const volume = Math.min(1, Math.max(0, Math.pow(10, gainDb / 20)))
  return <Audio src={src} volume={volume} />
}
