# AGENTS.md

Browser-only sonification of a futures market: calm generative music that tightens with price
shocks. Vite + TypeScript (no framework), Tone.js for audio, no backend. Plan and decisions:
`docs/plan.md`.

## Commands

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # vitest, unit tests
pnpm typecheck    # tsc (TypeScript 7)
pnpm check        # biome lint + format check; `pnpm check:fix` to apply
pnpm build        # typecheck + production bundle
```

Before committing: `pnpm check && pnpm test && pnpm build`.

## Layout

- `src/feed/` — `MarketFeed` contract (`market-feed.ts`) and its implementations: exchange adapters
  (`binance.ts`, which also loads 30 min of REST `aggTrades` on connect so metrics start warm),
  `simulator.ts`, later `replay.ts`, `mexc.ts`. `reconnecting-socket.ts` owns backoff and the
  silence/connect watchdog. History is emitted before live events, trades always in `ts` order.
- `src/metrics/` — pure math (`rolling.ts`, `stats.ts`, `tension.ts`) plus `engine.ts`, which buckets
  trades into 250 ms ticks on the feed clock and emits `MetricsSnapshot`.
- `src/audio/` — Tone.js graph. `engine.ts` (`AudioEngine`: start/stop/update, built lazily on the
  first user gesture), `mixer.ts` (layers → reverb → compressor → limiter → master),
  `base-layer.ts` (drone with chord drift + arpeggio), `ambience-layer.ts` (Eno bell loops + pulse,
  base channel), `tension-layer.ts` (sub, percussion, riser, shock swell), `events-layer.ts`
  (liquidation gongs, trade plucks). Pure, spec-covered: `scale.ts`, `arp-pattern.ts`,
  `tension-map.ts` (tension/direction → every sound parameter; `stepShock` detector),
  `events-map.ts` (cascade collapse, size → velocity, voice placement). Event flow:
  `AudioEngine.onTrade/onLiquidation` buffer events above threshold, `flushEvents(feed.now())`
  plays at most one voice per kind per tick.
  Keep anything testable out of Tone-importing files: Tone needs a browser AudioContext.
  Layers use their own node's context (`this.loop.context.transport`), not `Tone.getTransport()`,
  so they also render in `Tone.Offline`.
  Never automate `transport.bpm` with `rampTo` per tick: it crashes Tone 15's clock after about a
  minute. Write whole-BPM steps with `setValueAtTime` only when the value changes.
  Transport vs context time: `Loop.start`/`scheduleOnce` take transport time, so place loops once
  with `start(0)` (or tick strings like `` `${n}i` ``) and let transport start/stop drive them;
  never pass `Tone.now()`. `transport.nextSubdivision` returns context time: convert with
  `getTicksAtTime` before scheduling on the transport.
- `src/ui/` — DOM view; `index.html` holds the static markup.
- `src/settings.ts` — persisted settings (localStorage), validated field by field on load.
- `src/main.ts` — wiring: settings → feed → metrics → UI/audio.

## Code organization

Enforced by Biome (`biome.json`): violations fail `pnpm check`.
- **Dependency direction** (`noRestrictedImports` overrides per folder; specs exempt):

  ```
  feed     → nothing from src/
  metrics  → feed/market-feed only
  audio    → metrics/, feed/market-feed; settings arrive as params, never imported
  ui       → metrics/ (types and domain constants only), feed/market-feed, settings
  main.ts  → everything; the only place concrete implementations are wired together
  ```

  `ui → metrics` "no computation" is a convention: Biome cannot restrict what is imported, only from where.
- **No import cycles** (`noImportCycles`).
- **Types live with their owner.** Declare a type in the file that produces or accepts it
  (params, results, options, state); consumers import it from there.
- **A shared contract file only for a real seam**: an interface with two or more implementations
  plus the data they exchange (`feed/market-feed.ts`: Binance, simulator, replay, MEXC). Name it by
  purpose, not by kind. No `types.ts`, no `src/types/`, no "types" folder inside a module.
- **Internal types stay unexported**: wire formats (`AggTradeMsg`), internal state (`Regime`).
  Exchange DTOs never leave their adapter; the rest of the app sees only `Trade`/`Liquidation`.
- **Exports used only inside the module's folder** (helpers shared by sibling files, functions
  exported for specs) get a `/** @package */` JSDoc tag; `noPrivateImports` then rejects imports
  from other folders. Untagged exports are public.
- **Constants live with their owner too.** No `consts.ts`, `constants.ts` or `config/` dump.
  - Implementation constant used by one file: `UPPER_SNAKE` at the top of that file, unexported,
    documented when the value is not self-evident (units, source).
  - Tunable parameters: a typed `DEFAULT_X: X` object next to type `X`
    (`DEFAULT_TENSION_PARAMS`, `DEFAULT_SIM_PARAMS`). Code receives them as arguments rather than
    reading module constants, so specs and the simulator can substitute values.
  - Domain constant needed by 2+ modules: exported once from the module whose semantics define it
    (`TICK_MS` from `metrics/engine`, `TENSION_LEVELS` from `metrics/tension`). Never duplicate the
    literal elsewhere, markup included: derive positions/labels from the constant.
  - Magic numbers: name a value when its meaning is not obvious at the use site or it appears
    twice; model coefficients belong in the params object. Self-evident literals (`1000` ms/s, `0.5`
    in a jitter formula) stay inline. Put units in the name or doc (`_MS`, `_SEC`, `Usd`).

## Conventions

- Tests live next to the code they cover, in a `__specs__/` folder inside that module's directory,
  named `<module>.spec.ts` (e.g. `src/metrics/rolling.ts` → `src/metrics/__specs__/rolling.spec.ts`).
  Never `*.test.ts`, never a top-level `tests/` dir; vitest only picks up `src/**/__specs__/**/*.spec.ts`.
- Metrics stay pure and covered by specs; new metric math goes in `src/metrics/` with a spec.
- Metrics run on `feed.now()`, never `Date.now()`, so replay speed-ups and throttled timers do not
  distort statistics.
- Every audio parameter change goes through `rampTo`/scheduled ramps — no clicks, no volume jumps.
  Quantized switches land on the grid: double time on the next beat, contour on the next note,
  chord changes on bar lines.
- Feed adapters normalize to `Trade`/`Liquidation`: `side` is the aggressor; a forced SELL is a
  `long` liquidation.
- Exchange endpoints come from current official docs, never guessed. Binance USDⓈ-M uses the
  routed `/market` base (legacy `/ws` was decommissioned 2026-04-23).
- Biome formats (2 spaces, single quotes, width 100). Do not hand-format against it.

## Git

- Work on branches off `master` (`feat/<stage-or-topic>`); one stage per branch.
- Update `README.md` at the end of each stage (what's done, how to verify).

## Review feedback

- **Verify every finding first** (reproduce or trace the code). A reviewer can be wrong. A finding
  that does not reproduce is answered with the evidence, not "fixed".
- **Fix** real findings whose impact justifies the cost. Fix the root cause rather than the
  symptom. Add a spec that fails without the fix when the bug is plausible to regress.
- **Skip with a comment** when either holds:
  - the fix is hard or invasive **and** the impact is small;
  - the scenario is an unrealistic or very unlikely corner case for this app.

  The comment states the reason (impact, likelihood, cost) and what would change the decision.
  Never skip silently.
- **Partial fixes** say what is covered and what remains, with the reason.
- Push fixes to the same PR branch, then reply **once** on the PR with a table:
  finding → decision (fixed / skipped / partially) → commit or reason.
