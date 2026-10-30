# Particle Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make market bubbles/drops respond to tap and drawn strokes without stealing controls or changing market signals, with optional quiet sound.

**Architecture:** Pointer Events on the existing FX canvas feed a bounded coordinate buffer; the existing stage rAF consumes it to remove hit particles and reuse local pop/splash effects. DOM controls stay above the hit surface; native pan/zoom policy adapts to overflow. A UI callback through main triggers a dedicated rate-limited audio voice only while Listen is running and the sound setting is enabled.

**Tech Stack:** TypeScript, native DOM/CSS, Canvas2D/WebGL, existing Tone.js, Vitest. No dependencies.

**Spec:** `docs/research/2026-10-30-particle-interaction.md`, including its game-aesthetics supplement. Research alternatives are settled below.

## Global Constraints

- Worktree: `/Users/dmitrytut/dev/projects/crypto-tune.worktrees/particle-interaction`; branch `feat/particle-interaction` from master `c3c1e11`. Do not alter the original checkout, merge, or push.
- English UI/copy. Preserve current aura, palette, price and chart behavior; no game score, cursor trail, recursive explosions, new telemetry, or dependencies.
- Tap selects one nearest particle. Drag/swipe hits particles intersecting the actual sampled polyline, once per particle. No hover pop and no artificial cascade stagger.
- Mouse primary button only; one active pointer; second finger cancels game interaction and preserves pinch. Cancel, capture loss, blur, hidden page and reduced-motion changes clear pending game work.
- Fullscreen background uses `touch-action: pinch-zoom`; overflow or visual zoom uses `pan-y pinch-zoom`. This intentionally reserves vertical swipes for scrolling on short/zoomed pages; document that boundary.
- Controls, readouts, chart, dialogs, picker and hint popovers own their input. Hidden `.fades` descendants do not hit-test, but keyboard focus remains usable. Pointer capture is established before wake reveals controls.
- Preserve 120 ms film snap, 450 ms pop ring, 150 ms drop flash. No game-triggered market bloom/shock/shake, labels, chart markers, metrics, or EventBuffer cues.
- 64 queued segments maximum; no per-move object allocation. Overflow samples may be discarded but must not create a synthetic diagonal through unrelated objects. Consume every rAF, including a quick down/up between frames; cancelled strokes do not fire later.
- At most 24 fully detailed user effects per frame. Remove all intersected primaries immediately; simplify excess visual effects rather than backlogging. Bound live pop/impact effects at 128 each and enforce strict 1200 spray/spark limits, retaining existing automatic behavior under normal load.
- `interactionSound: boolean` defaults false, validated/persisted with existing Settings. `AudioParams.interactionSound` gates a dedicated quiet voice using the existing events channel. Only running audio; at most 10 sounds/sec globally, no delayed queues, no auto-resume, no interference with market voices.
- Permanent tests only for plausible observable geometry, cancellation, buffering and settings-validation bugs. DOM/audio wiring is exercised in browser/offline smoke, not tautological mock tests. Update README after proof.

## Review Focus

1. Invisible Listen becomes visible between pointerdown and click: the scene keeps the gesture and music never starts unexpectedly (browser smoke).
2. A tiny particle between two distant input samples still pops, but a particle inside the corner of an L-shaped stroke does not (geometry spec).
3. A quick tap released before the next rAF still fires once, while cancellation and second touch erase pending hits (buffer spec and browser smoke).
4. Vertical native scroll and pinch continue on short/zoomed screens; readouts and marker tooltips never become game gestures (mobile browser smoke; physical iOS remains an explicit verification limit if unavailable).
5. Dense repeated strokes stay bounded, and Stop/off/reduced motion cannot leave a queued sound or pop; market signals stay independent (stress/audio smoke).

---

### Task 1: Bounded stroke geometry and local particle destruction

**Files:** create `src/ui/scene/interaction.ts`, `src/ui/scene/__specs__/interaction.spec.ts`; modify `src/ui/scene/fx.ts`.

**Interfaces:**
- `PointerStroke`: `begin(x: number, y: number, padding: number): void`, `move(x: number, y: number): void`, `finish(): void`, `cancel(): void`, `drain(): void`; readonly `length`; `isTap(segment: number): boolean`; `distanceSq(x: number, y: number, segment = 0): number`; `hits(x: number, y: number, radius: number, segment = -1): boolean` (negative means the full buffered path). Per-segment tap/padding metadata preserves separate quick gestures. Package exports only.
- `Fx.interact(stroke: PointerStroke): void` consumes the current buffer; `FxHooks.touch(side: TradeSide, strength: number): void` is called at most once per consumed frame, using the strongest hit. Strength is normalized from the owned bubble size scale.

- [x] Write specs for point/segment endpoints/tangency, fast crossings, L-shaped paths, nearest-distance selection inputs, quick release preservation, cancel, separate strokes and bounded overflow without phantom diagonals.
- [x] Run `pnpm test src/ui/scene/__specs__/interaction.spec.ts`; observe failure because behavior does not exist.
- [x] Implement fixed storage and segment-circle distance math. The initial zero-length segment is a tap; subsequent actual moves turn it into a stroke. Drain keeps the active pointer endpoint for the next move; finish keeps pending points; cancel clears all.
- [x] Integrate immediate removal and reuse existing `pop`/`splash` at the object's current position. Suppress big-pop market bloom for manual effects, summarize hits, cap full effects and transient arrays, enforce per-particle factory output limits without a parallel physics model.
- [x] Run the geometry specs to green; later browser smoke proves real FX state changes and strict caps.

### Task 2: Input ownership, mobile gestures and immersive controls

**Files:** create `src/ui/scene/particle-input.ts`; modify `src/ui/scene/stage.ts`, `src/ui/app.ts`, `src/ui/styles/styles.css`.

**Interfaces:**
- `mountParticleInput(canvas: HTMLCanvasElement, stroke: PointerStroke, reducedMotion: MediaQueryList): () => void` owns Pointer Events and returns complete input cancellation for `Stage.clear(): void` (cancel input + clear FX); mounted once.
- `StageOptions.onParticleTouch(side: TradeSide, strength: number): void` forwards FX touch; `AppHandlers.onParticleTouch` has the same signature.

- [x] Read all LSP references before changing the exported option/handler contracts.
- [x] Route empty stage space through the existing canvas using pointer-events, keeping actual controls, readouts, chart and top-layer UI interactive. Ensure hidden fades and all their descendants do not hit-test, while focus-visible exclusions survive.
- [x] Bind one pointer, capture on down, consume final up coordinates, retain quick taps until rAF. Ignore repeated coordinates, right buttons and hover; clear on cancel, capture loss during an active gesture, blur, visibility, second pointer and reduced-motion changes. A normal implicit capture release after up must not erase a pending tap.
- [x] Use resize/visualViewport/ResizeObserver to choose native pan policy before the gesture; no geometry/layout reads in move handlers. Pointer coordinates remain viewport CSS pixels, matching Fx.
- [x] Before the existing `fx.frame`, call `fx.interact(stroke)`; clear stroke and FX on reset/visibility so old-pair hits never leak into a new pipeline.
- [x] Browser smoke: desktop tap/drag/hover/right-button/cancel; mobile touch/cancel/overflow; no hit from controls/chart/dialogs; hidden Listen stays stopped during scene gestures and keyboard can still reach it.

### Task 3: Opt-in interaction sound and discovery

**Files:** modify `src/settings.ts`, `src/__specs__/settings.spec.ts`, `src/audio/engine.ts`, `src/main.ts`, `src/ui/components/settings-panel/settings-panel.ts`, `src/ui/components/settings-panel/settings-panel.css`, `index.html`; add `src/audio/interaction-voice.ts` if a separate owned voice keeps engine focused.

**Interfaces:**
- `Settings.interactionSound: boolean`; `AudioParams.interactionSound: boolean`.
- `AudioEngine.touch(side: TradeSide, strength: number): void`: ignored while stopped/starting/off; no context start, no voice queue, global minimum spacing 0.1 sec. Clock rollback/restart must not silence the next session.
- The dedicated voice receives tonic changes and the events output channel. UI sends `onParticleTouch(side,strength)` through main; never via `audio.play`/EventCues.

- [x] Add a settings spec that retains true/false and rejects non-booleans, preserving migration from existing saved settings. Observe RED before adding the field/parser.
- [x] Implement the boolean and control in the existing Settings Sound section: visible label `Interaction sounds`, help explaining tap/drag, opt-in and Listen requirement. Use an accessible native checkbox and existing field/hint conventions, not a new design system.
- [x] Add one reusable quiet tonal voice, short 40–80 ms body with envelope ramps; distinguish buy/sell by pitch/color of sound without borrowing trade/gong voices. Keep the existing tonic and volume behavior. Turning the option off stops future strikes; no synthesizer is constructed per gesture.
- [x] Wire main/settings/app callbacks end to end and add About copy: `Tap or drag through the particles.` Explain sound can be enabled in Settings and requires Listen.
- [x] Run settings specs to green. Offline/browser smoke proves real non-silent voice output, bounded rapid triggering, unchanged market playback, persisted opt-in, silence before Listen/after Stop/off.

### Task 4: Integrated proof, documentation and review

**Files:** update `README.md` and this plan's progress; no production-only diagnostics/test hooks.
- [x] Start Vite from this worktree on a unique port, seed Simulator in the owned browser tab, and exercise actual pointer paths using real browser input. Inspect visual output at desktop and 390×844 mobile, plus short/zoomed/landscape layout and reduced motion. Record what was and was not physically tested.
- [x] In temporary page instrumentation, inspect live hit/removal/effects counts, capped bursts, sound gate/rate and frame timing. Compare before/after on the same worktree scenario rather than reuse old-branch numbers as a controlled baseline. Remove all temporary instrumentation by closing the tab.
- [x] Run `pnpm check`, `pnpm test`, `pnpm build`; fix only feature-related failures, report pre-existing ones explicitly. Preview production and repeat the key tap/drag, settings and cold-load checks; do not equate renderer timings with CWV field p75.
- [x] Update README with behavior, mobile gesture boundary, sound consent, verification commands and actual evidence. Add no claimed physical-device proof without devices.
- [x] Request a fresh independent review of affected code against the research, plan and consumer-visible edge cases. Trace each finding, fix real important issues with focused regression coverage/smoke, and run affected verification.
- [x] Leave the complete worktree on `feat/particle-interaction`; report path, plan, verification and remaining physical-device limits. No merge/push without user request.

## Execution decisions and progress

- User explicitly requested a plan **and execution** in a separate worktree; execute inline without a second approval round. Final review is independent; audio/settings implementation may be delegated as a disjoint slice with the interfaces above fixed.
- Baseline: master c3c1e11, 27 spec files / 172 tests passed; dependencies installed with `pnpm install --frozen-lockfile`.
- Research copied into this worktree so it travels with the plan; the original checkout's untracked documents remain untouched.

### Completed implementation and verification

- Task 1 complete: bounded geometry and FX, 10 stroke specs. Task 2 complete: captured input,
  CSS ownership and unified reset. Task 3 complete: persisted sound opt-in, dedicated voice,
  actual UI routing. Task 4 complete: browser proof, review, README and clean verification.
- Final commands: `pnpm check` clean (112 files), `pnpm test` **183/183** (28 files),
  `pnpm build` passed. Production module: 349.57 kB, 97.01 kB gzip.
- Browser proof used owned Chromium pages and trusted mouse/touch input. Desktop 1440×900:
  nearest-only overlap tap, two rapid taps, L-shaped drag, hover/right-button guards, hidden
  Listen capture, chart exclusion, dialog backdrop exclusion, keyboard focus. Mobile 390×844:
  vertical game sweep, two-finger cancellation, actual pinch scale 1 → 1.0769, reduced motion.
  Short 390×400: no hit while a scroll-eligible finger is held; vertical pan scrolled 90 px,
  dispatched pointercancel and left the seeded bubble alive. Landscape 844×390: document
  height 557 px, `pan-y pinch-zoom`, no horizontal overflow.
- Production preview repeated tap and drag against real rendered bubbles, not a development-only
  test API: Canvas instrumentation observed local pop rings at each target. Settings opt-in
  persisted and Listen stayed stopped during those gestures; no browser errors.
- Actual audio UI: default-off while listening produced no accent; enabling produced a sell
  accent; 100 eligible calls in one task added exactly one strike. Switching off and Stop left
  interaction gain at 0, with no new strikes. Offline output cancellation is recorded below.
- Dense 1500-primary synthetic scene, desktop-hosted mobile viewport: sweep hit-test ~0.4 ms;
  bounded immediate output 128 rings / 408 detailed droplets; 10 primary particles remained.
  FX-only p95 call duration before/after was ~0.6/~0.3 ms (not full GPU frame time).
  Worst-case 64-segment miss over 1500 primaries with CPU ×4: ~7.9 ms. Direct saturation probe:
  1200 sprays, 1200 sparks, 128 pops and 128 impacts, with no overshoot.
- One localhost production cold load: FCP/LCP entries 40 ms, unexpected shift entry ~0.0179.
  These are single local observations, not field p75 or proof of a CWV improvement.
- The static Impeccable markup scan reported one `flat-type-hierarchy` warning: it assumed all
  headings/body were 16 px. Rendered production price was 116 px and modal heading 18 px;
  the visually hidden h1 and incumbent layout were not redesigned. No full WCAG audit rerun.
- All temporary page instrumentation was removed by closing owned tabs; both Vite servers
  stopped. No scaffolds or new dependencies in production. Physical iOS/Android, Bluetooth
  latency, battery/thermal behavior and field CWV remain unmeasured.

### Review rulings and fixes

- Fresh independent review: `ParticleReviewFallback`. Specialized review provider failed before
  reading code (429), so a fresh general reviewer performed the code review instead.
- Ruling: use `Stage.clear()` and a returned input-cancel function rather than require every
  reset caller to remember separate input/FX operations. This prevents stale pointer ownership.
- Ruling: a 4 CSS-px slop absorbs finger jitter before a drag starts. RED→GREEN spec proved
  a held tap cannot repeatedly hit due to tiny moves; cost: deliberate sub-4px drags stay taps.
- Fixed important finding: a second quick tap erased the first. RED showed 1 queued segment
  instead of 2; per-segment tap/padding metadata now retains separate gestures. Trusted input
  popped the two intended objects and left their overlapping neighbor alive.
- Fixed important finding: scroll-eligible pointerdown could pop before native pointercancel.
  Reproduced with a held touch hitting before pan. Such touch taps now resolve on release;
  a clearly horizontal gesture activates the stroke, vertical movement stays native.
- Fixed important finding: audio lookahead could sound after Stop. Offline RED had peak
  0.0563 for a cancelled onset; a dedicated 5 ms gain ramp cancels future gain automation on
  Stop/off. GREEN peak for the cancelled interval is 0; the next permitted note peak is 0.0539.
- Minor, intentionally retained: after all 128 transient ring/flash slots are occupied, extra
  hits disappear immediately without another transient effect. This bounds overload instead
  of adding a new global flash or queue; normal/detailed hits remain unchanged. Revisit if a
  real-device density test finds the fallback visually confusing.
- Minor, intentional policy: any competing pointer device cancels the active stroke, not only
  a second finger. One pointer owns the gesture across devices; cost is no simultaneous
  mouse/pen/touch play. This is documented in the input controller.
