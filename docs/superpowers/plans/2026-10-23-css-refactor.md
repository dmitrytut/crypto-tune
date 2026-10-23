# CSS refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** один источник для цветов, типографики, отступов, радиусов, теней, движения и z-слоёв;
каскад, который не зависит от порядка файлов; ноль дублей значений между CSS-файлами.

**Architecture:** нативный CSS без препроцессора. Глобальные стили в `src/ui/styles/`:
`tokens.css` (дизайн-токены на `:root`) и `styles.css` (порядок `@layer`, base, разметка страницы,
утилиты). Каждый `components/<name>/<name>.css` лежит в `@layer components` и использует нативный
nesting и токены.
Литерал остаётся в правиле, только если его использует одно правило и он не является шагом шкалы.

**Tech Stack:** Vite 8 (Lightning CSS minify, PostCSS `@import` inline), Biome 2 (CSS lint + format),
Chromium-baseline: `:has()` уже обязателен, значит nesting, `@layer` и `color-mix()` доступны.

**Spec:** этот документ (разделы «Решения» и «Токены»). База: `master` после мержа #10
(`feat/ui-components`: CSS разложен по папкам компонентов) и #11 (`feat/link-preview`: OG-теги и
название Crypto Tune в `<head>` и README; стили не затрагивает).

**Статус:** выполнен, PR #12 (`feat/css-refactor` → `master`). Ветка начиналась как стек на #10;
после мержа #10 и #11 в неё влит `origin/master` без конфликтов, база PR переключена на `master`.

## Global Constraints

- Без новых зависимостей: ни Sass, ни PostCSS-плагинов, ни Tailwind.
- Пользовательский текст не меняется; разметка `index.html` не меняется.
- Визуальных изменений нет, кроме перечисленных в «Намеренные изменения».
- Biome форматирует CSS (2 пробела, двойные кавычки, ширина 100); вручную против него не форматировать.
- `--up` и `--down` остаются рантайм-переменными из `palette.ts` (`app.ts` → `setProperty`).
- Каждый эффект движения уважает `prefers-reduced-motion`.

## Решения

| Вопрос                 | Решение                                                                              | Почему                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCSS / Tailwind        | нет                                                                                  | Всё нужное есть в CSS; переменные Sass не видят рантайм `--up/--down`; Tailwind размазал бы стили по TS-строкам                                                               |
| Порядок каскада        | `@layer base, page, components, utilities;` первой строкой `styles.css`              | `app.ts` импортирует `styles.css` до компонентов, так что порядок объявлен раньше любого слоя. Утилиты (`.up`, `.down`, `.visually-hidden`) побеждают без гонки специфичности |
| Где токены             | `src/ui/styles/tokens.css`, `@import` из `styles/styles.css`                         | Один файл, который читают при правке палитры; правило AGENTS.md «живёт с владельцем»: токены принадлежат UI; оба глобальных файла в одной папке, как компоненты               |
| Что становится токеном | значение, которое делят 2+ правила, или шаг шкалы (палитра, кегли, отступы, радиусы) | То же правило, что для констант в AGENTS.md; одноразовые оптические значения (`padding: 9px 14px 9px 18px`) остаются литералами                                               |
| Кольцо фокуса          | одно правило в base: `:where(button, input, summary, [tabindex]):focus-visible`      | Было 5 копий `outline: 2px solid var(--text)`; range-инпуты и `summary` получали синее UA-кольцо                                                                              |
| Шрифт на canvas        | `fx.ts` читает `getComputedStyle(canvas).fontFamily`                                 | Стек `"Onest Variable", …` был продублирован строкой в TS                                                                                                                     |
| Классы цифр цены       | `chg-up` / `chg-down` вместо `chg up` / `chg down`                                   | Утилита `.up` красила цифру навсегда: вспышка не возвращалась к белому (проверено в браузере: после анимации `rgb(92, 242, 219)`)                                             |

## Токены

| Группа      | Токены                                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Палитра     | `--bg`, `--surface`, `--surface-strong`, `--surface-overlay` (было `#141519` ×5), `--text`, `--muted` (= `color-mix` от `--text`), `--line`, `--line-strong` (было `rgba(255,255,255,.36)` ×2), `--accent`, `--on-accent`, `--warn`, `--scrim` (`rgba(0,0,0,.45)` ×4) |
| Типографика | `--font-sans`; кегли `--font-size-xs/sm/md/lg/xl/2xl` = 12/13/14/15/17/18; `--tracking-label` = 0.01em                                                                                                                                                                |
| Отступы     | `--space-xs/sm/md/lg/xl` = 6/8/10/12/14; `--gutter` = 24 (поля страницы и ширина подсказки)                                                                                                                                                                           |
| Форма       | `--radius-sm/md/lg/xl/pill` = 8/10/14/20/999; `--border` = `1px solid var(--line)`                                                                                                                                                                                    |
| Тени        | `--shadow-pop` (меню, подсказка, тултип), `--text-shadow-legible` (текст поверх ауры)                                                                                                                                                                                 |
| Фокус       | `--focus-ring`, `--focus-offset`                                                                                                                                                                                                                                      |
| Движение    | `--duration-fast` = 0.15s, `--duration-fade` = 1.2s                                                                                                                                                                                                                   |
| Z-слои      | `--z-stage` 1 < `--z-grain` 2 на уровне страницы; внутри stage `--z-hint` 3 < `--z-menu` 4 < `--z-tooltip` 5                                                                                                                                                          |

## Намеренные изменения

1. Радиус поиска в пикере 9 → 8 px (концентричен меню: 14 − 6 padding = 8).
2. Радиус `.hint-pop` 12 → 14 px: как у меню пикера, все всплывашки одной формы.
3. Тень текста `.info` 10 → 12 px blur: одна «читаемая» тень с `.change`.
4. Кольцо фокуса сегментов 2 → 3 px offset; range-инпуты и `summary` получают то же белое кольцо.
5. Цифры цены возвращаются к цвету цены после вспышки (баг, см. «Решения»).
6. У кнопки Listen снова работают свои переходы (scale на hover 0.15 s, смена фона 0.3 s): `.fades`
   стоял в файле ниже и заменял её список на один `opacity`. Теперь список `.play` включает и `opacity`.
7. Трек и заливка метра: `3px` → `--radius-pill` (при высоте 6 px пиксели те же).
8. При `prefers-reduced-motion` кнопка Listen больше не «дышит»: `animation: none` в media-запросе
   (0,1,0) проигрывал `.play[data-state="running"]` (0,2,0).

## File Structure

```
src/ui/
├── styles/
│   ├── tokens.css             # NEW: все токены
│   └── styles.css             # перенесён из src/ui/: порядок слоёв, base, page, utilities
├── scene/fx.ts                # шрифт подписей из CSS
└── components/
    ├── chart-tip/chart-tip.css
    ├── hint/hint.css
    ├── meter/meter.css
    ├── picker/picker.css
    ├── price-readout/price-readout.css + price-readout.ts (классы цифр)
    └── settings-panel/settings-panel.css
```

---

### Task 1: Снимок «до»

**Files:** нет изменений в репо; артефакт `/tmp/css-before.json`, скриншоты `/tmp/css-before-*.png`.
- [x] Поднять `pnpm exec vite --port 5181` в worktree на базовом коммите (до рефакторинга).
- [x] Для всех элементов (кроме спанов цены) снять `getComputedStyle` + `::before/::after/::backdrop/::placeholder`
  в состояниях: base; toggled (`body.idle`, Listen `running`, hint `data-open`, тултип графика видим);
  меню пары открыто (live: в симуляторе пикер пары выключен); диалог настроек (+ debug); меню тоники.
- [x] Reduced motion эмулировать через Puppeteer `page.emulateMediaFeatures` (в `tab.run`): хелпер
  `tab.emulate({ media })` медиа-фичу не включает, `matchMedia` остаётся `false`.
- [x] Пройти Tab по странице (6) и диалогу (14), записать outline активного элемента.
- [x] Скриншоты: главный экран с подсказкой, открытый пикер, диалог. Перед снимком дождаться
  `#price .int` и дать переходам закончиться (подсказка появляется за 0.15 s).

### Task 2: Токены и глобальные стили

**Files:** Create `src/ui/styles/tokens.css`; Move + rewrite `src/ui/styles.css` → `src/ui/styles/styles.css`;
Modify `src/ui/app.ts:1` (импорт `./styles/styles.css`).

**Interfaces:** Produces: все токены из таблицы «Токены», слои `base, page, components, utilities`.
- [x] Создать `tokens.css` со всеми токенами из таблицы.
- [x] `styles.css`: первой строкой `@layer base, page, components, utilities;`, затем `@import` шрифта и токенов.
- [x] `@layer base`: `:root` (шрифт, цвет, фон), box-sizing, `html, body`, body-фон, зерно (`z-index: var(--z-grain)`),
  `:where(button, input) { font: inherit }`, единое кольцо фокуса, `.icon`.
- [x] `@layer page`: `.layer`, `.stage`, immersive (`.fades`, `body.idle`) **до** правил элементов с
  `.fades`, верхняя панель, `.status`, `.icon-btn`, hero, `.change`, `.info`, `#last-event`,
  `.play` (+ `opacity` в transition), `.chart`; reduced motion вложен в правило.
- [x] `@layer utilities`: `.up`, `.down`, `.visually-hidden`.

### Task 3: Компоненты

**Files:** Modify все 6 `components/*/*.css`, `price-readout.ts:39`.

**Interfaces:** Consumes: токены Task 2, слой `components`.
- [x] Обернуть каждый файл в `@layer components { … }`, переписать вложенностью (`&`).
- [x] Заменить литералы токенами по таблице; удалить локальные `outline` (их даёт base) и `font: inherit`.
- [x] `price-readout.ts`: `c.className = up ? 'chg-up' : 'chg-down'`; CSS `.price .chg-up/.chg-down`.

### Task 4: Шрифт на canvas

**Files:** Modify `src/ui/scene/fx.ts` (конструктор `Fx`, отрисовка подписей).
- [x] Поле `private readonly fontFamily`, в конструкторе `getComputedStyle(canvas).fontFamily`.
- [x] `ctx.font = \`700 ${l.size}px ${this.fontFamily}\``.

### Task 5: Проверка

- [x] `pnpm check && pnpm test && pnpm build`.
- [x] Повторить снимок Task 1 → `/tmp/css-after.json`; дифф по свойствам с нормализацией цвета
  (`color(srgb …)` → `rgba`). Каждая разница должна попасть в «Намеренные изменения».
- [x] В собранном CSS (`dist/assets/*.css`): `@import` развёрнуты, `&` не осталось, блоки `@layer`
  идут в порядке base → page → components → utilities. Отдельный оператор `@layer …;` Lightning CSS
  выбрасывает как избыточный: порядок задают сами блоки.
- [x] Цифра цены после вспышки имеет цвет `.price`.
- [x] При reduced motion у running-кнопки `animation-name: none` (до правки `breathe`).
- [x] Скриншоты «после».

### Task 6: Документация и PR

**Files:** Modify `AGENTS.md` (раздел `src/ui/` + правило «Styles» в Code organization), `README.md`.
- [x] AGENTS.md: где токены, слои, правило «токен vs литерал», запрет `.up/.down` вне утилит.
- [x] README: строка про стили.
- [x] Коммит, push `feat/css-refactor`, PR #12 (открыт в `feat/ui-components`).
- [x] После мержа #10 и #11: влить `origin/master`, перепроверить `check`/`test`/`build`, переключить
  базу PR на `master`.
