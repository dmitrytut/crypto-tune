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

### Master integration: 5ab9ea9

- Fetched `origin/master` and checkpointed the completed interaction feature as `848c3d1`
  before merging. Upstream adds PR #38: `CollisionSolver`, collision specs and substepped
  particle movement in `Fx`. No upstream feed, audio, settings or input changes.
- Resolved both merge conflicts: retain collision and interaction imports in `fx.ts`, and
  retain both feature descriptions in README. No runtime compatibility fix was needed.
- Independent standards review found no dependency/ownership violations. Independent spec
  review found no confirmed incompatibility. The identified performance concern was measured
  rather than dismissed: collision sorting/sweeping runs on every movement substep.
- Trusted desktop input against colliding particles popped only the nearest target. The
  removed object was absent from eight subsequent solver groups. A corner-shaped drag popped
  all three on-path targets and left the off-path target alive. Hit-testing still precedes
  movement, so it uses the last rendered positions rather than future collision positions.
- Automatic buy pop and sell floor splash still removed their primaries, created their local
  effects and emitted no interaction cue. Collision scratch lists emptied after the frame
  and after clear. No manual hit produced market bloom, shock or shake.
- Mobile 390×844 trusted touch sweep popped the three on-path targets, not the off-path target.
  Reduced motion cleared primaries, stroke and collision groups. At 390×400, a held touch did
  not pop; vertical pan scrolled 89 px and left the target alive under `pan-y pinch-zoom`.
- Actual Listen + enabled interaction sound: ten frames of collision movement produced zero
  interaction notes; a real particle tap produced one. Stop left gain at zero and rejected
  twenty subsequent touch calls. Tapping a particle over hidden Listen kept audio stopped.
  No browser errors; desktop canvas surface visually inspected.
- CPU probe: owned Chromium, 390×844, CPU ×4, deterministic mixed-side fixtures with 10% larger
  trades. Compared the merged frame with its solver temporarily disabled in that page only;
  kinematics/rendering otherwise retained, fixtures reset between alternating variants.
  This is not a comparison against the old production bundle and not a full GPU frame.

  | Primaries | Simulation step | Approx. p95 without solver | Approx. p95 with solver |
  | --------- | --------------- | -------------------------- | ----------------------- |
  | 300       | 16.7 ms         | 2.5 ms                     | 1.7 ms                  |
  | 300       | 100 ms          | 2.0 ms                     | 3.9 ms                  |
  | 1500      | 16.7 ms         | 13.5 ms                    | 17.0 ms                 |
  | 1500      | 100 ms          | 8.7 ms                     | 42.8 ms                 |

  Normal-step variants had 50 samples each, slow-step variants 10. Warm-up was not isolated;
  do not read the small-scene inversion as a collision speedup. Maximum observed merged slow
  stress frame: 83.9 ms. Dense scenes after a long frame remain a mobile performance risk;
  this integration does not silently change master physics or promise field CWV results.
- Combined verification: `pnpm check` clean (115 files), `pnpm test` **193/193** (29 files),
  `pnpm build` passed. Module 350.99 kB / 97.63 kB gzip, about +0.62 kB gzip over the feature
  checkpoint. No new dependencies or permanent diagnostic hooks. Owned proof tab closed.
- LAN reverse proxy remains at `http://192.168.1.12:5173/`, forwarding to the worktree's Vite
  on `127.0.0.1:5174`. Physical-device thermals, GPU frame times and field CWV remain unmeasured.

### Pre-PR review and cleanup

- Standards axis: fixed the missing `@package` boundary on `mountParticleInput`; LSP confirmed
  its only consumer is `scene/stage.ts`. Named the repeated touch padding and combined the
  identical mouse/pen button guard without changing touch ownership.
- Spec axis: reproduced reversed cascade order in the browser: particles created at x=350
  then x=150 popped in that order during a left-to-right stroke. Crossings now use the first
  segment/circle intersection, including padding, not array order or centre projection.
  Only touched bodies are sorted in reused scratch storage; primary age order stays intact.
- Regression geometry specs went RED before `entryFraction` existed, then GREEN (12 stroke
  specs). Browser rerun proved both gesture directions; with 30 reverse-created targets,
  the first 24 crossings received detailed effects and later crossings used the fallback.
- Removed repeated empty-array allocation from FX clear and consumed trade queues. Browser
  proof confirmed reused queues/primary storage, empty reset state and no replayed queued trade.
- Retained the simple nearest-tap scan/compaction: bounded linear work and preserved primary
  age ordering are preferable to a separate deletion path without a demonstrated bottleneck.
- Trusted desktop input removed only on-path targets. Mobile fitting-screen sweep popped
  three targets and spared the off-path one; short-screen native pan scrolled 91 px without
  popping its target. No browser errors; owned proof pages closed.
- Specialist reviewer provider was unavailable (429 before code access); two fresh general
  reviewers independently checked Standards and Spec. No unrelated restructuring or adaptive
  quality changes are included in this PR.

### Mobile compatibility-click regression

- A coherent iPhone 13 device profile exposed a missed case: pointerdown/up target the canvas,
  but Chrome generates later mouse events and a click targeting the now-revealed `audio-label`.
  Before the fix, a stopped Listen became running. Viewport-only touch smoke did not catch it.
- Cancelling pointerdown suppresses compatibility mouse focus, but a separate browser probe
  proved it does not suppress that click. The input controller now owns the resulting physical
  click until consumed or another pointerdown begins, and blocks only retargeting away from
  the canvas. Keyboard/assistive clicks (detail 0) and subsequent deliberate control presses
  remain native. No timeout, delayed UI wake or touchstart cancellation.
- Ownership is established even under reduced motion, before the game-only guard; otherwise
  reduced-motion users would still accidentally start Listen when waking the chrome.
- Native browser RED→GREEN: hidden stopped Listen stays stopped with and without reduced
  motion; hidden running Listen stays running. A deliberate visible touch still starts music.
  Short-screen pan scrolled 91 px without a pop, pinch reached scale 1.3254 and cancelled the
  pending stroke, and keyboard Enter still opened Settings after a cancelled touch gesture.
  No browser errors; owned pages closed. Physical Safari/iOS remains unverified.

### PR #40 sync with master 9c748a9

- Master adds PR #41 gesture feedback: press rings, short trails and a stationary reduced-motion
  acknowledgment. The only merge conflict was the input guard in `particle-input.ts`.
- Retained compatibility-click ownership and mouse-focus suppression before the gesture guard,
  but removed its reduced-motion rejection: the frame loop suppresses market particles while
  retaining the new acknowledgment. Active/blocked-pointer and hidden-page checks remain.
- Browser seam RED→GREEN: accepting the old guard produced zero feedback marks under reduced
  motion; the combined guard produced one stationary ring with radius 8, no trail and no market
  particles. Hidden stopped Listen stayed stopped in both motion modes; hidden running Listen
  stayed running, and a deliberate visible touch still started audio.
- Native mouse corner trail contained the vertical and horizontal legs, never a diagonal; its
  three marks expired. A second finger cleared feedback. Mobile swipe removed three on-path
  particles and spared the off-path one. Short-screen pan scrolled 91 px with no pop or feedback;
  pinch reached 1.3254 and left no pending input/feedback. Keyboard Enter still opened Settings.
- Desktop surface visually inspected; temporary instrumentation removed by closing owned tabs.
  One external Umami script request was aborted during device emulation/reload; no application
  exception was reported. Analytics behavior was not changed.
- `pnpm check`, 195 tests / 29 files and production build passed. Physical Safari/iOS remains
  unverified. No adaptive-quality changes are included.
