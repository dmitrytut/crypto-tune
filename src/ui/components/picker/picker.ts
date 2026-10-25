import './picker.css';

/**
 * Options matching a typed query, case-insensitively: an exact match first, then
 * prefix matches, then the rest that contain it, each group in list order. An empty
 * query keeps the whole list.
 * @package
 */
export function matchOptions(list: readonly string[], query: string): string[] {
  const q = query.trim().toUpperCase();
  if (!q) return [...list];
  const exact: string[] = [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const s of list) {
    const u = s.toUpperCase();
    if (u === q) exact.push(s);
    else if (u.startsWith(q)) starts.push(s);
    else if (u.includes(q)) contains.push(s);
  }
  return exact.concat(starts, contains);
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
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'picker-btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  // aria-haspopup says a listbox opens: point at the listbox, not the menu wrapping it.
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
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', cfg.label);
  // "No such pair" is announced as it appears; it lives outside the listbox and needs no focus.
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

  const makeRow = (value: string) => {
    const row = document.createElement('div');
    row.id = `${id}-opt-${nextRow++}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.textContent = value;
    return row;
  };

  const highlight = (i: number) => {
    list.children[active]?.removeAttribute('data-active');
    active = i;
    const row = list.children[i];
    if (!row) {
      keys.removeAttribute('aria-activedescendant');
      return;
    }
    row.setAttribute('data-active', '');
    keys.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  };

  /** Shows the rows matching the query; highlights the current value or the best match. */
  const render = (onCurrent: boolean) => {
    // Rows outlive a render: drop the old highlight before the list changes under it.
    list.children[active]?.removeAttribute('data-active');
    const query = search?.value.trim() ?? '';
    const of = lists.get(view);
    shown = matchOptions(of?.options ?? [], query);
    const typed = shown.length === 0 && query ? cfg.search?.fallback?.(query, view) : null;
    if (typed) shown = [typed];
    if (query || fullScope !== view) {
      list.replaceChildren(...shown.map((v) => of?.rows.get(v) ?? makeRow(v)));
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
    render(true);
    list.children[active]?.scrollIntoView({ block: 'center' });
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
      e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
    return row ? Array.prototype.indexOf.call(list.children, row) : -1;
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close(false)));
  search?.addEventListener('input', () => render(false));
  // A tab keeps the query: `eth` on USDⓈ-M, then COIN-M, shows ETHUSD_PERP.
  tabs?.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    view = e.target.value;
    render(true);
    // A pressed tab hands focus back to the search, so typing and arrows go on working the
    // list; a tab reached by keyboard (focus-visible) keeps it, its arrows switch tabs.
    if (!e.target.matches(':focus-visible')) keys.focus();
  });
  keys.addEventListener('keydown', (e) => {
    // Forward Tab leaves the menu, past the list (Chrome lets a scrolling box take focus).
    if (e.key === 'Tab' && !e.shiftKey) close(false);
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
    if (i >= 0 && i !== active) highlight(i);
  });
  list.addEventListener('click', (e) => pick(shown[rowIndex(e)]));
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Node && host.contains(e.target))) close(false);
  });

  return {
    setOptions(values, of = '') {
      const rows = new Map(values.map((v) => [v, makeRow(v)]));
      lists.set(of, { options: values, rows });
      // The list the menu shows, or will show on open: built now, usually while the menu is
      // hidden, rather than inside the click that opens it.
      if (of !== (menu.hidden ? scope : view)) return;
      list.replaceChildren(...rows.values());
      fullScope = of;
      if (!menu.hidden) render(false);
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
