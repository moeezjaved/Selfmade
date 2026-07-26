/**
 * The Timeline — an ad as structured data ("video as software"), not a flat MP4.
 *
 * This is the single source of truth shared by three places:
 *   1. the video-clone worker, which EMITS a timeline after Seedance clips exist,
 *   2. the Remotion composition (remotion/), which RENDERS it (preview + export),
 *   3. the Next app, which lets the user (and later Mello) EDIT it.
 *
 * Design rules baked in:
 *   - UGC = exactly ONE scene (the whole continuous take, never chopped).
 *   - Cinematic = many scenes, sequenced with transitions.
 *   - Everything above the footage (captions/cta/logo/endcard/music) is an editable
 *     LAYER, so changing it costs nothing (no Seedance re-shoot).
 */

export type Aspect = '9:16' | '4:5' | '1:1' | '16:9'

/** Pixel dimensions per aspect (1080-wide family). Render + preview swap these; the JSON is unchanged. */
export const ASPECT_DIMS: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
}

export type SceneRole = 'hook' | 'problem' | 'solution' | 'proof' | 'demo' | 'cta' | 'take' | 'other'

export interface Scene {
  id: string
  role: SceneRole
  /** R2 URL of the Seedance clip (or the whole UGC take). */
  src: string
  /** Seconds to skip from the START of the source clip (Seedance min length is longer than we show). */
  trimStart: number
  /** How many seconds of this scene actually play in the final ad. */
  durationSec: number
  /** true = a person speaks on camera (lip-synced). Changing the words needs a Seedance re-shoot. */
  talking?: boolean
}

export interface CaptionCue {
  startSec: number
  endSec: number
  text: string
}

export type Layer =
  | { type: 'captions'; style?: 'karaoke' | 'block' | 'line'; font?: string; color?: string; cues: CaptionCue[] }
  | { type: 'cta'; text: string; bg?: string; fg?: string; atSec: number; durationSec: number }
  | { type: 'logo'; src: string; corner?: 'tl' | 'tr' | 'bl' | 'br'; scale?: number }
  | { type: 'endcard'; headline: string; cta?: string; atSec: number }

export interface Timeline {
  version: 1
  format: 'ugc' | 'cinematic'
  fps: number
  aspect: Aspect
  /** Total length in frames. Derived from scenes when omitted (see totalDurationInFrames). */
  durationInFrames?: number
  brand?: {
    logo?: string | null
    colors?: { cta?: string; text?: string; accent?: string }
    font?: { heading?: string | null; body?: string | null }
  }
  audio?: {
    voiceover?: string | null
    music?: { src: string; gainDb?: number } | null
  }
  scenes: Scene[]
  layers: Layer[]
}

/** Total frames from the scene durations (the footage spine drives length). */
export function totalDurationInFrames(t: Pick<Timeline, 'scenes' | 'fps' | 'durationInFrames'>): number {
  if (t.durationInFrames && t.durationInFrames > 0) return t.durationInFrames
  const secs = t.scenes.reduce((s, sc) => s + (sc.durationSec || 0), 0)
  return Math.max(1, Math.round(secs * (t.fps || 30)))
}
