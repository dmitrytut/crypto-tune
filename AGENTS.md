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
  (`binance.ts`), `simulator.ts`, later `replay.ts`, `mexc.ts`. `reconnecting-socket.ts` owns
  backoff and the silence/connect watchdog.
- `src/metrics/` — pure math (`rolling.ts`, `stats.ts`, `tension.ts`) plus `engine.ts`, which buckets
  trades into 250 ms ticks on the feed clock and emits `MetricsSnapshot`.
- `src/audio/` — Tone.js layers, events, mixer (stage 2+).
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
  ui       → metrics/ (types only), feed/market-feed, settings
  main.ts  → everything; the only place concrete implementations are wired together
  ```

  `ui → metrics` "types only" is a convention: Biome cannot tell `import type` apart.
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

## Conventions

- Tests live next to the code they cover, in a `__specs__/` folder inside that module's directory,
  named `<module>.spec.ts` (e.g. `src/metrics/rolling.ts` → `src/metrics/__specs__/rolling.spec.ts`).
  Never `*.test.ts`, never a top-level `tests/` dir; vitest only picks up `src/**/__specs__/**/*.spec.ts`.
- Metrics stay pure and covered by specs; new metric math goes in `src/metrics/` with a spec.
- Metrics run on `feed.now()`, never `Date.now()`, so replay speed-ups and throttled timers do not
  distort statistics.
- Every audio parameter change goes through `rampTo`/scheduled ramps — no clicks, no volume jumps.
  Tempo/register switches are quantized to bar boundaries.
- Feed adapters normalize to `Trade`/`Liquidation`: `side` is the aggressor; a forced SELL is a
  `long` liquidation.
- Exchange endpoints come from current official docs, never guessed. Binance USDⓈ-M uses the
  routed `/market` base (legacy `/ws` was decommissioned 2026-04-23).
- Biome formats (2 spaces, single quotes, width 100). Do not hand-format against it.

## Git

- Work on branches off `master` (`feat/<stage-or-topic>`); one stage per branch.
- Update `README.md` at the end of each stage (what's done, how to verify).
