# Adaptive Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep particle play responsive under sustained load with automatic Full/Lite graphics and a persisted manual override.

**Architecture:** A pure frame-load controller chooses a quality level; the scene owns sampling and interruption resets. FX and aura own their rendering budgets. Settings expose the existing segmented-control pattern; no device fingerprinting, startup benchmark or extra dependencies.

**Tech Stack:** TypeScript, Canvas2D, WebGL, Vite, Vitest.

**Spec:** Approved conversation: adapt actual scene load rather than device identity; preserve input, metrics and music; Auto / Full / Lite; reduce particles, secondary effects, physics and background cost with hysteresis. Concrete implementation choices are recorded below.

## Global Constraints

- Separate worktree `adaptive-quality`, branch `feat/adaptive-quality`, based on reviewed interaction commit `4074322` (PR #39). Do not change/push adaptation into that PR.
- English UI; no dependencies; existing settings validation, radio controls, hints and module boundaries.
- Keep Full rendering budgets/physics unchanged. Lite: 400 primaries, 40 spawns/frame, 160 sprays and 160 sparks, 4 detailed manual hits/frame, 64 pop/impact transients and 64 liquidation rings/shards/labels each; FX DPR 1. Full retains 1500/120/1200/24/128 and DPR cap 2.
- Lite disables collision solving and its scratch collection, not basic particle movement, automatic pops, floor impacts or tap/swipe. Existing substeps remain; no alternative kinematics implementation.
- Lite aura: resolution scale 0.2 instead of 0.33, update at most 15 Hz; retain market colour updates. Chart/legend/text resolution stays unchanged.
- No changes to feeds, metric clocks, market cues, audio settings/graph, interaction sound consent or rate limits. Reduced-motion preference always wins over graphics choice.
- No hardwareConcurrency/deviceMemory/LoAF dependency. Measure visible rAF interval and own scene JS work only; these are not GPU timings or field CWV.

## Review Focus

- A long isolated stall must not permanently downgrade; sustained overload must. Two consecutive overloaded windows, not a single expensive frame.
- Hidden/resumed, resized/zoomed and reduced-motion-changed pages reset measurement and warm-up without forcing a quality level or replaying input.
- Lite headroom is not proof Full will fit: recovery is deliberately slow; manual Full/Lite must never be overridden by sampling.
- Downgrading a populated scene must cap existing particles, not only future spawns; pending hits still use last rendered positions before culling.
- Settings changes must not restart the market pipeline or stop music; Lite still respects native mobile scrolling/pinch and hidden Listen safety.

---

### Task 1: Pure load policy and persistence contract

**Files:** create `src/ui/scene/quality.ts`, `src/ui/scene/__specs__/quality.spec.ts`; modify `src/settings.ts`, `src/__specs__/settings.spec.ts`.

**Interfaces:** `GraphicsMode = 'auto' | 'full' | 'lite'` owned by settings, `Settings.graphics` defaults to `auto`. `QualityLevel` is `Exclude<GraphicsMode, 'auto'>`, owned by quality. `QualityController(mode, params = DEFAULT_QUALITY_PARAMS)` exposes `level`, `setMode(mode)`, `reset()` and `sample(frameMs, workMs): QualityLevel`.

**Policy:** 1000 ms warm-up and 1000 ms sampling windows. Overload: at least 20% of frames have own work >12 ms or interval >40 ms. Headroom: at least 95% have work <=4 ms and interval <=36 ms. Downgrade after 2 consecutive overloaded windows; restore after 20 consecutive headroom windows. Reset counters/warm-up after transitions/interruption, retaining chosen level. Manual modes bypass sampling; entering Auto retains current level. Parameters are typed and injectable for specs.
- [x] Write policy regressions for sustained overload, single stall, sustained recovery, broken streaks, warm-up, reset/visibility-sized gap, 30/60/120 Hz cadence, manual override and return to Auto; observe RED.
- [x] Write settings regression: preserve each explicit valid mode; old/malformed/non-string settings use Auto; observe RED.
- [x] Implement the scalar-only controller and validated settings field; no per-frame sample arrays or sorting.
- [x] Run targeted specs to GREEN, then full suite. Commit `feat: add adaptive graphics policy and persisted modes`.

### Task 2: Scene sampling and real rendering budgets

**Files:** modify `src/ui/scene/{stage,fx,aura,canvas}.ts` and `src/ui/app.ts`.

**Interfaces:** `StageOptions.graphics(): GraphicsMode`; `Fx.setQuality(level: QualityLevel): void`; `Aura.frame(dtSec: number, quality: QualityLevel): void`; `fitCanvas(canvas, maxDpr = 2): number` with unchanged default for chart/legend. The scene reads graphics from the same settings closure as trade threshold.
- [x] Read LSP references for changed exported contracts and migrate every caller.
- [x] Feed actual visible-frame interval plus measured scene JS duration to the controller after rendering. Apply its level on the next frame; skip rendering/sampling while hidden. Reset on visibility/resize/visualViewport resize/reduced-motion change; first resumed frame has dt 0.
- [x] Keep hit-testing before motion and culling. Apply profile limits to current arrays every frame, preserving newest primary age order with in-place truncation, not allocating removed arrays. Shared local limits replace obsolete budget constants.
- [x] In Lite, skip collision list building/solving while retaining the existing movement loop; bound both automatic and manual secondary creation. Lower only FX backing resolution.
- [x] Throttle only the aura in Lite and integrate accumulated elapsed time; use the Lite shader resolution. Keep chart updates and input on each rAF.
- [x] Smoke the real scene in both profiles: current-body cap, no stale collisions, automatic pop/splash, ordered gestures, native scroll/pinch, reduced motion, profile transitions and no hidden-tab replay. Compare synthetic Full/Lite costs, not hardware labels.
- [x] Run full check/test/build. Commit `feat: apply adaptive scene and aura quality budgets`.

### Task 3: User control, integration proof and documentation

**Files:** modify `index.html`, `src/ui/components/settings-panel/settings-panel.ts`, `README.md` and this plan.

**Interfaces:** existing native segmented fieldset `#graphics` with radio values auto/full/lite, visible labels Auto/Full/Lite, accessible group label and the standard settings hint.
- [x] Bind the persisted control using existing source/period conventions; explain Auto and Lite without suggesting data/music changes. Reuse radio binding if it removes real duplication; no new widget or stylesheet.
- [x] Real-browser proof: change all modes, reload to prove persistence; force sustained measured JS load to exercise actual Auto downgrade and delayed recovery, not a mocked controller return. Verify manual override, resize/visibility resets and no audio/pipeline restart.
- [x] Visually inspect desktop/mobile settings and scene, repeat interaction/native pan/reduced-motion checks, and observe browser errors. Verify production cold start and native interaction after build. Remove throwaway browser instrumentation by closing owned pages.
- [x] Update README with behavior, exact limits, checks and honest physical-device/CWV limits. Run `pnpm check && pnpm test && pnpm build`.
- [x] Obtain fresh independent policy/rendering and settings/requirements reviews; trace and fix confirmed important findings. Commit complete adaptation separately; do not merge or push it without a user request.

## Execution ledger

- Baseline: worktree created at `4074322`; isolated `pnpm test` passed 195 tests / 29 files. PR #39 is open, so adaptation is stacked until that PR merges.
- Ruling: Lite uses a lower-resolution aura at <=15 Hz rather than a frozen image or new CSS renderer, preserving current market colours and avoiding a second rendering implementation. Cost: some background GPU work remains.
- Ruling: count consecutive completed windows rather than accumulating one giant frame's duration as several seconds of overload; this prevents a single stall from deciding quality.
- Ruling: keep existing substepped kinematics in Lite and skip only contacts; this avoids duplicated physics while the 400-primary cap limits the remaining work.

### Results and review decisions

- Task 1: `773c365`, policy/settings RED→GREEN; full suite 206/206 across 30 files.
  Task 2: `70a0007`, real scene sampling and renderer budgets, check/build and suite green.
- Reused native segmented-radio construction for Period and Graphics, with typed choices and
  the existing settings hint. Keyboard ArrowRight selected Full; Lite and period 5 persisted
  through reload. No new component, stylesheet, dependency or production diagnostic API.
- Actual measured-load smoke: a temporary 20 ms busy loop inside the real FX frame caused Auto
  Full→Lite after 3047.9 ms. After removing it, Lite remained at 2 s and Full returned after
  21034.3 ms. Manual Full survived 3.5 s of the same sustained load. Music stayed running on
  the same audio graph, with unchanged audio parameters and zero simulator reconnects.
- A 1500-primary scene downgraded to 400 current primaries, retaining the newest 400. A pending
  hit on the oldest visible target popped it before culling. Lite made zero solver calls,
  while Full separated an overlapping pair. Automatic pop/splash saturation stopped at
  64 pops, 64 impacts, 160 sprays and 160 sparks; scratch lists emptied.
- Timing probe: deterministic mixed-side fixture with 10% larger trades, 390×844, CPU ×4,
  browser DPR 1.25, alternating Full/Lite/Lite/Full. At 16.7 ms simulation steps, FX-call p95
  was 18/1.2 ms; at 100 ms steps, 38.2/1.8 ms. Normal variants had 50 samples each; slow
  variants had 10. Profiles intentionally differ in particle count and contacts; this is
  neither an equal-density solver benchmark nor full GPU time or field CWV.
- Lite aura made 13 calls in a 1 s observation and rendered at 78 px for a 390 px CSS width.
  Coherent iPhone 13 emulation (390×844, DPR 3) verified FX DPR 1 and chart DPR 2 in Lite.
  Native short-screen pan scrolled 91 px without popping; pinch reached 1.3254 and cancelled
  input. Reduced motion cleared particles and the pending stroke.
- Resize reset was native. Visibility handlers were exercised using a temporary hidden-state
  override and visibility events: queues/input cleared, streaks reset, warm-up restored,
  music kept running. Two foreground/background attempts in managed Chromium left native
  visibility visible; no physical background-tab lifecycle claim is made.
- Final Standards review: no findings. Spec review: no concrete behavior bug; missing README
  guidance was fixed with profile limits, verification and evidence limitations.
- Final native mobile testing also exposed a pre-existing interaction bug: a compatibility
  click could target newly revealed Listen after the original canvas touch. Fixed and pushed
  to PR #39 as `4394eb6`, then cherry-picked here as `b112281`. RED→GREEN included reduced
  motion, stopped/running Listen, deliberate control presses, pan/pinch and keyboard activation.
  See the interaction plan's compatibility-click regression for the exact trace.
- Production preview: default Auto/stopped; native click on an actual rendered buy bubble
  produced a local ring at the same position while audio stayed stopped. Lite persisted on
  reload; production iPhone emulation kept hidden Listen stopped with and without reduced
  motion, FX DPR 1/chart DPR 2. Desktop/mobile visuals inspected; no browser errors. Owned
  proof pages closed, removing all instrumentation.
- Final exercised commands: check clean (118 files), 206/206 tests, production build passed.
  JS module 354.53 kB / 98.84 kB gzip, about +1.03 kB gzip over reviewed interaction PR #39.
- Ruling: Lite also bounds existing liquidation decorations and labels at 64 each, while Full
  retains legacy behavior — otherwise non-trade decoration could evade the low-load profile.
  Cost: old decoration may disappear sooner during a large cascade.
- No physical Safari/iOS/Android, battery/thermal or field CWV proof. Keep adaptation local
  and separate from PR #39; the branch remains stacked until that PR is integrated.
