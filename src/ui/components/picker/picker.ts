import './picker.css';

/**
 * Options matching a typed query, case-insensitively: exact, prefix, then contains.
 * Favorites lead each group; otherwise list order is preserved. An empty query
 * shows all favorites first, followed by the rest.
 * @package
 */
export function matchOptions(
  list: readonly string[],
  query: string,
  favorites?: ReadonlySet<string>,
): string[] {
  const q = query.trim().toUpperCase();
  if (!q && !favorites?.size) return [...list];
  const exact: string[] = [];
  const starts: string[] = [];
  const contains: string[] = [];
  const favoriteStarts: string[] = [];
  const favoriteContains: string[] = [];
  for (const s of list) {
    const u = s.toUpperCase();
    const favorite = favorites?.has(s);
    if (u === q) exact.push(s);
    else if (u.startsWith(q)) (favorite ? favoriteStarts : starts).push(s);
    else if (u.includes(q)) (favorite ? favoriteContains : contains).push(s);
  }
  return exact.concat(favoriteStarts, starts, favoriteContains, contains);
}

/** What a picker shows and what happens on a pick. */
export interface PickerConfig {
  /** Names the control for assistive tech: "<label>: <value>". */
  label: string;
  /**
   * Tabs over separate option lists (the pair's market), above the search. A tab only browses;
   * a pick reports the tab it came from. Without tabs there is one list, scope `''`.
   */
  scopes?: { label: string; choices: readonly { value: string; text: string }[] };
  /** A search field over the options; without it the menu is a plain list. */
  search?: {
    placeholder: string;
    /** Shown when nothing matches. */
    empty: string;
    /** An unlisted query that may still be picked as typed in `scope`, or null. */
    fallback?: (query: string, scope: string) => string | null;
  };
  /** Optional per-scope pinning. The owner persists changes, independently of picking. */
  favorites?: {
    values(scope: string): readonly string[];
    onChange(values: string[], scope: string): void;
  };
  onPick(value: string, scope: string): void;
}

/** What the owner may change on a mounted picker. */
export interface Picker {
  /** The options of `scope` (of the one list without scopes). */
  setOptions(values: readonly string[], scope?: string): void;
  /** Shows `value` of `scope` as chosen and enables the control. */
  set(value: string, scope?: string): void;
  /** Disables the control, showing `text` in place of a value. */
  disable(text: string): void;
}

/** Chevron (Lucide, ISC). */
const CHEVRON =
  '<svg class="icon picker-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
/** Star (Lucide, ISC). */
const STAR =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>';
let nextId = 0;

/**
 * Dropdown list built into `host`: a button showing the value and a menu of options,
 * optionally with tabs over several lists and a search field filtering as you type. Arrows
 * and Enter pick, Esc, Tab out or a press outside close. One component for every list in the
 * UI, so they look and behave alike; `host` classes choose the look (`picker-chip`,
 * `picker-field`). Its outside-press listener lives on `document` with no teardown: mount
 * once per page.
 */
export function mountPicker(host: HTMLElement, cfg: PickerConfig): Picker {
  const id = `picker-${nextId++}`;
  // A grid permits two independent controls per row; a listbox option cannot contain buttons.
  const listRole = cfg.favorites ? 'grid' : 'listbox';
  const rowRole = cfg.favorites ? 'row' : 'option';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'picker-btn';
  button.setAttribute('aria-haspopup', listRole);
  button.setAttribute('aria-expanded', 'false');
  // Point at the popup's composite widget, not its menu wrapper.
  button.setAttribute('aria-controls', `${id}-list`);
  const valueNode = document.createElement('span');
  button.append(valueNode);
  button.insertAdjacentHTML('beforeend', CHEVRON);

  const menu = document.createElement('div');
  menu.className = 'picker-menu';
  menu.id = `${id}-menu`;
  menu.hidden = true;
  const list = document.createElement('div');
  list.className = 'picker-list';
  list.id = `${id}-list`;
  list.setAttribute('role', listRole);
  list.setAttribute('aria-label', cfg.label);
  // "No such pair" is announced as it appears; it lives outside the list and needs no focus.
  const empty = document.createElement('p');
  empty.className = 'picker-empty';
  empty.setAttribute('role', 'status');

  // Tabs are a radio group: arrows switch them natively, Tab moves on to the search.
  let tabs: HTMLFieldSetElement | null = null;
  if (cfg.scopes) {
    tabs = document.createElement('fieldset');
    tabs.className = 'picker-scopes';
    tabs.setAttribute('aria-label', cfg.scopes.label);
    for (const { value, text } of cfg.scopes.choices) {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `${id}-scope`;
      radio.value = value;
      radio.className = 'visually-hidden';
      const label = document.createElement('label');
      label.append(radio, text);
      tabs.append(label);
    }
    menu.append(tabs);
  }
  let search: HTMLInputElement | null = null;
  if (cfg.search) {
    search = document.createElement('input');
    search.type = 'text';
    search.className = 'picker-search';
    search.placeholder = cfg.search.placeholder;
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-haspopup', listRole);
    search.setAttribute('aria-label', cfg.search.placeholder);
    search.setAttribute('aria-controls', list.id);
    search.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-autocomplete', 'list');
    menu.append(search);
  } else {
    // Without a search field the list itself takes focus and the arrow keys.
    list.tabIndex = -1;
  }
  menu.append(list, empty);
  host.append(button, menu);
  const keys: HTMLElement = search ?? list;

  /** Each scope's options with one row per option, made once per list. */
  const lists = new Map<string, { options: readonly string[]; rows: Map<string, HTMLElement> }>();
  /**
   * The scope whose rows the list holds in full and in order, as an empty query shows them,
   * so opening an unfiltered menu creates nothing; null while filtered.
   */
  let fullScope: string | null = null;
  let selected: Element | null = null;
  let current = '';
  /** Scope of `current`. */
  let scope = '';
  /** Scope of the tab on show. */
  let view = '';
  let shown: string[] = [];
  let active = -1;
  let nextRow = 0;

  const makeRow = (value: string, of: string) => {
    const row = document.createElement('div');
    row.id = `${id}-opt-${nextRow++}`;
    row.setAttribute('role', rowRole);
    row.setAttribute('aria-selected', 'false');
    if (cfg.favorites) {
      for (const favorite of [true, false]) {
        const cell = document.createElement('div');
        cell.setAttribute('role', 'gridcell');
        const control = document.createElement('button');
        control.type = 'button';
        control.tabIndex = -1;
        control.className = favorite ? 'picker-favorite' : 'picker-choice';
        if (favorite) {
          control.innerHTML = STAR;
          control.setAttribute('aria-label', `Favorite ${value}`);
          control.setAttribute('aria-pressed', String(cfg.favorites.values(of).includes(value)));
        } else {
          control.textContent = value;
        }
        cell.append(control);
        row.append(cell);
      }
    } else {
      row.textContent = value;
    }
    return row;
  };

  const highlight = (i: number) => {
    for (const control of list.children[active]?.querySelectorAll('button') ?? []) {
      control.tabIndex = -1;
    }
    list.children[active]?.removeAttribute('data-active');
    active = i;
    const row = list.children[i];
    if (!row) {
      keys.removeAttribute('aria-activedescendant');
      return;
    }
    for (const control of row.querySelectorAll('button')) control.tabIndex = 0;
    row.setAttribute('data-active', '');
    keys.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  };

  /** Shows the rows matching the query; highlights the current value or the best match. */
  const render = (onCurrent: boolean) => {
    // Rows outlive a render: drop the old highlight before the list changes under it.
    for (const control of list.children[active]?.querySelectorAll('button') ?? []) {
      control.tabIndex = -1;
    }
    list.children[active]?.removeAttribute('data-active');
    const query = search?.value.trim() ?? '';
    const of = lists.get(view);
    shown = matchOptions(
      of?.options ?? [],
      query,
      cfg.favorites ? new Set(cfg.favorites.values(view)) : undefined,
    );
    const typed = shown.length === 0 && query ? cfg.search?.fallback?.(query, view) : null;
    if (typed) shown = [typed];
    if (query || fullScope !== view) {
      list.replaceChildren(...shown.map((v) => of?.rows.get(v) ?? makeRow(v, view)));
      fullScope = query ? null : view;
    }
    // The rows are `shown` in order, so the current value's row is at its index.
    const at = view === scope ? shown.indexOf(current) : -1;
    selected?.setAttribute('aria-selected', 'false');
    selected = list.children[at] ?? null;
    selected?.setAttribute('aria-selected', 'true');
    empty.textContent = shown.length > 0 ? '' : (cfg.search?.empty ?? '');
    active = -1;
    highlight(onCurrent && at >= 0 ? at : shown.length > 0 ? 0 : -1);
  };

  const close = (refocus: boolean) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  };
  const open = () => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    if (search) search.value = '';
    view = scope;
    for (const radio of tabs?.querySelectorAll('input') ?? []) radio.checked = radio.value === view;
    render(!cfg.favorites);
    if (cfg.favorites) list.scrollTop = 0;
    else list.children[active]?.scrollIntoView({ block: 'center' });
    keys.focus();
  };
  const show = (value: string, of = '') => {
    current = value;
    scope = of;
    button.disabled = false;
    valueNode.textContent = value;
    button.setAttribute('aria-label', `${cfg.label}: ${value}`);
  };
  const pick = (value: string | undefined) => {
    if (value === undefined) return;
    close(true);
    if (value === current && view === scope) return;
    show(value, view);
    cfg.onPick(value, view);
  };
  const rowIndex = (e: Event) => {
    const row =
      e.target instanceof Element ? e.target.closest<HTMLElement>(`[role="${rowRole}"]`) : null;
    return row ? Array.prototype.indexOf.call(list.children, row) : -1;
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close(false)));
  search?.addEventListener('input', () => render(false));
  // A tab keeps the query: `eth` on USDⓈ-M, then COIN-M, shows ETHUSD_PERP.
  tabs?.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    view = e.target.value;
    render(!cfg.favorites);
    // A pressed tab hands focus back to the search, so typing and arrows go on working the
    // list; a tab reached by keyboard (focus-visible) keeps it, its arrows switch tabs.
    if (!e.target.matches(':focus-visible')) keys.focus();
  });
  keys.addEventListener('keydown', (e) => {
    // Plain lists leave on Tab; grids let Tab reach the active row's controls.
    if (e.key === 'Tab' && !e.shiftKey && !cfg.favorites) close(false);
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.key === 'Enter') {
      pick(shown[active]);
      return;
    }
    if (shown.length === 0) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    highlight((active + step + shown.length) % shown.length);
  });
  list.addEventListener('keydown', (e) => {
    if (!(e.target instanceof HTMLButtonElement)) return;
    const column = e.target.classList.contains('picker-favorite') ? 0 : 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      highlight((rowIndex(e) + step + shown.length) % shown.length);
      list.children[active]?.querySelectorAll('button')[column]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      list.children[rowIndex(e)]
        ?.querySelectorAll('button')
        [e.key === 'ArrowLeft' ? 0 : 1]?.focus();
    }
  });
  list.addEventListener('focusin', (e) => {
    const i = rowIndex(e);
    if (i >= 0 && i !== active) highlight(i);
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Inside the settings dialog Esc closes only the menu, not the dialog.
    e.preventDefault();
    e.stopPropagation();
    close(true);
  });
  // Focus tabbing out of the menu, either way, closes it. A press on a row moves focus to
  // nothing (relatedTarget null): that one is a pick, not a leave.
  menu.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && !menu.contains(e.relatedTarget)) close(false);
  });
  list.addEventListener('mouseover', (e) => {
    const i = rowIndex(e);
    if (i >= 0 && i !== active && (!cfg.favorites || !list.contains(document.activeElement))) {
      highlight(i);
    }
  });
  list.addEventListener('click', (e) => {
    const value = shown[rowIndex(e)];
    if (value === undefined) return;
    const star = e.target instanceof Element ? e.target.closest('.picker-favorite') : null;
    if (!star || !cfg.favorites) {
      pick(value);
      return;
    }
    const favorites = new Set(cfg.favorites.values(view));
    if (favorites.has(value)) favorites.delete(value);
    else favorites.add(value);
    cfg.favorites.onChange([...favorites], view);
    star.setAttribute('aria-pressed', String(favorites.has(value)));
    // Reordering must keep keyboard focus on the same pair, not its former neighbour.
    const focused = list.contains(document.activeElement);
    fullScope = null;
    render(false);
    highlight(shown.indexOf(value));
    if (focused)
      list.children[active]?.querySelector<HTMLButtonElement>('.picker-favorite')?.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Node && host.contains(e.target))) close(false);
  });

  return {
    setOptions(values, of = '') {
      const hadFocus = list.contains(document.activeElement);
      const rows = new Map(values.map((v) => [v, makeRow(v, of)]));
      lists.set(of, { options: values, rows });
      // The list the menu shows, or will show on open: built now, usually while the menu is
      // hidden, rather than inside the click that opens it.
      if (of !== (menu.hidden ? scope : view)) return;
      list.replaceChildren(...rows.values());
      fullScope = cfg.favorites ? null : of;
      if (!menu.hidden) {
        render(false);
        // A delayed symbol list can replace a focused button in the typed fallback row.
        if (hadFocus) keys.focus();
      }
    },
    set: show,
    disable(text) {
      close(false);
      current = '';
      button.disabled = true;
      valueNode.textContent = text;
      button.setAttribute('aria-label', `${cfg.label}: ${text}`);
    },
  };
}
