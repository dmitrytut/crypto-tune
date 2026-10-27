# Trade particles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пузыри покупок и капли продаж получают форму, материал и заметный конец жизни, а потоки
взаимодействуют: деформация, плёнка, капля-слеза, лопание, аннигиляция, слияние, пена и осадок —
по одной идее на коммит, от простого к сложному.

**Architecture:** Чистая логика уходит из canvas-кода в новые модули `src/ui/scene/` со спеками:
`particle.ts` (деформация, кадры, брызги), `grid.ts` (пары касаний), `annihilate.ts`, `merge.ts`,
`layers.ts`. Спрайты — в `sprites.ts`. `fx.ts` остаётся оркестратором: массивы частиц, кадр,
отрисовка. `stage.ts` сообщает `Fx` верх полосы графика (`setFloor`).

**Tech Stack:** TypeScript 7, Canvas 2D, vitest (environment `node`), Biome. Без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-27-trade-particles-design.md`

## Global Constraints

- Ветка `feat/trade-particles` (уже создана от `master`, спек закоммичен). Одна задача — один
  коммит; задачи идут строго по порядку.
- Перед каждым коммитом: `pnpm check && pnpm test && pnpm build`. Biome форматирует (2 пробела,
  одинарные кавычки, ширина 100): после правок `pnpm check:fix`, не форматировать вручную.
- Спеки: `src/ui/scene/__specs__/<module>.spec.ts` и `src/ui/__specs__/palette.spec.ts`, vitest.
  Окружение `node`: в спеках нет DOM, поэтому всё, что трогает `document`/canvas, живёт только в
  `sprites.ts` и `fx.ts` и спеками не покрывается.
- Новые экспорты внутри `src/ui/scene/` и `palette.ts`, нужные только `ui/`: JSDoc `/** @package */`.
- `noUncheckedIndexedAccess` включён: доступ по индексу — через `as number` / `as T`, как в
  `metrics/rolling.ts`. Никаких `!`.
- Константы реализации — `UPPER_SNAKE` в начале файла, единицы в имени (`_SEC`, `_PX`), с
  комментарием, если значение не очевидно. Литерал, нужный двум файлам, экспортируется из одного
  (`MIN_R_PX` из `spawn.ts`).
- При `prefers-reduced-motion` частиц нет совсем (`app.ts:313`, `stage.ts:72`): отдельной
  обработки не добавлять.
- Тексты в UI не добавляются.
- Все значения из спека — стартовые. Если при проверке на глаз значение явно плохое, поменять его в
  этом же коммите и записать новое в спек (раздел идеи).

## Файлы

| Файл                                                                             | Задачи     |
| -------------------------------------------------------------------------------- | ---------- |
| `src/ui/scene/sprites.ts` (новый)                                                | 0, 2, 3, 6 |
| `src/ui/scene/particle.ts` (новый)                                               | 1, 3, 4    |
| `src/ui/scene/grid.ts` (новый)                                                   | 5          |
| `src/ui/scene/annihilate.ts` (новый)                                             | 6          |
| `src/ui/scene/merge.ts` (новый)                                                  | 7          |
| `src/ui/scene/layers.ts` (новый)                                                 | 8          |
| `src/ui/scene/fx.ts`                                                             | 0–4, 6–8   |
| `src/ui/scene/spawn.ts`                                                          | 1, 4       |
| `src/ui/scene/stage.ts`                                                          | 4          |
| `src/ui/palette.ts`                                                              | 2, 3       |
| `src/ui/scene/__specs__/{particle,grid,annihilate,merge,layers}.spec.ts` (новые) | 1, 3–8     |
| `src/ui/__specs__/palette.spec.ts`                                               | 2          |
| `README.md`, `AGENTS.md`, спек                                                   | 9          |

## Проверка на глаз (каждая визуальная задача)

1. `pnpm dev` (сервис, порт 5173), открыть `http://localhost:5173/`.
2. ⚙ Settings → Source: **Simulator**, Sensitivity ×2 (шоки чаще). Частицы летят без **Listen**.
3. Смотреть 30–60 с, дождаться шока (аура краснеет/рвётся, падают капли). Сделать скриншот.
4. Частота кадров при шоке — в консоли страницы:

   ```js
   let n = 0; const t0 = performance.now();
   (function f() { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else console.log((n / 5).toFixed(1), 'fps'); })();
   ```

   Сравнить с тем же замером на предыдущем коммите; заметное падение — повод упростить в этом же
   коммите.

---

### Task 0: Спрайты в `sprites.ts`

Чистый перенос, видимых изменений нет. Дальше каждая идея правит свой спрайт, не раздувая `fx.ts`.

**Files:**
- Create: `src/ui/scene/sprites.ts`
- Modify: `src/ui/scene/fx.ts:1-5` (импорты), `:11` (`SPRITE_PX`), `:77-125` (функции спрайтов)

**Interfaces:**
- Produces: `bubbleSprite(c: Rgb): HTMLCanvasElement`, `dropSprite(c: Rgb): HTMLCanvasElement`,
  `haloSprite(c: Rgb): HTMLCanvasElement` — все `@package` из `./sprites`.

- [ ] **Step 1: Создать `src/ui/scene/sprites.ts`**

```ts
import { css, type Rgb } from '../palette';

/** Edge of every sprite, px: drawn once, scaled per particle. */
const SPRITE_PX = 128;

/** A sprite square filled with a radial gradient through `stops` (offset, CSS colour). */
function radialSprite(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = SPRITE_PX;
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/**
 * Soap bubble: clear centre, bright rim, specular glint. Reads as "rising, light".
 * @package
 */
export function bubbleSprite(c: Rgb): HTMLCanvasElement {
  const s = radialSprite([
    [0, css(c, 0.16)],
    [0.62, css(c, 0.22)],
    [0.84, css(c, 0.95)],
    [0.92, css(c, 0.4)],
    [1, css(c, 0)],
  ]);
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const glint = g.createRadialGradient(h * 0.68, h * 0.62, 0, h * 0.68, h * 0.62, h * 0.24);
  glint.addColorStop(0, 'rgba(255,255,255,0.9)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/**
 * Ember drop: hot white core in a coloured glow. Reads as "falling, heavy".
 * @package
 */
export const dropSprite = (c: Rgb) =>
  radialSprite([
    [0, 'rgba(255,255,255,0.95)'],
    [0.22, css(c, 0.95)],
    [0.55, css(c, 0.35)],
    [1, css(c, 0)],
  ]);

/** @package */
export const haloSprite = (c: Rgb) =>
  radialSprite([
    [0, css(c, 0.5)],
    [0.4, css(c, 0.16)],
    [1, css(c, 0)],
  ]);
```

- [ ] **Step 2: Убрать спрайты из `fx.ts`**

Удалить строку `const SPRITE_PX = 128;` и блок от `/** A sprite square filled with a radial
gradient…` до конца `haloSprite` (строки 77–125). Добавить импорт:

```ts
import { bubbleSprite, dropSprite, haloSprite } from './sprites';
```

- [ ] **Step 3: Проверить**

Run: `pnpm check && pnpm test && pnpm build`
Expected: всё зелёное. На глаз (см. «Проверка на глаз») — без изменений.
- [ ] **Step 4: Commit**

```bash
git add src/ui/scene/sprites.ts src/ui/scene/fx.ts
git commit -m "refactor: particle sprites in their own module"
```

---

### Task 1: С3 — упругая деформация

**Files:**
- Create: `src/ui/scene/particle.ts`, `src/ui/scene/__specs__/particle.spec.ts`
- Modify: `src/ui/scene/spawn.ts` (`MIN_R_PX`), `src/ui/scene/fx.ts` (`Bubble`, `spawn`, `frame`,
  `drawBubbles`)

**Interfaces:**
- Produces (`@package`, `./particle`):
  - `interface Mat2 { a: number; b: number; c: number; d: number }` — порядок `setTransform`.
  - `stretchAt(side: TradeSide, speed: number, age: number, r: number): number`
  - `stretchAlong(ux: number, uy: number, k: number): Mat2`
- Produces (`./spawn`): `MIN_R_PX = 4.5` (`@package`).
- Produces (`fx.ts`, модульная функция): `setLocal(ctx, m: Mat2, x, y, dpr): void`;
  `Bubble.side: TradeSide`.

- [ ] **Step 1: Write the failing test** — `src/ui/scene/__specs__/particle.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { type Mat2, stretchAlong, stretchAt } from '../particle';

const det = (m: Mat2) => m.a * m.d - m.b * m.c;
const apply = (m: Mat2, x: number, y: number) => [m.a * x + m.c * y, m.b * x + m.d * y] as const;

describe('stretchAt', () => {
  /** Long after birth: the wobble is gone. */
  const SETTLED = 10;

  it('leaves a particle at rest round once the birth wobble has died out', () => {
    expect(stretchAt('buy', 0, SETTLED, 10)).toBeCloseTo(1, 6);
    expect(stretchAt('sell', 0, SETTLED, 10)).toBeCloseTo(1, 6);
  });

  it('stretches with speed up to a cap, drops further than bubbles', () => {
    expect(stretchAt('buy', 40, SETTLED, 10)).toBeCloseTo(1.1, 6);
    expect(stretchAt('buy', 1_000, SETTLED, 10)).toBeCloseTo(1.2, 6);
    expect(stretchAt('sell', 1_000, SETTLED, 10)).toBeCloseTo(1.4, 6);
  });

  it('wobbles at birth, slower for bigger particles', () => {
    // ω = 18 rad/s at r = 4.5 and 9 rad/s at r = 18: at 0.25 s the small one is past its first
    // half-period (squashed), the big one still inside it (stretched).
    expect(stretchAt('buy', 0, 0.25, 4.5)).toBeLessThan(1);
    expect(stretchAt('buy', 0, 0.25, 18)).toBeGreaterThan(1);
  });
});

describe('stretchAlong', () => {
  it('stretches by k along the motion and 1/k across it, keeping the area', () => {
    const [ux, uy] = [0.6, -0.8];
    const m = stretchAlong(ux, uy, 1.25);
    expect(det(m)).toBeCloseTo(1, 9);
    const [ax, ay] = apply(m, ux, uy);
    expect(ax).toBeCloseTo(1.25 * ux, 9);
    expect(ay).toBeCloseTo(1.25 * uy, 9);
    const [nx, ny] = apply(m, -uy, ux);
    expect(nx).toBeCloseTo(-uy / 1.25, 9);
    expect(ny).toBeCloseTo(ux / 1.25, 9);
  });

  it('is the identity when there is nothing to stretch', () => {
    const m = stretchAlong(0.6, -0.8, 1);
    expect(m.a).toBeCloseTo(1, 9);
    expect(m.b).toBeCloseTo(0, 9);
    expect(m.c).toBeCloseTo(0, 9);
    expect(m.d).toBeCloseTo(1, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/particle.spec.ts`
Expected: FAIL — `Failed to resolve import "../particle"`.
- [ ] **Step 3: `MIN_R_PX` в `spawn.ts`**

После `SIDE_CENTER` добавить:

```ts
/**
 * Radius of the smallest particle ($1k and below), CSS px.
 * @package
 */
export const MIN_R_PX = 4.5;
```

В `bubbleStart` заменить `const r = 4.5 + 6 * d + (big ? 8 : 0);` на
`const r = MIN_R_PX + 6 * d + (big ? 8 : 0);`.
- [ ] **Step 4: Создать `src/ui/scene/particle.ts`**

```ts
import type { TradeSide } from '../../feed/market-feed';
import { MIN_R_PX } from './spawn';

/**
 * A 2×2 linear map in `setTransform` order: x' = a·x + c·y, y' = b·x + d·y.
 * @package
 */
export interface Mat2 {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Speed, px/s, that would add a whole unit of stretch; the side's cap applies long before. */
const STRETCH_SPEED = 400;
/** Most a particle stretches along its motion: drops are heavy, bubbles light. */
const MAX_STRETCH: Record<TradeSide, number> = { buy: 0.2, sell: 0.4 };
/** Birth wobble: amplitude (share of the radius), decay 1/s, rate of the smallest particle rad/s. */
const WOBBLE = 0.15;
const WOBBLE_DECAY = 3;
const WOBBLE_RATE = 18;

/**
 * How much a particle stretches along its motion: more with speed, up to its side's cap, plus a
 * birth wobble that dies out within about a second. Bigger particles wobble slower (∝ 1/√r).
 * @package
 */
export function stretchAt(side: TradeSide, speed: number, age: number, r: number): number {
  const rate = WOBBLE_RATE / Math.sqrt(r / MIN_R_PX);
  const wobble = WOBBLE * Math.exp(-WOBBLE_DECAY * age) * Math.sin(rate * age);
  return 1 + Math.min(MAX_STRETCH[side], speed / STRETCH_SPEED) + wobble;
}

/**
 * Stretches by `k` along the unit direction (ux, uy) and by 1/k across it without turning the
 * sprite, so a soap bubble's glint stays where the light is. Determinant 1: area is kept.
 * @package
 */
export function stretchAlong(ux: number, uy: number, k: number): Mat2 {
  const q = 1 / k;
  const shear = (k - q) * ux * uy;
  return { a: k * ux * ux + q * uy * uy, b: shear, c: shear, d: k * uy * uy + q * ux * ux };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/particle.spec.ts`
Expected: PASS (5 tests).
- [ ] **Step 6: Подключить в `fx.ts`**

Импорт:

```ts
import { type Mat2, stretchAlong, stretchAt } from './particle';
```

После констант (перед `FxHooks`) — модульная функция:

```ts
/** Puts the origin at (x, y) CSS px and applies `m`, on a `dpr` backing store. */
function setLocal(ctx: CanvasRenderingContext2D, m: Mat2, x: number, y: number, dpr: number): void {
  ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * x, dpr * y);
}
```

В `interface Bubble` первым полем добавить `side: TradeSide;`. В `spawn()` в объект
`this.bubbles.push({ ...b, … })` добавить `side: s.side,`. В `frame()` заменить
`this.drawBubbles(dt, h);` на `this.drawBubbles(dt, h, dpr);`. `drawBubbles` целиком:

```ts
  private drawBubbles(dt: number, h: number, dpr: number): void {
    const { ctx } = this;
    let alive = 0;
    for (const b of this.bubbles) {
      b.age += dt;
      if (b.age >= b.life || b.y < -b.r * 4 || b.y > h + b.r * 4) continue;
      b.vy += b.ay * dt;
      // Gentle sideways sway; bigger bubbles sway slower and wider, like real ones.
      const vx = b.vx + Math.sin(b.age * (2.6 - b.r * 0.05) + b.phase) * (8 + b.r);
      b.x += vx * dt;
      b.y += b.vy * dt;
      const fadeIn = Math.min(1, b.age / FADE_IN_SEC);
      const outStart = b.life * (1 - FADE_OUT_SHARE);
      const fadeOut = b.age < outStart ? 1 : 1 - (b.age - outStart) / (b.life - outStart);
      const a = fadeIn * fadeOut;
      if (b.halo) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(b.age * 5));
        const hr = b.r * 4;
        ctx.drawImage(b.halo, b.x - hr, b.y - hr, hr * 2, hr * 2);
      }
      // Stretched along the motion, sway included.
      const speed = Math.hypot(vx, b.vy);
      const ux = speed > 0 ? vx / speed : 0;
      const uy = speed > 0 ? b.vy / speed : 1;
      setLocal(ctx, stretchAlong(ux, uy, stretchAt(b.side, speed, b.age, b.r)), b.x, b.y, dpr);
      ctx.globalAlpha = a;
      ctx.drawImage(b.sprite, -b.r, -b.r, b.r * 2, b.r * 2);
      this.bubbles[alive++] = b;
    }
    this.bubbles.length = alive;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
```

- [ ] **Step 7: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: новый пузырь коротко вздрагивает; быстрые частицы вытянуты вдоль движения, капли
сильнее пузырей; блик пузыря всегда сверху слева. Скриншот, fps при шоке.
- [ ] **Step 8: Commit**

```bash
git add src/ui/scene/particle.ts src/ui/scene/__specs__/particle.spec.ts src/ui/scene/spawn.ts src/ui/scene/fx.ts
git commit -m "feat: particles stretch along their motion and wobble at birth"
```

---

### Task 2: В1 — переливающаяся плёнка

**Files:**
- Modify: `src/ui/palette.ts` (`shiftHue`), `src/ui/__specs__/palette.spec.ts`,
  `src/ui/scene/sprites.ts` (плёнка, блик; `bubbleSprite` удаляется), `src/ui/scene/fx.ts`

**Interfaces:**
- Consumes: `setLocal`, `stretchAlong`, `stretchAt` (Task 1).
- Produces:
  - `palette.ts`: `shiftHue(c: Rgb, deg: number): Rgb` (`@package`).
  - `sprites.ts` (`@package`): `filmSprite(c: Rgb)`, `thinFilmSprite()`, `glintSprite()`, все
    `HTMLCanvasElement`. `bubbleSprite` удалён.
  - `fx.ts`: `Bubble.spin: number` (рад/с со знаком), поле `Bubble.sprite` удалено; поля `Fx`
    `film`, `thinFilm`, `glint`, `drop`; метод `drawFilm(b: Bubble, a: number)`.

- [ ] **Step 1: Write the failing test** — в `src/ui/__specs__/palette.spec.ts` заменить импорт и
  добавить блок в конец файла:

```ts
import { auraTarget, type Rgb, shiftHue } from '../palette';
```

```ts
describe('shiftHue', () => {
  const C: Rgb = [0.2, 0.8, 0.7];
  const expectColor = (got: Rgb, want: Rgb) => {
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i] as number, 9));
  };

  it('comes back to the same colour after a full turn', () => {
    expectColor(shiftHue(C, 360), C);
    expectColor(shiftHue(shiftHue(shiftHue(C, 120), 120), 120), C);
  });

  it('turns the hue the right way: red + 120° is green, red − 120° is blue', () => {
    expectColor(shiftHue([1, 0, 0], 120), [0, 1, 0]);
    expectColor(shiftHue([1, 0, 0], -120), [0, 0, 1]);
  });

  it('moves only the hue: brightest and darkest channels stay', () => {
    const s = shiftHue(C, 20);
    expect(Math.max(...s)).toBeCloseTo(Math.max(...C), 9);
    expect(Math.min(...s)).toBeCloseTo(Math.min(...C), 9);
    // [0.2, 0.8, 0.7] + 20° → [0.2, 0.7, 0.8]: green and blue trade places.
    expect(s[1]).not.toBeCloseTo(C[1], 3);
  });

  it('leaves greys alone', () => {
    expectColor(shiftHue([0.5, 0.5, 0.5], 90), [0.5, 0.5, 0.5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/__specs__/palette.spec.ts`
Expected: FAIL — `shiftHue is not a function` (или ошибка импорта).
- [ ] **Step 3: `shiftHue` в `palette.ts`** — после `css()`:

```ts
/**
 * The same colour with its hue turned by `deg` degrees; lightness and saturation stay (HSL).
 * @package
 */
export function shiftHue(c: Rgb, deg: number): Rgb {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) return c;
  // Hue in sextants, 0…6.
  let h: number;
  if (max === r) h = (g - b) / chroma;
  else if (max === g) h = (b - r) / chroma + 2;
  else h = (r - g) / chroma + 4;
  h = (((h + deg / 60) % 6) + 6) % 6;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] =
    h < 1
      ? [chroma, x, 0]
      : h < 2
        ? [x, chroma, 0]
        : h < 3
          ? [0, chroma, x]
          : h < 4
            ? [0, x, chroma]
            : h < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return [r1 + min, g1 + min, b1 + min];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/__specs__/palette.spec.ts`
Expected: PASS.
- [ ] **Step 5: Спрайты плёнки в `sprites.ts`**

Импорт: `import { css, type Rgb, shiftHue } from '../palette';`. Удалить `bubbleSprite`. После
`radialSprite` добавить:

```ts
/** Soap film opacity across the radius: clear centre, bright rim. Reads as "rising, light". */
const FILM_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.16],
  [0.62, 0.22],
  [0.84, 0.95],
  [0.92, 0.4],
  [1, 0],
];
/** Film hues swing this far either side of the side colour, degrees. */
const FILM_HUE_DEG = 20;
/** The film just before a bubble ends: thin, dim gold. */
const THIN_FILM: Rgb = [0.85, 0.66, 0.32];
/** Thin film brightness relative to the full film. */
const THIN_FILM_ALPHA = 0.55;

const filmStops = (color: (alpha: number) => string) =>
  FILM_PROFILE.map(([at, alpha]) => [at, color(alpha)] as const);

/**
 * Bubble rim with a thin-film shimmer: hues ±FILM_HUE_DEG around `c` go round the circle, so a
 * spinning bubble shimmers. No glint here: that one must not spin (`glintSprite`).
 * @package
 */
export function filmSprite(c: Rgb): HTMLCanvasElement {
  const s = radialSprite(filmStops((alpha) => `rgba(255, 255, 255, ${alpha})`));
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  // Keep the white rim's opacity, take the colour from the hue wheel.
  g.globalCompositeOperation = 'source-in';
  if (typeof g.createConicGradient === 'function') {
    const wheel = g.createConicGradient(0, h, h);
    const warm = css(shiftHue(c, FILM_HUE_DEG));
    wheel.addColorStop(0, warm);
    wheel.addColorStop(0.25, css(c));
    wheel.addColorStop(0.5, css(shiftHue(c, -FILM_HUE_DEG)));
    wheel.addColorStop(0.75, css(c));
    wheel.addColorStop(1, warm);
    g.fillStyle = wheel;
  } else {
    // Engines without conic gradients (Safari < 16.1, Firefox < 112): a plain side-coloured rim.
    g.fillStyle = css(c);
  }
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/**
 * The film just before the bubble ends: the same rim, thin and dim gold.
 * @package
 */
export const thinFilmSprite = () =>
  radialSprite(filmStops((alpha) => css(THIN_FILM, alpha * THIN_FILM_ALPHA)));

/**
 * Specular glint, upper left: drawn over the film and never spun, so the light stays put.
 * @package
 */
export function glintSprite(): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = SPRITE_PX;
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const glint = g.createRadialGradient(h * 0.68, h * 0.62, 0, h * 0.68, h * 0.62, h * 0.24);
  glint.addColorStop(0, 'rgba(255,255,255,0.9)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}
```

- [ ] **Step 6: Плёнка в `fx.ts`**

Импорт спрайтов:
`import { dropSprite, filmSprite, glintSprite, haloSprite, thinFilmSprite } from './sprites';`

Константы (после `FADE_OUT_SHARE`):

```ts
/** Film spin, rad/s; each bubble turns one way or the other. */
const FILM_SPIN = 0.6;
/** Last share of a bubble's life over which its film thins to gold. */
const THIN_SHARE = 0.25;
```

`interface Bubble`: удалить `sprite: HTMLCanvasElement;`, добавить
`/** Film spin, rad/s, signed. */ spin: number;`.

Поля класса: удалить `private readonly sprites: Record<TradeSide, HTMLCanvasElement>;` и строку
`this.sprites = { … };` в конструкторе; добавить поля:

```ts
  private readonly film = filmSprite(UP_COLOR);
  private readonly thinFilm = thinFilmSprite();
  private readonly glint = glintSprite();
  private readonly drop = dropSprite(DOWN_COLOR);
```

В `spawn()` в `this.bubbles.push({ … })`: удалить `sprite: this.sprites[s.side],`, добавить
`spin: (Math.random() < 0.5 ? -1 : 1) * FILM_SPIN,`.

В `drawBubbles` заменить последние строки отрисовки (от `setLocal(…)` до `ctx.drawImage(b.sprite, …)`):

```ts
setLocal(ctx, stretchAlong(ux, uy, stretchAt(b.side, speed, b.age, b.r)), b.x, b.y, dpr);
if (b.side === 'buy') this.drawFilm(b, a);
else {
  ctx.globalAlpha = a;
  ctx.drawImage(this.drop, -b.r, -b.r, b.r * 2, b.r * 2);
}
```

Новый метод после `drawBubbles`:

```ts
  /** Spinning film that thins to gold late in life, under a glint that never spins. */
  private drawFilm(b: Bubble, a: number): void {
    const { ctx } = this;
    const thin = Math.min(1, Math.max(0, (b.age / b.life - (1 - THIN_SHARE)) / THIN_SHARE));
    const d = b.r * 2;
    const turn = b.phase + b.spin * b.age;
    ctx.rotate(turn);
    ctx.globalAlpha = a * (1 - thin);
    ctx.drawImage(this.film, -b.r, -b.r, d, d);
    ctx.rotate(-turn);
    if (thin > 0) {
      ctx.globalAlpha = a * thin;
      ctx.drawImage(this.thinFilm, -b.r, -b.r, d, d);
    }
    ctx.globalAlpha = a;
    ctx.drawImage(this.glint, -b.r, -b.r, d, d);
  }
```

- [ ] **Step 7: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: ободок пузыря медленно переливается оттенками бирюзового, блик неподвижен; к концу
жизни ободок тускнеет в золото. Покупки по-прежнему однозначно «зелёные». Скриншот, fps.
- [ ] **Step 8: Commit**

```bash
git add src/ui/palette.ts src/ui/__specs__/palette.spec.ts src/ui/scene/sprites.ts src/ui/scene/fx.ts
git commit -m "feat: bubbles shimmer with a thin film that thins to gold"
```

---

### Task 3: В2 — капля-слеза, остывание

**Files:**
- Modify: `src/ui/palette.ts` (экспорт `mix`), `src/ui/scene/particle.ts`,
  `src/ui/scene/__specs__/particle.spec.ts`, `src/ui/scene/sprites.ts` (`dropSprite` удаляется),
  `src/ui/scene/fx.ts`

**Interfaces:**
- Consumes: `Mat2`, `stretchAt`, `stretchAlong`, `setLocal` (Task 1), `drawFilm` (Task 2).
- Produces:
  - `palette.ts`: `mix(a: Rgb, b: Rgb, t: number): Rgb` (`@package`).
  - `particle.ts` (`@package`): `orientAlong(ux: number, uy: number, k: number): Mat2`,
    `frameAt(age: number, life: number, n: number): number`.
  - `sprites.ts` (`@package`): `ASH: Rgb`, `teardropFrames(c: Rgb, n: number): HTMLCanvasElement[]`.
    Спрайт 2:1, ось +x, голова справа, центр головы на ¾ ширины.
  - `fx.ts`: `COOL_FRAMES = 12`, поле `dropFrames`; поле `drop` удалено.

- [ ] **Step 1: Write the failing test** — в `particle.spec.ts` заменить импорт и дописать:

```ts
import { frameAt, type Mat2, orientAlong, stretchAlong, stretchAt } from '../particle';
```

```ts
describe('orientAlong', () => {
  it('turns the sprite axis onto the motion and stretches it, keeping the area', () => {
    const [ux, uy] = [0.6, 0.8];
    const m = orientAlong(ux, uy, 1.4);
    expect(det(m)).toBeCloseTo(1, 9);
    const [ax, ay] = apply(m, 1, 0);
    expect(ax).toBeCloseTo(1.4 * ux, 9);
    expect(ay).toBeCloseTo(1.4 * uy, 9);
    const [nx, ny] = apply(m, 0, 1);
    expect(nx).toBeCloseTo(-uy / 1.4, 9);
    expect(ny).toBeCloseTo(ux / 1.4, 9);
  });
});

describe('frameAt', () => {
  it('runs from the first frame at birth to the last at the end of life and after', () => {
    expect(frameAt(0, 6, 12)).toBe(0);
    expect(frameAt(6, 6, 12)).toBe(11);
    expect(frameAt(9, 6, 12)).toBe(11);
  });

  it('shows every frame, in order, on the way', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 6; t += 0.01) seen.add(frameAt(t, 6, 12));
    expect([...seen]).toEqual([...Array(12).keys()]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/particle.spec.ts`
Expected: FAIL — `orientAlong is not a function`.
- [ ] **Step 3: `orientAlong`, `frameAt` в `particle.ts`** — в конец файла:

```ts
/**
 * Turns a sprite drawn along +x onto the unit direction (ux, uy) and stretches it by `k` along
 * that axis, 1/k across. Determinant 1: area is kept.
 * @package
 */
export function orientAlong(ux: number, uy: number, k: number): Mat2 {
  const q = 1 / k;
  return { a: k * ux, b: k * uy, c: -q * uy, d: q * ux };
}

/**
 * Which of `n` frames shows at `age` of `life`: 0 at birth, n − 1 from the end of life on.
 * @package
 */
export function frameAt(age: number, life: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor((age / life) * n)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/particle.spec.ts`
Expected: PASS.
- [ ] **Step 5: Экспорт `mix` в `palette.ts`** — заменить объявление `const mix = …` на:

```ts
/**
 * Linear blend: t = 0 → a, t = 1 → b.
 * @package
 */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
```

- [ ] **Step 6: Слеза в `sprites.ts`**

Импорт: `import { css, mix, type Rgb, shiftHue } from '../palette';`. Удалить `dropSprite`.
Добавить после `glintSprite`:

```ts
/**
 * A cold drop: dark crimson, still faintly lit.
 * @package
 */
export const ASH: Rgb = [120 / 255, 20 / 255, 20 / 255];
const WHITE: Rgb = [1, 1, 1];
/** Share of a drop's life spent going from white-hot to the side colour; the rest cools to ASH. */
const HOT_SHARE = 0.4;

/** Teardrop along +x, head right; twice as wide as tall, head centre at ¾ of the width. */
function teardrop(core: Rgb, body: Rgb): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = SPRITE_PX * 2;
  s.height = SPRITE_PX;
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const hx = SPRITE_PX * 1.5;
  const headR = SPRITE_PX * 0.42;
  g.beginPath();
  g.moveTo(SPRITE_PX * 0.1, h);
  g.quadraticCurveTo(SPRITE_PX * 0.9, h - headR, hx, h - headR);
  g.arc(hx, h, headR, -Math.PI / 2, Math.PI / 2);
  g.quadraticCurveTo(SPRITE_PX * 0.9, h + headR, SPRITE_PX * 0.1, h);
  g.closePath();
  const fill = g.createRadialGradient(hx, h, 0, hx, h, SPRITE_PX * 1.4);
  fill.addColorStop(0, css(core, 0.95));
  fill.addColorStop(0.12, css(body, 0.95));
  fill.addColorStop(1, css(body, 0.3));
  g.fillStyle = fill;
  g.fill();
  // The tail fades toward its tip.
  g.globalCompositeOperation = 'destination-in';
  const tail = g.createLinearGradient(0, 0, hx - headR, 0);
  tail.addColorStop(0, 'rgba(0, 0, 0, 0)');
  tail.addColorStop(1, 'rgba(0, 0, 0, 1)');
  g.fillStyle = tail;
  g.fillRect(0, 0, s.width, s.height);
  // A soft glow around the head, behind the body.
  g.globalCompositeOperation = 'destination-over';
  const glow = g.createRadialGradient(hx, h, headR * 0.5, hx, h, h);
  glow.addColorStop(0, css(body, 0.35));
  glow.addColorStop(1, css(body, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, s.width, s.height);
  return s;
}

/**
 * `n` teardrop frames cooling from a white-hot core through `c` to ASH. Reads as "falling, heavy".
 * @package
 */
export function teardropFrames(c: Rgb, n: number): HTMLCanvasElement[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    if (t < HOT_SHARE) return teardrop(mix(WHITE, c, t / HOT_SHARE), c);
    const cooled = mix(c, ASH, (t - HOT_SHARE) / (1 - HOT_SHARE));
    return teardrop(cooled, cooled);
  });
}
```

- [ ] **Step 7: Слеза в `fx.ts`**

Импорты:
`import { frameAt, type Mat2, orientAlong, stretchAlong, stretchAt } from './particle';`
`import { filmSprite, glintSprite, haloSprite, teardropFrames, thinFilmSprite } from './sprites';`

Константа (после `THIN_SHARE`):

```ts
/** Cooling frames of a drop, chosen by the share of life lived. */
const COOL_FRAMES = 12;
```

Поле `private readonly drop = dropSprite(DOWN_COLOR);` заменить на
`private readonly dropFrames = teardropFrames(DOWN_COLOR, COOL_FRAMES);`.

В `drawBubbles` заменить блок от `setLocal(…)` до конца ветки `else { … }`:

```ts
const k = stretchAt(b.side, speed, b.age, b.r);
if (b.side === 'buy') {
  setLocal(ctx, stretchAlong(ux, uy, k), b.x, b.y, dpr);
  this.drawFilm(b, a);
} else {
  // Teardrop along its motion: the head at the particle, the tail trailing behind.
  setLocal(ctx, orientAlong(ux, uy, k), b.x, b.y, dpr);
  ctx.globalAlpha = a;
  const frame = this.dropFrames[frameAt(b.age, b.life, COOL_FRAMES)] as HTMLCanvasElement;
  ctx.drawImage(frame, -3 * b.r, -b.r, 4 * b.r, 2 * b.r);
}
```

- [ ] **Step 8: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: капли — слёзы хвостом вверх (против движения), при покачивании хвост следует за
направлением; свежая капля с белым ядром, к концу жизни тёмно-багровая. Скриншот, fps.
- [ ] **Step 9: Commit**

```bash
git add src/ui/palette.ts src/ui/scene/particle.ts src/ui/scene/__specs__/particle.spec.ts src/ui/scene/sprites.ts src/ui/scene/fx.ts
git commit -m "feat: sell drops are teardrops that cool as they fall"
```

---

### Task 4: С1 — лопание и разбивание

**Files:**
- Modify: `src/ui/scene/spawn.ts` (`R_PER_DECADE_PX`), `src/ui/scene/particle.ts`,
  `src/ui/scene/__specs__/particle.spec.ts`, `src/ui/scene/fx.ts`, `src/ui/scene/stage.ts`

**Interfaces:**
- Consumes: всё из Task 1–3.
- Produces:
  - `spawn.ts`: `R_PER_DECADE_PX = 6` (`@package`).
  - `particle.ts` (`@package`): `interface Spray { vx: number; vy: number }`,
    `radiusDecades(r: number): number`, `popSpray(r: number, rand: () => number): Spray[]`,
    `splashCrown(r: number, rand: () => number): Spray[]`.
  - `fx.ts`: `Ring { x, y, r0, maxR, sy, age, delay, dur, width, alpha, color }`,
    `Shard { x, y, vx, vy, age, dur, width, g, color }`, `Bubble.endAt: number | null`,
    `Fx.setFloor(y: number | null): void`, методы `pop(b)`, `splash(b, floor)`.
  - `stage.ts`: меряет `#chart` и зовёт `fx.setFloor`.

- [ ] **Step 1: Write the failing test** — в `particle.spec.ts` заменить импорты и дописать:

```ts
import {
  frameAt,
  type Mat2,
  orientAlong,
  popSpray,
  radiusDecades,
  splashCrown,
  stretchAlong,
  stretchAt,
} from '../particle';
import { MIN_R_PX, R_PER_DECADE_PX } from '../spawn';
```

```ts
const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};
const LARGEST_R = MIN_R_PX + 3 * R_PER_DECADE_PX;

describe('radiusDecades', () => {
  it('reads the 0…3 size scale back from a radius', () => {
    expect(radiusDecades(MIN_R_PX)).toBe(0);
    expect(radiusDecades(MIN_R_PX + R_PER_DECADE_PX)).toBeCloseTo(1, 9);
    expect(radiusDecades(2)).toBe(0);
    expect(radiusDecades(100)).toBe(3);
  });
});

describe('popSpray', () => {
  it('pops small bubbles with a ring only', () => {
    expect(popSpray(7.9, seeded(1))).toEqual([]);
  });

  it('throws 3 to 6 droplets by size at 60–120 px/s', () => {
    expect(popSpray(8, seeded(2))).toHaveLength(3);
    expect(popSpray(LARGEST_R, seeded(3))).toHaveLength(6);
    for (const s of popSpray(20, seeded(4))) {
      const v = Math.hypot(s.vx, s.vy);
      expect(v).toBeGreaterThanOrEqual(60);
      expect(v).toBeLessThan(120);
    }
  });
});

describe('splashCrown', () => {
  it('throws 5 droplets for the smallest drop and 9 for the largest', () => {
    expect(splashCrown(MIN_R_PX, seeded(5))).toHaveLength(5);
    expect(splashCrown(LARGEST_R, seeded(6))).toHaveLength(9);
  });

  it('fans every droplet upward, within 60° of vertical', () => {
    const rand = seeded(7);
    for (let i = 0; i < 50; i++) {
      for (const s of splashCrown(15, rand)) {
        expect(s.vy).toBeLessThan(0);
        expect(Math.abs(Math.atan2(s.vx, -s.vy))).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/particle.spec.ts`
Expected: FAIL — нет экспорта `R_PER_DECADE_PX` / `popSpray`.
- [ ] **Step 3: `R_PER_DECADE_PX` в `spawn.ts`** — после `MIN_R_PX`:

```ts
/**
 * Radius added per decade of notional above $1k, CSS px.
 * @package
 */
export const R_PER_DECADE_PX = 6;
```

В `bubbleStart`: `const r = MIN_R_PX + R_PER_DECADE_PX * d + (big ? 8 : 0);`.
- [ ] **Step 4: Брызги в `particle.ts`**

Импорт: `import { MIN_R_PX, R_PER_DECADE_PX } from './spawn';`. В конец файла:

```ts
/**
 * A spray droplet's launch velocity, px/s.
 * @package
 */
export interface Spray {
  vx: number;
  vy: number;
}

/** Bubbles smaller than this, px, pop with a ring only. */
const DROPLET_MIN_R_PX = 8;
/** A splash crown fans within this angle either side of straight up. */
const CROWN_HALF_ANGLE = Math.PI / 3;

/**
 * Size on the 0…3 decade scale read from the radius, not the notional, so merged and weakened
 * particles burst as big as they look now. Big-trade particles read larger and clamp at 3.
 * @package
 */
export function radiusDecades(r: number): number {
  return Math.min(3, Math.max(0, (r - MIN_R_PX) / R_PER_DECADE_PX));
}

/**
 * Droplets of a popping bubble: none below DROPLET_MIN_R_PX, else 3 + ⌊decades⌋ spread round the
 * circle at 60–120 px/s.
 * @package
 */
export function popSpray(r: number, rand: () => number): Spray[] {
  if (r < DROPLET_MIN_R_PX) return [];
  const n = 3 + Math.floor(radiusDecades(r));
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + rand() * 0.5) / n) * Math.PI * 2;
    const v = 60 + 60 * rand();
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v };
  });
}

/**
 * Crown of a drop hitting the floor: 5…9 droplets by size, fanned within CROWN_HALF_ANGLE of
 * straight up, faster for bigger drops.
 * @package
 */
export function splashCrown(r: number, rand: () => number): Spray[] {
  const d = radiusDecades(r);
  const n = 5 + Math.round((4 * d) / 3);
  return Array.from({ length: n }, () => {
    const a = (rand() * 2 - 1) * CROWN_HALF_ANGLE;
    const v = (80 + 80 * rand()) * (1 + 0.3 * d);
    return { vx: Math.sin(a) * v, vy: -Math.cos(a) * v };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/particle.spec.ts src/ui/scene/__specs__/spawn.spec.ts`
Expected: PASS.
- [ ] **Step 6: Кольца и осколки с позицией и длительностью в `fx.ts`**

Импорт: добавить `popSpray, splashCrown` в импорт из `./particle`.

Константы (после `SHARD_SEC`):

```ts
/** Liquidation rings start this far out from the price, px. */
const LIQ_RING_R0_PX = 8;
/** Liquidation shard line width at birth, px. */
const SHARD_WIDTH_PX = 2.2;
/** Bubble pop: ring from r out to POP_RING_SCALE·r over POP_SEC; droplets live DROPLET_SEC. */
const POP_SEC = 0.35;
const POP_RING_SCALE = 2.2;
const DROPLET_SEC = 0.4;
/** Pops per frame; past it bubbles just fade over OVERFLOW_FADE_SEC, so a cascade stays cheap. */
const MAX_POPS_PER_FRAME = 40;
const OVERFLOW_FADE_SEC = 0.3;
/** Drop splash on the floor: crown life, crown gravity px/s², flat ring life and squash. */
const SPLASH_SEC = 0.6;
const SPLASH_GRAVITY = 400;
const SPLASH_RING_SEC = 0.5;
const FLOOR_RING_SQUASH = 0.3;
```

Документацию `FADE_OUT_SHARE` заменить на `/** Last share of a drop's life spent fading out
(cooling in the air). */`.

`interface Ring` и `interface Shard` целиком:

```ts
interface Ring {
  x: number;
  y: number;
  /** Radius at the start, px; grows by maxR. */
  r0: number;
  maxR: number;
  /** Vertical scale: 1 a circle, below 1 an ellipse lying on the floor. */
  sy: number;
  age: number;
  delay: number;
  /** Lifetime after the delay, s. */
  dur: number;
  width: number;
  alpha: number;
  color: Rgb;
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Lifetime, s. */
  dur: number;
  /** Line width at birth, px. */
  width: number;
  /** Gravity, px/s². */
  g: number;
  color: Rgb;
}
```

`interface Bubble`: добавить
`/** Age a pop was skipped (over budget) and the fade began; null while alive. */ endAt: number | null;`.
В `spawn()` в `this.bubbles.push({ … })` добавить `endAt: null,`.

Поле и сеттер (после `setOrigin`):

```ts
  private floor: number | null = null;

  /** Top of the chart strip, CSS px: drops splash there. Null: the screen bottom. */
  setFloor(y: number | null): void {
    this.floor = y;
  }
```

`liquidation()` — заменить строки от `this.rings.push({ age: 0, delay: 0, maxR, …` до конца
цикла по осколкам:

```ts
    const { x, y } = this.origin;
    const ring = { x, y, r0: LIQ_RING_R0_PX, sy: 1, age: 0, delay: 0, dur: RING_SEC, color };
    this.rings.push({ ...ring, maxR, width: major ? 7 : 2, alpha });
    if (!major) return;
    this.rings.push({ ...ring, delay: 0.14, maxR: maxR * 0.7, width: 3, alpha: alpha * 0.7 });
    const n = Math.round(18 + 12 * Math.min(2, above));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const v = (180 + 220 * Math.random()) * (1 + 0.3 * d);
      const vx = Math.cos(a) * v;
      const vy = Math.sin(a) * v;
      this.shards.push({ x, y, vx, vy, age: 0, dur: SHARD_SEC, width: SHARD_WIDTH_PX, g: 0, color });
    }
```

(Ниже в `liquidation()` уже используются `x`, `y` — прежнее `const { x, y } = this.origin;`
удалить, оно теперь выше.)

`drawRings` целиком:

```ts
  private drawRings(dt: number): void {
    const { ctx } = this;
    let alive = 0;
    for (const r of this.rings) {
      r.age += dt;
      const t = (r.age - r.delay) / r.dur;
      if (t >= 1) continue;
      this.rings[alive++] = r;
      if (t < 0) continue;
      const eased = 1 - (1 - t) ** 4;
      const radius = r.r0 + r.maxR * eased;
      ctx.globalAlpha = r.alpha * (1 - t) ** 1.6;
      ctx.strokeStyle = css(r.color, 1);
      ctx.lineWidth = Math.max(1, r.width * (1 - t));
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, radius, radius * r.sy, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings.length = alive;
  }
```

В `drawShards` заменить тело цикла:

```ts
      s.age += dt;
      if (s.age >= s.dur) continue;
      s.vx *= drag;
      s.vy *= drag;
      s.vy += s.g * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = 1 - s.age / s.dur;
      ctx.globalAlpha = k;
      ctx.strokeStyle = css(s.color, 1);
      ctx.lineWidth = s.width * k + 0.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      // Streak along the velocity: motion blur for free.
      ctx.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      ctx.stroke();
      this.shards[alive++] = s;
```

- [ ] **Step 7: Конец жизни частицы в `fx.ts`**

`drawBubbles` целиком:

```ts
  private drawBubbles(dt: number, h: number, dpr: number): void {
    const { ctx } = this;
    const floor = this.floor ?? h;
    let pops = 0;
    let alive = 0;
    for (const b of this.bubbles) {
      b.age += dt;
      if (b.y < -b.r * 4 || b.y > h + b.r * 4) continue;
      let fadeOut: number;
      if (b.side === 'sell') {
        if (b.y + b.r >= floor) {
          this.splash(b, floor);
          continue;
        }
        if (b.age >= b.life) continue;
        const outStart = b.life * (1 - FADE_OUT_SHARE);
        fadeOut = b.age < outStart ? 1 : 1 - (b.age - outStart) / (b.life - outStart);
      } else {
        // Bubbles stay whole to the end and pop, unless the frame's pop budget is spent.
        if (b.age >= b.life && b.endAt === null) {
          if (pops < MAX_POPS_PER_FRAME) {
            pops++;
            this.pop(b);
            continue;
          }
          b.endAt = b.age;
        }
        fadeOut = b.endAt === null ? 1 : 1 - (b.age - b.endAt) / OVERFLOW_FADE_SEC;
        if (fadeOut <= 0) continue;
      }
      b.vy += b.ay * dt;
      // Gentle sideways sway; bigger bubbles sway slower and wider, like real ones.
      const vx = b.vx + Math.sin(b.age * (2.6 - b.r * 0.05) + b.phase) * (8 + b.r);
      b.x += vx * dt;
      b.y += b.vy * dt;
      const a = Math.min(1, b.age / FADE_IN_SEC) * fadeOut;
      if (b.halo) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(b.age * 5));
        const hr = b.r * 4;
        ctx.drawImage(b.halo, b.x - hr, b.y - hr, hr * 2, hr * 2);
      }
      // Stretched along the motion, sway included.
      const speed = Math.hypot(vx, b.vy);
      const ux = speed > 0 ? vx / speed : 0;
      const uy = speed > 0 ? b.vy / speed : 1;
      const k = stretchAt(b.side, speed, b.age, b.r);
      if (b.side === 'buy') {
        setLocal(ctx, stretchAlong(ux, uy, k), b.x, b.y, dpr);
        this.drawFilm(b, a);
      } else {
        // Teardrop along its motion: the head at the particle, the tail trailing behind.
        setLocal(ctx, orientAlong(ux, uy, k), b.x, b.y, dpr);
        ctx.globalAlpha = a;
        const frame = this.dropFrames[frameAt(b.age, b.life, COOL_FRAMES)] as HTMLCanvasElement;
        ctx.drawImage(frame, -3 * b.r, -b.r, 4 * b.r, 2 * b.r);
      }
      this.bubbles[alive++] = b;
    }
    this.bubbles.length = alive;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** A bubble's end: a quick ring and, for bigger ones, a few droplets. */
  private pop(b: Bubble): void {
    const color = sideColor(b.side);
    this.rings.push({
      x: b.x,
      y: b.y,
      r0: b.r,
      maxR: b.r * (POP_RING_SCALE - 1),
      sy: 1,
      age: 0,
      delay: 0,
      dur: POP_SEC,
      width: 1.5,
      alpha: 0.6,
      color,
    });
    for (const v of popSpray(b.r, Math.random)) {
      this.shards.push({ x: b.x, y: b.y, ...v, age: 0, dur: DROPLET_SEC, width: 1.5, g: 0, color });
    }
  }

  /** A drop hitting the floor: a crown of droplets thrown up and a flat ring on the floor. */
  private splash(b: Bubble, floor: number): void {
    const color = sideColor(b.side);
    this.rings.push({
      x: b.x,
      y: floor,
      r0: b.r,
      maxR: b.r,
      sy: FLOOR_RING_SQUASH,
      age: 0,
      delay: 0,
      dur: SPLASH_RING_SEC,
      width: 1.5,
      alpha: 0.5,
      color,
    });
    for (const v of splashCrown(b.r, Math.random)) {
      this.shards.push({
        x: b.x,
        y: floor,
        ...v,
        age: 0,
        dur: SPLASH_SEC,
        width: 1.8,
        g: SPLASH_GRAVITY,
        color,
      });
    }
  }
```

- [ ] **Step 8: Пол в `stage.ts`**

Заменить `const chart = new Chart(el('chart'));` на:

```ts
const chartCanvas = el<HTMLCanvasElement>('chart');
const chart = new Chart(chartCanvas);
```

После `window.addEventListener('resize', placeOrigin);`:

```ts
const placeFloor = () => {
  const r = chartCanvas.getBoundingClientRect();
  // A chart with no box yet has no floor: drops fall off the screen bottom.
  fx.setFloor(r.height > 0 ? r.top : null);
};
new ResizeObserver(placeFloor).observe(chartCanvas);
window.addEventListener('resize', placeFloor);
```

- [ ] **Step 9: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: пузырь виден до конца и лопается колечком (крупные — с брызгами); капля, долетевшая до
верха графика, разбивается короной брызг вверх и плоским кольцом; недолетевшая остывает и гаснет
в воздухе. Кольца ликвидаций как прежде. При шоке fps не проседает (лимит 40 лопаний за кадр).
Скриншот.
- [ ] **Step 10: Commit**

```bash
git add src/ui/scene/spawn.ts src/ui/scene/particle.ts src/ui/scene/__specs__/particle.spec.ts src/ui/scene/fx.ts src/ui/scene/stage.ts
git commit -m "feat: bubbles pop and drops splash on the chart"
```

---

### Task 5: Сетка-хеш

Без визуала: общая основа С6 и С2 отдельным коммитом, чтобы их можно было откатывать независимо.

**Files:**
- Create: `src/ui/scene/grid.ts`, `src/ui/scene/__specs__/grid.spec.ts`

**Interfaces:**
- Produces (`@package`, `./grid`): `interface Circle { x: number; y: number; r: number }`,
  `nearPairs(cs: readonly Circle[], reach: number): number[]` — плоский `[i0, j0, i1, j1, …]`,
  `i < j`, каждая пара один раз, условие `|ci − cj| < reach · (ri + rj)`.

- [ ] **Step 1: Write the failing test** — `src/ui/scene/__specs__/grid.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { type Circle, nearPairs } from '../grid';

const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

const brute = (cs: readonly Circle[], reach: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i] as Circle;
      const b = cs[j] as Circle;
      if (Math.hypot(a.x - b.x, a.y - b.y) < reach * (a.r + b.r)) out.push(`${i}-${j}`);
    }
  }
  return out.sort();
};

const keys = (flat: readonly number[]): string[] => {
  const out: string[] = [];
  for (let k = 0; k < flat.length; k += 2) out.push(`${flat[k]}-${flat[k + 1]}`);
  return out.sort();
};

describe('nearPairs', () => {
  it('finds exactly the pairs a brute-force scan finds, each once with i < j', () => {
    const rand = seeded(7);
    const cs = Array.from({ length: 400 }, () => ({
      x: rand() * 1200,
      y: rand() * 1000 - 100,
      r: 3 + rand() * 27,
    }));
    for (const reach of [0.6, 0.8]) {
      const flat = nearPairs(cs, reach);
      const want = brute(cs, reach);
      expect(want.length).toBeGreaterThan(10);
      expect(keys(flat)).toEqual(want);
      for (let k = 0; k < flat.length; k += 2) {
        expect(flat[k]).toBeLessThan(flat[k + 1] as number);
      }
    }
  });

  it('sees across cell borders at negative coordinates (above the screen top)', () => {
    expect(
      nearPairs(
        [
          { x: -1, y: -50, r: 5 },
          { x: 4, y: -48, r: 5 },
        ],
        0.8,
      ),
    ).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/grid.spec.ts`
Expected: FAIL — `Failed to resolve import "../grid"`.
- [ ] **Step 3: Создать `src/ui/scene/grid.ts`**

```ts
/**
 * A circle, CSS px.
 * @package
 */
export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Shifts cell coordinates to non-negative before packing two into one exact integer key. */
const CELL_BIAS = 1 << 20;

const cellKey = (cx: number, cy: number) => (cx + CELL_BIAS) * 2 * CELL_BIAS + (cy + CELL_BIAS);

/**
 * Pairs of circles whose centres are closer than `reach · (ri + rj)`, through a uniform grid:
 * O(n) for circles spread over the screen. Flat `[i0, j0, i1, j1, …]`, i < j, each pair once.
 * @package
 */
export function nearPairs(cs: readonly Circle[], reach: number): number[] {
  const out: number[] = [];
  const n = cs.length;
  if (n < 2) return out;
  let maxR = 0;
  for (const c of cs) maxR = Math.max(maxR, c.r);
  // Any pair in reach is at most one cell apart on each axis.
  const cell = Math.max(1, 2 * maxR * reach);
  const cx = new Int32Array(n);
  const cy = new Int32Array(n);
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c = cs[i] as Circle;
    cx[i] = Math.floor(c.x / cell);
    cy[i] = Math.floor(c.y / cell);
    const key = cellKey(cx[i] as number, cy[i] as number);
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    const a = cs[i] as Circle;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get(cellKey((cx[i] as number) + dx, (cy[i] as number) + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = cs[j] as Circle;
          const limit = reach * (a.r + b.r);
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          if (ddx * ddx + ddy * ddy < limit * limit) out.push(i, j);
        }
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/grid.spec.ts`
Expected: PASS.
- [ ] **Step 5: Проверить и закоммитить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.

```bash
git add src/ui/scene/grid.ts src/ui/scene/__specs__/grid.spec.ts
git commit -m "feat: spatial grid for particle contacts"
```

---

### Task 6: С6 — аннигиляция

**Files:**
- Create: `src/ui/scene/annihilate.ts`, `src/ui/scene/__specs__/annihilate.spec.ts`
- Modify: `src/ui/scene/sprites.ts` (`flashSprite`), `src/ui/scene/fx.ts`

**Interfaces:**
- Consumes: `nearPairs`, `Circle` (Task 5).
- Produces:
  - `annihilate.ts` (`@package`): `interface Matter extends Circle { side: TradeSide; age: number }`,
    `interface Flash { x: number; y: number; r: number }` (`r` = сумма радиусов),
    `annihilate(ps: readonly Matter[], minAge: number): { gone: Set<number>; flashes: Flash[] }`
    — меняет `r` выжившей.
  - `sprites.ts` (`@package`): `flashSprite(): HTMLCanvasElement`.
  - `fx.ts`: метод `collide()`, поле `flashes`, метод `drawFlashes(dt)`.

- [ ] **Step 1: Write the failing test** — `src/ui/scene/__specs__/annihilate.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { annihilate, type Matter } from '../annihilate';

/** Same as fx.ts FADE_IN_SEC: particles still fading in pass through. */
const MIN_AGE = 0.35;
const p = (side: 'buy' | 'sell', x: number, r: number, age = 1): Matter => ({
  x,
  y: 0,
  r,
  side,
  age,
});

describe('annihilate', () => {
  it('lets a small sell vanish into a whale buy, which keeps the rest of its area', () => {
    const whale = p('buy', 0, 20);
    const { gone, flashes } = annihilate([whale, p('sell', 10, 5)], MIN_AGE);
    expect([...gone]).toEqual([1]);
    expect(whale.r ** 2).toBeCloseTo(20 ** 2 - 5 ** 2, 9);
    expect(flashes).toEqual([{ x: 5, y: 0, r: 25 }]);
  });

  it('cancels near-equal particles completely', () => {
    const { gone } = annihilate([p('buy', 0, 10), p('sell', 5, 10)], MIN_AGE);
    expect([...gone].sort()).toEqual([0, 1]);
  });

  it('ignores same-side contacts and particles still fading in', () => {
    expect(annihilate([p('buy', 0, 10), p('buy', 5, 10)], MIN_AGE).gone.size).toBe(0);
    expect(annihilate([p('buy', 0, 10), p('sell', 5, 10, 0.1)], MIN_AGE).gone.size).toBe(0);
  });

  it('needs real overlap, not a graze', () => {
    // 0.85 · (r1 + r2) apart: the discs overlap, but less than the 0.8 reach.
    expect(annihilate([p('buy', 0, 10), p('sell', 17, 10)], MIN_AGE).gone.size).toBe(0);
  });

  it('takes each particle into one contact per call', () => {
    const whale = p('buy', 0, 20);
    const { gone } = annihilate([whale, p('sell', -8, 5), p('sell', 8, 5)], MIN_AGE);
    expect(gone.size).toBe(1);
    expect(whale.r ** 2).toBeCloseTo(20 ** 2 - 5 ** 2, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/annihilate.spec.ts`
Expected: FAIL — `Failed to resolve import "../annihilate"`.
- [ ] **Step 3: Создать `src/ui/scene/annihilate.ts`**

```ts
import type { TradeSide } from '../../feed/market-feed';
import { type Circle, nearPairs } from './grid';

/** A buy and a sell meet when their centres are this close, in units of r1 + r2. */
const REACH = 0.8;
/** A particle weakened below this radius, px, is gone too. */
const MIN_LEFT_R_PX = 3;

/** @package */
export interface Matter extends Circle {
  side: TradeSide;
  age: number;
}

/**
 * Where a buy and a sell cancelled; `r` is the sum of their radii.
 * @package
 */
export interface Flash {
  x: number;
  y: number;
  r: number;
}

/**
 * Buys and sells cancel where they meet: the smaller vanishes and the larger loses its area,
 * r' = √(R² − r²); both go when what is left is too small to see. Particles younger than `minAge`
 * (still fading in) pass through, and each takes part in at most one contact per call. Mutates
 * the survivor's radius; returns the indices to remove and a flash per contact.
 * @package
 */
export function annihilate(
  ps: readonly Matter[],
  minAge: number,
): { gone: Set<number>; flashes: Flash[] } {
  const gone = new Set<number>();
  const used = new Set<number>();
  const flashes: Flash[] = [];
  const pairs = nearPairs(ps, REACH);
  for (let k = 0; k < pairs.length; k += 2) {
    const i = pairs[k] as number;
    const j = pairs[k + 1] as number;
    const a = ps[i] as Matter;
    const b = ps[j] as Matter;
    if (a.side === b.side || used.has(i) || used.has(j)) continue;
    if (a.age < minAge || b.age < minAge) continue;
    used.add(i);
    used.add(j);
    flashes.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: a.r + b.r });
    const [big, bigAt, small, smallAt] = a.r >= b.r ? [a, i, b, j] : [b, j, a, i];
    gone.add(smallAt);
    const left = Math.sqrt(big.r ** 2 - small.r ** 2);
    if (left < MIN_LEFT_R_PX) gone.add(bigAt);
    else big.r = left;
  }
  return { gone, flashes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/annihilate.spec.ts`
Expected: PASS.
- [ ] **Step 5: Вспышка в `sprites.ts`** — в конец файла:

```ts
/**
 * White flash where a buy and a sell cancel.
 * @package
 */
export const flashSprite = () =>
  radialSprite([
    [0, 'rgba(255, 255, 255, 0.9)'],
    [0.35, 'rgba(255, 255, 255, 0.35)'],
    [1, 'rgba(255, 255, 255, 0)'],
  ]);
```

- [ ] **Step 6: Столкновения в `fx.ts`**

Импорты: `import { annihilate, type Flash } from './annihilate';`, добавить `flashSprite` в импорт
из `./sprites`.

Константы:

```ts
/** Cancel flash: life, peak opacity, radius per unit of the two radii summed. */
const FLASH_SEC = 0.25;
const FLASH_ALPHA = 0.8;
const FLASH_SCALE = 2;
```

Поля:

```ts
  private flashes: (Flash & { age: number })[] = [];
  private readonly flash = flashSprite();
```

`clear()`: добавить `this.flashes = [];`.

`frame()`: после `this.spawn(bigTradeUsd);` добавить `this.collide();`; после
`this.drawShards(dt);` добавить `this.drawFlashes(dt);`.

Методы (после `spawn`):

```ts
  /** Contacts between particles, on last frame's positions, before anything moves. */
  private collide(): void {
    const { gone, flashes } = annihilate(this.bubbles, FADE_IN_SEC);
    for (const f of flashes) this.flashes.push({ ...f, age: 0 });
    if (gone.size > 0) this.bubbles = this.bubbles.filter((_, i) => !gone.has(i));
  }
```

```ts
  private drawFlashes(dt: number): void {
    const { ctx } = this;
    let alive = 0;
    for (const f of this.flashes) {
      f.age += dt;
      if (f.age >= FLASH_SEC) continue;
      ctx.globalAlpha = FLASH_ALPHA * (1 - f.age / FLASH_SEC);
      const r = FLASH_SCALE * f.r;
      ctx.drawImage(this.flash, f.x - r, f.y - r, r * 2, r * 2);
      this.flashes[alive++] = f;
    }
    this.flashes.length = alive;
  }
```

- [ ] **Step 7: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: в середине экрана, где встречаются потоки, пузыри и капли гасят друг друга белыми
вспышками; кит, встретив мелочь, заметно уменьшается, но летит дальше. При одностороннем шоке
доминирующая сторона прорывается. Экран не выбеливается. Скриншот, fps.
- [ ] **Step 8: Commit**

```bash
git add src/ui/scene/annihilate.ts src/ui/scene/__specs__/annihilate.spec.ts src/ui/scene/sprites.ts src/ui/scene/fx.ts
git commit -m "feat: buys and sells cancel where they meet"
```

---

### Task 7: С2 — слияние

**Files:**
- Create: `src/ui/scene/merge.ts`, `src/ui/scene/__specs__/merge.spec.ts`
- Modify: `src/ui/scene/fx.ts` (`collide`)

**Interfaces:**
- Consumes: `nearPairs`, `Circle` (Task 5); `collide()` (Task 6).
- Produces (`@package`, `./merge`):
  `interface Blob extends Circle { vx: number; vy: number; side: TradeSide; age: number; life: number; halo: object | null }`,
  `merge(ps: readonly Blob[], maxR: number): Set<number>` — меняет выжившую, возвращает индексы
  поглощённых.

- [ ] **Step 1: Write the failing test** — `src/ui/scene/__specs__/merge.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { type Blob, merge } from '../merge';

const MAX_R = 48;
const blob = (x: number, r: number, o: Partial<Blob> = {}): Blob => ({
  x,
  y: 0,
  r,
  vx: 0,
  vy: 0,
  side: 'buy',
  age: 1,
  life: 5,
  halo: null,
  ...o,
});

describe('merge', () => {
  it('keeps the total area, the area-weighted centre and the momentum', () => {
    const a = blob(0, 6, { vx: 10, vy: -40 });
    const b = blob(4, 8, { vx: -5, vy: -20 });
    expect([...merge([a, b], MAX_R)]).toEqual([0]);
    expect(b.r).toBeCloseTo(10, 9);
    expect(b.x).toBeCloseTo((0 * 36 + 4 * 64) / 100, 9);
    expect(b.vx).toBeCloseTo((10 * 36 - 5 * 64) / 100, 9);
    expect(b.vy).toBeCloseTo((-40 * 36 - 20 * 64) / 100, 9);
  });

  it('keeps the larger with the longer remaining life and either halo', () => {
    const halo = {};
    const small = blob(0, 5, { age: 1, life: 10, halo });
    const big = blob(3, 9, { age: 4, life: 6 });
    merge([small, big], MAX_R);
    expect(big.life - big.age).toBeCloseTo(9, 9);
    expect(big.halo).toBe(halo);
  });

  it('never grows a particle past maxR', () => {
    const a = blob(0, 30);
    const b = blob(10, 30);
    expect(merge([a, b], 40).size).toBe(0);
    expect(a.r).toBe(30);
    expect(b.r).toBe(30);
  });

  it('keeps buys and sells apart', () => {
    expect(merge([blob(0, 10), blob(5, 10, { side: 'sell' })], MAX_R).size).toBe(0);
  });

  it('merges each particle once per call', () => {
    expect(merge([blob(0, 5), blob(2, 5), blob(4, 5)], MAX_R).size).toBe(1);
  });

  it('needs deeper overlap than a cancel', () => {
    // 0.7 · (r1 + r2) apart: enough for a buy and a sell to cancel, not to merge.
    expect(merge([blob(0, 10), blob(14, 10)], MAX_R).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/merge.spec.ts`
Expected: FAIL — `Failed to resolve import "../merge"`.
- [ ] **Step 3: Создать `src/ui/scene/merge.ts`**

```ts
import type { TradeSide } from '../../feed/market-feed';
import { type Circle, nearPairs } from './grid';

/** Same-side particles merge when their centres are this close, in units of r1 + r2. */
const REACH = 0.6;

/** @package */
export interface Blob extends Circle {
  vx: number;
  vy: number;
  side: TradeSide;
  age: number;
  life: number;
  halo: object | null;
}

/**
 * Same-side particles that touch flow into one: the larger survives with the summed area
 * (r = √(r1² + r2²)), the area-weighted centre and velocity (momentum kept), the longer of the two
 * remaining lives and either one's halo. No merge past `maxR`; each particle merges at most once
 * per call. Mutates the survivor; returns the indices absorbed.
 * @package
 */
export function merge(ps: readonly Blob[], maxR: number): Set<number> {
  const gone = new Set<number>();
  const used = new Set<number>();
  const pairs = nearPairs(ps, REACH);
  for (let k = 0; k < pairs.length; k += 2) {
    const i = pairs[k] as number;
    const j = pairs[k + 1] as number;
    const a = ps[i] as Blob;
    const b = ps[j] as Blob;
    if (a.side !== b.side || used.has(i) || used.has(j)) continue;
    const wa = a.r * a.r;
    const wb = b.r * b.r;
    const w = wa + wb;
    const r = Math.sqrt(w);
    if (r > maxR) continue;
    used.add(i);
    used.add(j);
    const [keep, lose, loseAt] = a.r >= b.r ? [a, b, j] : [b, a, i];
    const x = (a.x * wa + b.x * wb) / w;
    const y = (a.y * wa + b.y * wb) / w;
    const vx = (a.vx * wa + b.vx * wb) / w;
    const vy = (a.vy * wa + b.vy * wb) / w;
    const left = Math.max(a.life - a.age, b.life - b.age);
    keep.x = x;
    keep.y = y;
    keep.vx = vx;
    keep.vy = vy;
    keep.r = r;
    keep.life = keep.age + left;
    keep.halo ??= lose.halo;
    gone.add(loseAt);
  }
  return gone;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/merge.spec.ts`
Expected: PASS.
- [ ] **Step 5: Слияние в `fx.ts`**

Импорт: `import { merge } from './merge';`. Константа:

```ts
/** Merging stops at this radius, px, so a stream of trades cannot fill the screen. */
const MAX_MERGE_R_PX = 48;
```

В `collide()` после фильтра аннигиляции добавить:

```ts
const merged = merge(this.bubbles, MAX_MERGE_R_PX);
if (merged.size > 0) this.bubbles = this.bubbles.filter((_, i) => !merged.has(i));
```

- [ ] **Step 6: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: серия мелких покупок собирается в растущий пузырь, капли сливаются в крупные слёзы;
пузырей крупнее ~48 px нет. Скриншот, fps.
- [ ] **Step 7: Commit**

```bash
git add src/ui/scene/merge.ts src/ui/scene/__specs__/merge.spec.ts src/ui/scene/fx.ts
git commit -m "feat: same-side particles merge on contact"
```

---

### Task 8: С7 — пена и осадок (окончание из С1 удаляется из `fx.ts`)

Альтернатива Task 4 по концу жизни. Сравнение — коммит Task 7 против этого.

**Files:**
- Create: `src/ui/scene/layers.ts`, `src/ui/scene/__specs__/layers.spec.ts`
- Modify: `src/ui/scene/fx.ts`

**Interfaces:**
- Consumes: `setFloor` (Task 4), `film` (Task 2), `ASH` (Task 3).
- Produces (`@package`, `./layers`): `interface LayerParams { cols; gain; tauSec; spreadPerSec }`,
  `DEFAULT_LAYER_PARAMS`, `class Layer { heights: Float64Array; column(x, width): number;
  pour(x, r, width, maxPx): void; step(dt): void; clear(): void }`.
- Удаляется из `fx.ts`: `pop`, `splash`, `Bubble.endAt`, константы `POP_SEC`, `POP_RING_SCALE`,
  `DROPLET_SEC`, `MAX_POPS_PER_FRAME`, `OVERFLOW_FADE_SEC`, `SPLASH_*`, `FLOOR_RING_SQUASH`,
  импорт `popSpray`, `splashCrown`. `particle.ts` и `Ring`/`Shard` не трогаются (решение — в Task 9).

- [ ] **Step 1: Write the failing test** — `src/ui/scene/__specs__/layers.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYER_PARAMS, Layer } from '../layers';

const P = { ...DEFAULT_LAYER_PARAMS, cols: 48 };
/** 48 columns of 10 px. */
const W = 480;
const sum = (xs: Float64Array) => xs.reduce((a, x) => a + x, 0);

describe('Layer', () => {
  it('pours a particle into the column under it: gain · πr² over the column width', () => {
    const l = new Layer(P);
    l.pour(25, 10, W, 1_000);
    expect(l.heights[2]).toBeCloseTo((P.gain * Math.PI * 100) / 10, 9);
    expect(sum(l.heights)).toBeCloseTo(l.heights[2] as number, 9);
  });

  it('maps the right edge to the last column and caps the height', () => {
    const l = new Layer(P);
    for (let i = 0; i < 1_000; i++) l.pour(W, 20, W, 30);
    expect(l.heights[47]).toBe(30);
  });

  it('spreads to the neighbours without losing volume', () => {
    const l = new Layer({ ...P, tauSec: Number.POSITIVE_INFINITY });
    l.pour(245, 10, W, 1_000);
    const before = sum(l.heights);
    const peak = l.heights[24] as number;
    for (let i = 0; i < 100; i++) l.step(0.05);
    expect(sum(l.heights)).toBeCloseTo(before, 9);
    expect(l.heights[23]).toBeGreaterThan(0);
    expect(l.heights[25]).toBeGreaterThan(0);
    expect(l.heights[24]).toBeLessThan(peak);
  });

  it('settles out with the time constant', () => {
    const l = new Layer({ ...P, spreadPerSec: 0 });
    l.pour(5, 10, W, 1_000);
    const h0 = l.heights[0] as number;
    for (let i = 0; i < 1_200; i++) l.step(0.1);
    expect(l.heights[0]).toBeCloseTo(h0 / Math.E, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/scene/__specs__/layers.spec.ts`
Expected: FAIL — `Failed to resolve import "../layers"`.
- [ ] **Step 3: Создать `src/ui/scene/layers.ts`**

```ts
/** @package */
export interface LayerParams {
  /** Columns across the width. */
  cols: number;
  /** Height poured per px² of particle area, per px of column width: foam is airy. */
  gain: number;
  /** Exponential settling time constant, s. */
  tauSec: number;
  /** Exchange rate between neighbouring columns, 1/s; the step clamps rate · dt to 0.5. */
  spreadPerSec: number;
}

/** @package */
export const DEFAULT_LAYER_PARAMS: LayerParams = {
  cols: 48,
  gain: 0.05,
  tauSec: 120,
  spreadPerSec: 2,
};

/**
 * A heap along one screen edge (foam at the top, sediment on the floor): column heights in px
 * that particles pour into, that even out with their neighbours and slowly settle out.
 * @package
 */
export class Layer {
  readonly heights: Float64Array;
  private readonly next: Float64Array;

  constructor(private readonly p: LayerParams = DEFAULT_LAYER_PARAMS) {
    this.heights = new Float64Array(p.cols);
    this.next = new Float64Array(p.cols);
  }

  /** Column under `x` on a `width`-px screen. */
  column(x: number, width: number): number {
    return Math.min(this.p.cols - 1, Math.max(0, Math.floor((x / width) * this.p.cols)));
  }

  /** Adds a particle of radius `r` landing at `x`; the column stops at `maxPx`. */
  pour(x: number, r: number, width: number, maxPx: number): void {
    const i = this.column(x, width);
    const add = (this.p.gain * Math.PI * r * r) / (width / this.p.cols);
    this.heights[i] = Math.min(maxPx, (this.heights[i] as number) + add);
  }

  /** Evens out with the neighbours (volume kept, edges reflect) and settles with tauSec. */
  step(dt: number): void {
    const h = this.heights;
    const n = h.length;
    // Explicit diffusion is stable and never overshoots up to 0.5.
    const k = Math.min(0.5, this.p.spreadPerSec * dt);
    const keep = Math.exp(-dt / this.p.tauSec);
    for (let i = 0; i < n; i++) {
      const here = h[i] as number;
      const left = h[Math.max(0, i - 1)] as number;
      const right = h[Math.min(n - 1, i + 1)] as number;
      this.next[i] = (here + k * (left - 2 * here + right)) * keep;
    }
    h.set(this.next);
  }

  clear(): void {
    this.heights.fill(0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/scene/__specs__/layers.spec.ts`
Expected: PASS.
- [ ] **Step 5: Слои в `fx.ts`, окончание С1 удалить**

Импорты: `import { Layer } from './layers';`; добавить `ASH` в импорт из `./sprites`; убрать
`popSpray`, `splashCrown` из импорта `./particle`.

Удалить константы `POP_SEC`, `POP_RING_SCALE`, `DROPLET_SEC`, `MAX_POPS_PER_FRAME`,
`OVERFLOW_FADE_SEC`, `SPLASH_SEC`, `SPLASH_GRAVITY`, `SPLASH_RING_SEC`, `FLOOR_RING_SQUASH`;
документацию `FADE_OUT_SHARE` вернуть к `/** Last share of a particle's life spent fading out. */`.
Добавить:

```ts
/** Each layer is at most this share of the screen height. */
const LAYER_MAX_SHARE = 0.12;
/** Thinner layers are not drawn, px. */
const MIN_LAYER_PX = 0.5;
/** Micro-bubbles per foam column and their opacity. */
const FOAM_DOTS_PER_COL = 6;
const FOAM_DOT_ALPHA = 0.6;
```

Модульные функции (после `setLocal`):

```ts
const peak = (xs: Float64Array) => {
  let m = 0;
  for (const x of xs) m = Math.max(m, x);
  return m;
};

/** Opens a path along a layer's surface: heights from `base`, `dir` +1 downward, −1 upward. */
function traceSurface(
  ctx: CanvasRenderingContext2D,
  heights: Float64Array,
  w: number,
  base: number,
  dir: 1 | -1,
): void {
  const n = heights.length;
  const col = w / n;
  const yAt = (i: number) => base + dir * (heights[i] as number);
  ctx.beginPath();
  ctx.moveTo(0, yAt(0));
  // Quadratic segments through the midpoints between column centres: a smooth surface.
  for (let i = 0; i < n - 1; i++) {
    const x = (i + 0.5) * col;
    ctx.quadraticCurveTo(x, yAt(i), x + col / 2, (yAt(i) + yAt(i + 1)) / 2);
  }
  ctx.lineTo(w, yAt(n - 1));
}
```

`interface Bubble`: удалить `endAt`; в `spawn()` удалить `endAt: null,`.

Поля:

```ts
  private readonly foam = new Layer();
  private readonly sediment = new Layer();
  /** Micro-bubbles in the foam: fixed spots per column, at a share of its depth. */
  private readonly foamDots = Array.from(
    { length: this.foam.heights.length * FOAM_DOTS_PER_COL },
    (_, i) => ({
      col: Math.floor(i / FOAM_DOTS_PER_COL),
      dx: Math.random(),
      depth: 0.2 + 0.7 * Math.random(),
      r: 1.5 + 2 * Math.random(),
    }),
  );
```

`clear()`: добавить `this.foam.clear();` и `this.sediment.clear();`.

`frame()`: перед `ctx.globalCompositeOperation = 'lighter';` добавить
`this.foam.step(dt);` и `this.sediment.step(dt);`; сразу после установки `'lighter'` —
`this.drawLayers(w, h);`; вызов `this.drawBubbles(dt, h, dpr)` заменить на
`this.drawBubbles(dt, w, h, dpr);`.

Удалить методы `pop` и `splash`. `drawBubbles` целиком:

```ts
  private drawBubbles(dt: number, w: number, h: number, dpr: number): void {
    const { ctx, foam, sediment } = this;
    const floor = this.floor ?? h;
    const maxLayer = LAYER_MAX_SHARE * h;
    let alive = 0;
    for (const b of this.bubbles) {
      b.age += dt;
      if (b.age >= b.life || b.y < -b.r * 4 || b.y > h + b.r * 4) continue;
      // Reaching its edge, a particle joins the layer there.
      if (b.side === 'buy') {
        if (b.y - b.r <= (foam.heights[foam.column(b.x, w)] as number)) {
          foam.pour(b.x, b.r, w, maxLayer);
          continue;
        }
      } else if (b.y + b.r >= floor - (sediment.heights[sediment.column(b.x, w)] as number)) {
        sediment.pour(b.x, b.r, w, maxLayer);
        continue;
      }
      b.vy += b.ay * dt;
      // Gentle sideways sway; bigger bubbles sway slower and wider, like real ones.
      const vx = b.vx + Math.sin(b.age * (2.6 - b.r * 0.05) + b.phase) * (8 + b.r);
      b.x += vx * dt;
      b.y += b.vy * dt;
      const fadeIn = Math.min(1, b.age / FADE_IN_SEC);
      const outStart = b.life * (1 - FADE_OUT_SHARE);
      const fadeOut = b.age < outStart ? 1 : 1 - (b.age - outStart) / (b.life - outStart);
      const a = fadeIn * fadeOut;
      if (b.halo) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(b.age * 5));
        const hr = b.r * 4;
        ctx.drawImage(b.halo, b.x - hr, b.y - hr, hr * 2, hr * 2);
      }
      // Stretched along the motion, sway included.
      const speed = Math.hypot(vx, b.vy);
      const ux = speed > 0 ? vx / speed : 0;
      const uy = speed > 0 ? b.vy / speed : 1;
      const k = stretchAt(b.side, speed, b.age, b.r);
      if (b.side === 'buy') {
        setLocal(ctx, stretchAlong(ux, uy, k), b.x, b.y, dpr);
        this.drawFilm(b, a);
      } else {
        // Teardrop along its motion: the head at the particle, the tail trailing behind.
        setLocal(ctx, orientAlong(ux, uy, k), b.x, b.y, dpr);
        ctx.globalAlpha = a;
        const frame = this.dropFrames[frameAt(b.age, b.life, COOL_FRAMES)] as HTMLCanvasElement;
        ctx.drawImage(frame, -3 * b.r, -b.r, 4 * b.r, 2 * b.r);
      }
      this.bubbles[alive++] = b;
    }
    this.bubbles.length = alive;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
```

Новый метод (перед `drawBubbles`):

```ts
  /** Foam under the top edge and sediment on the floor, beneath the particles. */
  private drawLayers(w: number, h: number): void {
    const { ctx, foam, sediment } = this;
    const maxLayer = LAYER_MAX_SHARE * h;
    const floor = this.floor ?? h;
    ctx.globalAlpha = 1;
    if (peak(foam.heights) >= MIN_LAYER_PX) {
      const fill = ctx.createLinearGradient(0, 0, 0, maxLayer);
      fill.addColorStop(0, css(UP_COLOR, 0.3));
      fill.addColorStop(1, css(UP_COLOR, 0.06));
      traceSurface(ctx, foam.heights, w, 0, 1);
      ctx.lineTo(w, 0);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      // Micro-bubbles sit at a share of their column's depth, so they rise as the foam thins.
      ctx.globalAlpha = FOAM_DOT_ALPHA;
      const col = w / foam.heights.length;
      for (const d of this.foamDots) {
        const depth = foam.heights[d.col] as number;
        if (depth < d.r * 2) continue;
        const x = (d.col + d.dx) * col;
        const y = d.depth * depth;
        ctx.drawImage(this.film, x - d.r, y - d.r, d.r * 2, d.r * 2);
      }
      ctx.globalAlpha = 1;
    }
    if (peak(sediment.heights) >= MIN_LAYER_PX) {
      const fill = ctx.createLinearGradient(0, floor, 0, floor - maxLayer);
      fill.addColorStop(0, css(ASH, 0.6));
      fill.addColorStop(1, css(DOWN_COLOR, 0.12));
      traceSurface(ctx, sediment.heights, w, floor, -1);
      ctx.lineTo(w, floor);
      ctx.lineTo(0, floor);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      // A hot crust: the surface glows.
      traceSurface(ctx, sediment.heights, w, floor, -1);
      ctx.strokeStyle = css(DOWN_COLOR, 0.55);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
```

- [ ] **Step 6: Проверить**

Run: `pnpm check && pnpm test && pnpm build` — зелёное.
На глаз: пузыри, долетевшие до верха, копятся бирюзовой пеной с микропузырьками, больше справа;
капли, долетевшие до графика, — багровым осадком со светящейся кромкой, больше слева. Слои
неровные, но связные, за пару минут без притока тают. Не толще ~12 % высоты. Пузыри больше не
лопаются, капли не разбиваются. Скриншот, fps.
- [ ] **Step 7: Commit**

```bash
git add src/ui/scene/layers.ts src/ui/scene/__specs__/layers.spec.ts src/ui/scene/fx.ts
git commit -m "feat: foam and sediment layers instead of pops and splashes"
```

---

### Task 9: Решение С1/С7, уборка, документация

**Files:**
- Modify (по решению): `src/ui/scene/particle.ts`, `src/ui/scene/__specs__/particle.spec.ts`,
  `src/ui/scene/spawn.ts`, `src/ui/scene/fx.ts`
- Modify: `README.md`, `AGENTS.md`, `docs/superpowers/specs/2026-10-27-trade-particles-design.md`

- [ ] **Step 1: Показать пользователю обе версии и получить решение**

`git log --oneline -10` → SHA коммитов Task 7 (С1) и Task 8 (С7). Сравнение:
`git switch --detach <sha-task-7>` → `pnpm dev` → смотреть; `git switch feat/trade-particles` →
смотреть. Также спросить, какие из идей Task 1–7 откатить. Ждать явного ответа.
- [ ] **Step 2a (если С1): откатить С7**

```bash
git revert --no-edit <sha-task-8>
```

- [ ] **Step 2b (если С7): удалить то, чем пользовался только С1**

- `particle.ts`: удалить `Spray`, `DROPLET_MIN_R_PX`, `CROWN_HALF_ANGLE`, `radiusDecades`,
  `popSpray`, `splashCrown`; импорт сократить до `MIN_R_PX`.
- `particle.spec.ts`: удалить блоки `radiusDecades`, `popSpray`, `splashCrown`, `seeded`,
  `LARGEST_R` и лишние импорты.
- `spawn.ts`: `R_PER_DECADE_PX` больше не нужен снаружи — сделать неэкспортируемой константой
  без `@package`.
- `fx.ts`: `Ring` вернуть к `{ x, y, maxR, age, delay, width, alpha, color }` — в `drawRings`
  радиус `LIQ_RING_R0_PX + r.maxR * eased`, `ctx.arc(r.x, r.y, …)`, длительность `RING_SEC`;
  `Shard` — к `{ x, y, vx, vy, age, color }`, в `drawShards` `SHARD_SEC`, `SHARD_WIDTH_PX`, без
  гравитации; соответственно упростить пуши в `liquidation()`.
- Пол (`setFloor`, `placeFloor` в `stage.ts`) остаётся.

Run: `pnpm check && pnpm test && pnpm build` — зелёное.

```bash
git add -A src/ui/scene
git commit -m "refactor: drop what only pops and splashes used"
```

- [ ] **Step 3: Откаты идей, если пользователь попросил** — `git revert --no-edit <sha>` по одной,
  начиная с поздних; при конфликте в `fx.ts` оставить код остальных идей, убрать только
  откатываемую, затем `pnpm check && pnpm test && pnpm build` и `git revert --continue`.

- [ ] **Step 4: Документация**

- `README.md`, раздел **Visuals**, пункт «Every buy is a bubble…»: описать итоговое — растяжение
  по скорости и вздрагивание, переливающаяся плёнка, капли-слёзы, остывающие на лету, аннигиляция
  со вспышкой, слияние до 48 px и выбранный конец жизни (лопание/корона или пена/осадок) — только
  то, что осталось после решений.
- `README.md`, **Status**: добавить `- [x] **Trade particles**: …` — после двоеточия через
  запятую оставленные идеи в формулировках README (например «film, teardrops, cancel and merge,
  foam and sediment»).
- `README.md`, «Manual checks per stage»: новый раздел `### Trade particles` первым:
  1. `pnpm test`: деформация, кадры остывания, пары касаний, аннигиляция и слияние (площадь,
     импульс), слои (если остались) / брызги (если остались).
  2. `pnpm dev` → ⚙ → SIMULATOR, sensitivity ×2: что видно в середине экрана и у краёв.
- `AGENTS.md`, `src/ui/` → `scene/`: перечислить новые модули (`sprites.ts` — спрайты частиц;
  чистые и покрытые спеками `particle.ts`, `grid.ts`, `annihilate.ts`, `merge.ts`, `layers.ts` —
  только оставшиеся) рядом с `scene/spawn.ts`.
- Спек: в «Статус» записать итог (что оставлено, что откатано, чем закончилось С1/С7) и
  фактические значения, которые менялись при подгонке.

- [ ] **Step 5: Финальная проверка и коммит**

Run: `pnpm check && pnpm test && pnpm build` — зелёное; «Проверка на глаз» ещё раз.

```bash
git add README.md AGENTS.md docs/superpowers/specs/2026-10-27-trade-particles-design.md
git commit -m "docs: trade particles"
```
