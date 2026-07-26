import React from 'react'
import { Composition } from 'remotion'
import { AdComposition } from './AdComposition'
import { sampleTimeline } from './sample-timeline'
import { ASPECT_DIMS, totalDurationInFrames, type Timeline } from '../../src/lib/video/timeline'

/** Registers the single ad composition. Dimensions + duration come from the timeline props. */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AdComposition"
      component={AdComposition}
      defaultProps={{ timeline: sampleTimeline }}
      calculateMetadata={({ props }) => {
        const t = (props.timeline || sampleTimeline) as Timeline
        const dims = ASPECT_DIMS[t.aspect] || ASPECT_DIMS['9:16']
        return { fps: t.fps || 30, durationInFrames: totalDurationInFrames(t), width: dims.width, height: dims.height }
      }}
      // Placeholder metadata; calculateMetadata overrides these from the timeline.
      fps={30}
      durationInFrames={480}
      width={1080}
      height={1920}
    />
  )
}
