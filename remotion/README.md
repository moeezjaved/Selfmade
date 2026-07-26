# selfmade-remotion

Remotion compositions that assemble a Selfmade **ad timeline** into video — the preview + export engine that replaces the ffmpeg stitch. See `../docs/remotion-phase1.md` for the full plan.

Standalone package (like `worker/`), isolated from the Next app. Shares ONE type — `Timeline` in `../src/lib/video/timeline.ts` — so the app, the worker, and this package never drift.

## Run it

```bash
cd remotion
npm install
npm run dev          # opens Remotion Studio with the sample timeline
```

Studio shows `AdComposition` rendered from `src/sample-timeline.ts` — footage (a public sample clip) + captions + logo + CTA + end card. Edit the sample JSON and the preview updates live; that same JSON is what the worker will emit and the app will let users edit.

## Structure

- `src/index.ts` — `registerRoot`
- `src/Root.tsx` — registers `AdComposition`; dimensions/fps/duration come from the timeline
- `src/AdComposition.tsx` — the one composition (UGC = one video layer; Cinematic = sequenced scenes)
- `src/layers/` — `Captions`, `CtaButton`, `LogoMark`, `EndCard`, `MusicTrack` (all free-to-edit React layers)
- `src/sample-timeline.ts` — a hand-written timeline for local preview

## Render (Step 4 — the droplet worker uses this)

```bash
npm run render -- --props='<timeline json>'   # → out/video.mp4
```

## Not yet wired

Worker emitting real timelines (Step 2), the `<Player>` in the app (Step 3), and the render container (Step 4). This package renders standalone today.
