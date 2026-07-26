# Remotion — Phase 1 Spec (Foundation)

**Goal:** turn a finished video remake from a locked `.mp4` into an **editable timeline** that renders through Remotion, with a live in-browser preview and multi-aspect export. Ships instant, free edits on everything that isn't AI footage (captions, CTA, logo, colours, music, aspect ratio).

**Non-negotiables:** additive (today's ffmpeg pipeline stays as fallback); UGC footage is never re-chopped (one video layer); no change to Seedance generation itself.

---

## 1. Data model — the timeline

Stored on the existing `video_clone_jobs` row inside `clone_meta.timeline` (no new table). Built by the worker after Seedance clips exist; read by the Player and the render worker.

```jsonc
{
  "version": 1,
  "format": "ugc" | "cinematic",
  "fps": 30,
  "aspect": "9:16",                 // default; export re-targets 4:5 / 1:1 / 16:9
  "durationInFrames": 540,
  "brand": {
    "logo": "https://r2/…png",
    "colors": { "cta": "#639922", "text": "#17251c", "accent": "#dffe95" },
    "font": { "heading": "…", "body": "…" }
  },
  "audio": {
    "voiceover": "https://r2/vo.mp3",           // existing TTS output, null for in-clip Seedance audio
    "music": { "src": "https://r2/track.mp3", "gainDb": -14 }   // null until a track is picked
  },
  "scenes": [
    { "id": "s1", "role": "hook",     "src": "https://r2/scene1.mp4", "trimStart": 0.4, "durationSec": 2.8, "talking": true },
    { "id": "s2", "role": "problem",  "src": "https://r2/scene2.mp4", "trimStart": 0,   "durationSec": 4.0, "talking": false }
    // UGC: exactly ONE scene = the whole take, talking:true, no trim
  ],
  "layers": [
    { "type": "captions", "style": "karaoke", "font": "…", "color": "#fff",
      "cues": [ { "startSec": 0.0, "endSec": 2.8, "text": "I spent $4 and it stopped." } ] },
    { "type": "cta",     "text": "Try today", "bg": "#639922", "fg": "#fff", "atSec": 15.0, "durationSec": 3.0 },
    { "type": "logo",    "src": "https://r2/logo.png", "corner": "tr", "scale": 0.12 },
    { "type": "endcard", "headline": "…", "cta": "Shop now", "atSec": 15.0 }
  ]
}
```

Most fields already exist in `clone_meta` today (`captions` / `caption_segments`, `scene_clips`, `scene_plan`, `overlays`, `screencast_url`, brand kit via the job's brand). Phase 1 = **shape them into this schema**, don't recompute them.

---

## 2. The Remotion project (`remotion/`)

New top-level `remotion/` package (its own `package.json`; Remotion + React). One root composition, parametrised by the timeline JSON:

- `AdComposition` — reads `timeline`, lays down: scene layer(s) as `<OffthreadVideo>` (trimmed via `trimStart`/`durationSec`), then caption / cta / logo / endcard layers as absolutely-positioned React.
- **UGC path:** one `<OffthreadVideo>` for the whole take + overlay layers (never split).
- **Cinematic path:** sequenced scene videos with `<Series>` + transitions (`@remotion/transitions` crossfade/cut).
- Layer components: `Captions`, `CtaButton`, `LogoMark`, `EndCard`, `MusicTrack` (`<Audio>`).
- Aspect handled by composition `width`/`height` swapped at render/preview — same JSON, different frame.

Shared type `Timeline` lives in `src/lib/video/timeline.ts` (imported by both the Next app and `remotion/`).

---

## 3. Live preview in the UI

- Add `@remotion/player` to the Next app.
- In `src/app/(dashboard)/studio/InlineVideoRemake.tsx` (and the remake result view): when a job's `clone_meta.timeline` exists, render `<Player component={AdComposition} inputProps={{timeline}} controls />` instead of the flat `<video>`.
- Minimal Phase-1 inspector next to the Player: **caption text/style, CTA text+colour, logo on/off, music pick, aspect toggle.** Each edit mutates local `timeline` state → Player re-renders instantly (free). "Save" persists `timeline` back to the job.
- Fallback: if no `timeline`, show the existing MP4 (nothing breaks for old jobs).

---

## 4. Render worker (droplet)

New container `selfmade-render` (same pattern as `video-clone-worker`):

- Polls `video_clone_jobs` for `render_requested` (new status) with a target aspect set.
- Runs `npx remotion render AdComposition out.mp4 --props=timeline.json --config …` (headless Chromium; Remotion bundles it).
- Uploads MP4(s) to R2, writes URLs back to `clone_meta.exports[aspect]`, flips status `done`.
- One request can fan out to multiple aspects (parallel renders).
- Replaces the ffmpeg concat/xfade stitch as the **final assembly** step; ffmpeg stays for clip trimming/probing.

Deploy = build image + recreate container via DO console (existing recipe). ~1–3 min per 1080p export to start.

---

## 5. API

- `POST /api/discovery/clone-video/render` — `{ jobId, aspects: ["9:16","4:5"] }` → sets `render_requested`, returns immediately.
- `PATCH /api/discovery/clone-video/timeline` — `{ jobId, timeline }` → persists edited timeline (auth: owner + job's creatives path, same guard as `tweak`).
- `status` route already polls the job; add `exports` + render progress to its payload.

---

## 6. Build order

1. `Timeline` type + `AdComposition` in `remotion/`, previewed against a hand-written JSON (Remotion Studio) — prove it renders.
2. Worker: after clips exist, **emit `clone_meta.timeline`** from existing meta (captions/scenes/brand). No behaviour change yet — still ffmpeg-stitches too.
3. `<Player>` + inspector in `InlineVideoRemake` reading that timeline → **free live edits land here**.
4. `selfmade-render` container + `/render` + `/timeline` endpoints → export replaces ffmpeg stitch; multi-aspect.
5. Flip new remakes to render via Remotion; keep ffmpeg as fallback flag.

---

## 7. Prerequisites / risks (all Phase 1)

- **Render infra:** droplet container (no AWS). Cost = compute time only.
- **Remotion licence:** free at ≤3 people; company licence later.
- **Music rights:** small licensed library in R2 (Artlist/Uppbeat or curated royalty-free). Not solved by Remotion.
- **Biggest lift is here** (schema + `remotion/` + render worker). Phases 2–4 are UI + one Mello tool on this foundation.

## 8. Explicitly NOT in Phase 1

Storyboard-first / edit-before-generate (Phase 2), Mello chat-edit `edit_timeline` (Phase 3), style library + Playbook remake (Phase 4).

## After Phase 1 you can

Edit captions / CTA / colour / logo / music / aspect on any remake — instant + free — and export TikTok / Reel / Stories / Shorts from one project. UGC footage untouched; Cinematic assembly upgraded (transitions + precise trims).
