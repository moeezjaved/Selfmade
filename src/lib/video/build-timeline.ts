/**
 * Build a Timeline from a FINISHED video remake (creative_generations row + clone_meta).
 *
 * This is the bridge from today's pipeline to the Remotion engine — it reshapes data the worker
 * ALREADY stores (scene_clips / segment_clips = clean footage, scene_plan, overlays, final_script,
 * brand kit) into the editable Timeline. Pure + best-effort: never throws, always returns something
 * renderable. The worker will call this same builder at generation time (Step 2b); for now a read
 * endpoint calls it so any existing remake can be viewed as a timeline with no worker change.
 *
 * "editable" tells the caller whether the scenes are CLEAN footage (layers are truly editable) or a
 * passthrough of the already-baked final video (a single scene, layers would double-print).
 */
import type { Timeline, Scene, Layer, CaptionCue, Aspect } from './timeline'

type Row = { id: string; image_url?: string | null; clone_meta?: any }
type Brand = { brand_kit?: any; name?: string | null } | null

const FPS = 30

// Split a script into timed cues spread evenly across a window — good enough to preview; the worker
// will later persist real per-scene cue timings.
function cuesFromScript(script: string, startSec: number, endSec: number, maxPerCue = 7): CaptionCue[] {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || endSec <= startSec) return []
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += maxPerCue) chunks.push(words.slice(i, i + maxPerCue).join(' '))
  const per = (endSec - startSec) / chunks.length
  return chunks.map((text, i) => ({ startSec: +(startSec + i * per).toFixed(2), endSec: +(startSec + (i + 1) * per).toFixed(2), text }))
}

export function buildTimelineFromJob(row: Row, brand?: Brand): { timeline: Timeline; editable: boolean; note?: string } {
  const meta = row.clone_meta || {}
  const kit = brand?.brand_kit || {}
  const aspect: Aspect = (['9:16', '4:5', '1:1', '16:9'] as Aspect[]).includes(meta.aspect) ? meta.aspect : '9:16'

  const brandBlock: Timeline['brand'] = {
    logo: kit.logo || null,
    colors: {
      cta: kit.palette?.cta || (Array.isArray(kit.colors) ? kit.colors[0] : undefined) || '#639922',
      text: kit.palette?.heading || '#141d15',
      accent: kit.palette?.accent || '#ff5a2c',
    },
    font: { heading: kit.fonts?.heading || null, body: kit.fonts?.body || null },
  }

  const scenes: Scene[] = []
  const captionCues: CaptionCue[] = []
  let editable = false
  let note: string | undefined

  const sceneClips: Record<string, string> = meta.scene_clips || {}
  const segClips: Record<string, string> = meta.segment_clips || {}

  if (meta.mode === 'faithful' && Array.isArray(meta.scene_plan) && Object.keys(sceneClips).length) {
    // Cinematic — clean per-scene footage. Fully editable.
    editable = true
    let at = 0
    meta.scene_plan.forEach((sc: any, i: number) => {
      const src = sceneClips[i]
      if (!src) return
      const dur = Math.max(1, Number(sc.duration) || 5)
      scenes.push({ id: `s${i}`, role: i === 0 ? 'hook' : 'other', src, trimStart: 0, durationSec: dur, talking: !!sc.has_people })
      captionCues.push(...cuesFromScript(sc.script || '', at, at + dur))
      at += dur
    })
  } else if (Array.isArray(meta.segment_plan?.segments) && Object.keys(segClips).length) {
    // Long-form UGC — clean per-segment footage. Editable; kept as sequential segments (still one creator).
    editable = true
    let at = 0
    meta.segment_plan.segments.forEach((sg: any, i: number) => {
      const src = segClips[i]
      if (!src) return
      const words = String(sg.script || sg.text || '').trim().split(/\s+/).filter(Boolean).length
      const dur = Math.max(5, Math.min(15, Math.round(words / 2.6) + 1))
      scenes.push({ id: `seg${i}`, role: i === 0 ? 'hook' : 'take', src, trimStart: 0, durationSec: dur, talking: true })
      captionCues.push(...cuesFromScript(sg.script || sg.text || '', at, at + dur))
      at += dur
    })
  }

  if (!scenes.length && row.image_url) {
    // Single-take UGC — one continuous talking-head clip. The footage stays ONE layer (you can't
    // re-cut a lip-synced take; changing the words = a Seedance re-shoot). But the main render does NOT
    // burn karaoke captions (only the separate captions job does), so when they weren't baked we can
    // make the take editable: captions from the script + logo become free, editable layers on top.
    const dur = Math.max(4, Number(meta?.beat_sheet?.duration_seconds) || 15)
    scenes.push({ id: 'take', role: 'take', src: row.image_url, trimStart: 0, durationSec: dur, talking: true })
    const captionsBaked = !!meta.caption_segments   // the opt-in karaoke-captions job burned text into pixels
    if (captionsBaked) {
      editable = false
      note = 'Captions are baked into this render — showing it as one layer. Re-remake without burned captions to make them editable.'
    } else {
      editable = true
      captionCues.push(...cuesFromScript(meta.final_script || meta.script || '', 0, dur))
      note = 'Single-take UGC: the footage is one shot, but captions, CTA, logo, colours and aspect are all free to edit here.'
    }
  }

  const layers: Layer[] = []
  if (editable && captionCues.length) {
    layers.push({ type: 'captions', style: 'block', color: '#ffffff', font: brandBlock?.font?.body || undefined, cues: captionCues })
  }
  if (editable && brandBlock?.logo) {
    layers.push({ type: 'logo', src: brandBlock.logo, corner: 'tr', scale: 0.12 })
  }

  const timeline: Timeline = {
    version: 1,
    format: meta.mode === 'faithful' ? 'cinematic' : 'ugc',
    fps: FPS,
    aspect,
    brand: brandBlock,
    audio: { voiceover: meta.voiceover_url || null, music: null },
    scenes: scenes.length ? scenes : [{ id: 'empty', role: 'other', src: row.image_url || '', trimStart: 0, durationSec: 5 }],
    layers,
  }
  return { timeline, editable, note }
}
