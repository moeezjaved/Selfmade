import type { Timeline } from '../../src/lib/video/timeline'

/**
 * A hand-written timeline so `npm run dev` (Remotion Studio) shows the composition
 * immediately — before any worker wiring. Footage is a public sample clip; swap for
 * a real R2 Seedance clip once the worker emits timelines (Step 2).
 */
const SAMPLE_CLIP = 'https://www.w3schools.com/html/mov_bbb.mp4'

export const sampleTimeline: Timeline = {
  version: 1,
  format: 'ugc',
  fps: 30,
  aspect: '9:16',
  brand: {
    logo: 'https://picsum.photos/seed/selfmade/240/240',
    colors: { cta: '#639922', text: '#17251c', accent: '#dffe95' },
    font: { heading: 'Inter', body: 'Inter' },
  },
  audio: { voiceover: null, music: null },
  scenes: [{ id: 's1', role: 'take', src: SAMPLE_CLIP, trimStart: 1, durationSec: 9, talking: true }],
  layers: [
    {
      type: 'captions',
      style: 'block',
      color: '#ffffff',
      cues: [
        { startSec: 0, endSec: 3, text: 'I spent $4 and the scratching stopped.' },
        { startSec: 3, endSec: 6, text: 'Exterminators wanted $8,000+.' },
        { startSec: 6, endSec: 8, text: 'Plant-powered. Safe for pets.' },
      ],
    },
    { type: 'logo', src: 'https://picsum.photos/seed/selfmade/240/240', corner: 'tr', scale: 0.12 },
    { type: 'cta', text: 'Try today →', atSec: 6, durationSec: 2 },
    { type: 'endcard', headline: 'Gone in 24 hours.', cta: 'Shop now', atSec: 8 },
  ],
}
