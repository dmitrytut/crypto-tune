# Clip share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "share a clip" dialog that renders the last 15/30 s of market as a 9:16 mp4 with sound, watermark and pair, and shares or downloads it.

**Architecture:** Live data of the last 35 s is kept in a pure `ClipBuffer`. On demand `main.ts` renders audio offline from it (`audio/offline.ts`, the real layers in a `Tone.OfflineContext`) and the picture with the real scene classes on hidden canvases (`ui/scene/clip-render.ts`), encoded by mediabunny in a lazy chunk.

**Tech Stack:** TypeScript, Tone.js 15, WebCodecs via mediabunny 1.65, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-01-clip-share-design.md`

## Global Constraints

- Dependency rules of `AGENTS.md` unchanged: `ui/` never imports `audio/`; `audio/` gets settings as params; `main.ts` wires.
- Clip: 1080×1920, 30 fps, H.264 `avc1.4d0028`, ~6 Mbit/s, key frame every 2 s; AAC-LC `mp4a.40.2` 48 kHz stereo 128 kbit/s; mp4 with `moov` first.
- Lengths `[15, 30]` s, default 30, plus 5 s pre-roll; buffer keeps 35 s of live data.
- Scene in the clip is phone-sized: 432×768 CSS px at pixel ratio 2.5.
- All user-facing text English. Specs in `__specs__/<module>.spec.ts`.
- Before commit: `pnpm check && pnpm test && pnpm build`.

---

### Task 1: ClipBuffer and history for a replay (metrics)

**Files:** Create `src/metrics/clip-buffer.ts`, `src/metrics/__specs__/clip-buffer.spec.ts`; modify `src/metrics/history.ts` (+ spec).

**Interfaces (produces):**
- `CLIP_LENGTHS_SEC = [15, 30] as const`, `type ClipSeconds`, `CLIP_PREROLL_SEC = 5`.
- `interface ClipTick { ts; snap: MetricsSnapshot | null; cues: EventCues }`.
- `interface ClipWindow { start; end; prerollMs; trades; liquidations; ticks }`.
- `class ClipBuffer { addTrade; addLiquidation; addTick; reset(); readiness(seconds) → { ready, leftMs }; window(seconds) → ClipWindow | null }`.
- `MarketHistory.addCues(now, cues)` (markers from a tick's cues; used by `main.ts` and the replay).
- `MarketHistory.before(ts): MarketHistory` — copy of everything complete before `ts`.
- `replayHistory(base: MarketHistory, w: ClipWindow): { series: HistorySeries; advanceTo(ts): void }`.

Steps: spec first (retention 35 s, readiness per length after reset, window bounds and pre-roll, `before` drops partial second/bucket and later markers, replay reveals data only up to `ts`), then implementation, `pnpm test`, commit.

### Task 2: Audio graph shared by live and offline (audio)

**Files:** Create `src/audio/graph.ts`, `src/audio/offline.ts`; modify `src/audio/engine.ts`, `src/main.ts` (type import).

**Interfaces:**
- `graph.ts`: `AudioParams` (moved from engine), `Graph` (+ `context`), `function* buildGraph(p)` (yields between layers), `class Conductor { bpm; update(s, g, sounding); play(cues, g) }` using `g.context` time and transport; `MASTER_DB`, `FADE_IN_SEC`, `LOOKAHEAD_SEC`.
- `engine.ts`: uses `buildGraph` with `wait(0)` per yield and `Conductor`; `withHeadroom(fn)` raises live `lookAhead` to 0.3 s while `fn` runs.
- `offline.ts`: `renderClipAudio(w: ClipWindow, p: AudioParams, sampleRate): Promise<AudioBuffer>` — sync build under swapped global context, ticks via `ctx.setTimeout`, pre-roll trimmed.

No specs (Tone files); verified by the browser smoke in Task 6.

### Task 3: Scene pieces for a fixed-size render (ui/scene)

**Files:** Modify `canvas.ts` (`fitCanvas(canvas, ratio?)`), `fx.ts` (option `pixelRatio`), `chart.ts` (options `pixelRatio`, `clock`; `reducedMotion: Pick<MediaQueryList, 'matches'>`). Create `clip-layout.ts` + spec.

**Interfaces:** `CLIP_STAGE = { w: 432, h: 768, ratio: 2.5 }`, `clipLayout()` rects and text positions in stage px; spec: inside frame, ordered top → bottom without overlaps.

### Task 4: Clip renderer and support check (ui)

**Files:** Create `src/ui/clip-format.ts` (constants + `clipSupport()`), `src/ui/scene/clip-render.ts` (mediabunny).

**Interfaces:**
- `clipSupport(): Promise<{ supported: true } | { supported: false; reason: 'no-webcodecs' | 'no-h264' | 'no-aac' }>`.
- `renderClipVideo(input: ClipVideoInput, onProgress, signal): Promise<Blob>`; input: window, seconds, history `{ series, advanceTo }`, audio buffer, labels (pair, watermark), period, thresholds.

### Task 5: Dialog, header icon, analytics, wiring

**Files:** Create `src/ui/components/clip-dialog/clip-dialog.{ts,css}`, `src/clip-share.ts` + `src/__specs__/clip-share.spec.ts`; modify `index.html`, `src/ui/app.ts`, `src/ui/styles/styles.css` (narrow header, `.segmented` moved here), `settings-panel.css`, `src/analytics.ts`, `src/main.ts`.

**Interfaces:**
- `clip-share.ts`: `clipShare(s: Settings, now: Date): { pair; watermark; title; text; url; fileName }` (spec: page pairs get `/slug/`, others `/`; simulator wording; `utm_source=clip`; file name).
- `analytics.ts`: `ClipTracker { support(result); recorded(pair, seconds, renderMs); shared(pair, method); failed(stage, reason) }`, support once per session.
- `AppHandlers.clip: ClipHandlers`, `AppView.enableClips()`.

### Task 6: Docs, checks, smoke, PR

README and AGENTS layout; `pnpm check && pnpm test && pnpm build`; browser smoke (Chrome + Safari, both lengths, ffprobe, sound, live audio during render, before Listen, narrow header 320/360/375); self-review; PR.
