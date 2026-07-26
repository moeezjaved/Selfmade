import React from 'react'
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Series } from 'remotion'
import type { Timeline } from '../../src/lib/video/timeline'
import { Captions } from './layers/Captions'
import { CtaButton } from './layers/CtaButton'
import { LogoMark } from './layers/LogoMark'
import { EndCard } from './layers/EndCard'
import { MusicTrack } from './layers/MusicTrack'

/**
 * The one composition that renders any Selfmade ad timeline.
 *   - UGC   → ONE continuous <OffthreadVideo> (the take is never chopped).
 *   - Cinematic → scenes sequenced with <Series> (transitions land in Phase 2).
 * Everything above the footage is a React layer, so edits are free.
 */
export const AdComposition: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const { fps } = { fps: timeline.fps || 30 }
  const secToFrames = (s: number) => Math.max(1, Math.round(s * fps))

  const footage =
    timeline.format === 'ugc' ? (
      <OffthreadVideo
        src={timeline.scenes[0]?.src}
        startFrom={secToFrames(timeline.scenes[0]?.trimStart || 0)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : (
      <Series>
        {timeline.scenes.map((sc) => (
          <Series.Sequence key={sc.id} durationInFrames={secToFrames(sc.durationSec)}>
            <OffthreadVideo
              src={sc.src}
              startFrom={secToFrames(sc.trimStart || 0)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Series.Sequence>
        ))}
      </Series>
    )

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {footage}

      {timeline.audio?.voiceover ? <Audio src={timeline.audio.voiceover} /> : null}
      {timeline.audio?.music?.src ? (
        <MusicTrack src={timeline.audio.music.src} gainDb={timeline.audio.music.gainDb} />
      ) : null}

      {timeline.layers.map((layer, i) => {
        if (layer.type === 'captions') {
          return <Captions key={i} cues={layer.cues} font={layer.font || timeline.brand?.font?.body || undefined} color={layer.color} style={layer.style} />
        }
        if (layer.type === 'cta') {
          return <CtaButton key={i} text={layer.text} bg={layer.bg || timeline.brand?.colors?.cta} fg={layer.fg} atSec={layer.atSec} durationSec={layer.durationSec} />
        }
        if (layer.type === 'logo') {
          return <LogoMark key={i} src={layer.src} corner={layer.corner} scale={layer.scale} />
        }
        if (layer.type === 'endcard') {
          return (
            <Sequence key={i} from={secToFrames(layer.atSec)}>
              <EndCard headline={layer.headline} cta={layer.cta} atSec={0} colors={timeline.brand?.colors} />
            </Sequence>
          )
        }
        return null
      })}
    </AbsoluteFill>
  )
}
