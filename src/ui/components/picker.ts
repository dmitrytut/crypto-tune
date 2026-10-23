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
  /** A search field over the options; without it the menu is a plain list. */
  search?: {
    placeholder: string;
    /** Shown when nothing matches. */
    empty: string;
    /** An unlisted query that may still be picked as typed, or null. */
    fallback?: (query: string) => string | null;
  };
  onPick(value: string): void;
}

/** What the owner may change on a mounted picker. */
export interface Picker {
  setOptions(values: readonly string[]): void;
  /** Shows `value` as chosen and enables the control. */
  set(value: string): void;
  /** Disables the control, showing `text` in place of a value. */
  disable(text: string): void;
}

/** Chevron (Lucide, ISC). */
const CHEVRON =
  '<svg class="icon picker-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
let nextId = 0;

/**
 * Dropdown list built into `host`: a button showing the value and a menu of options,
 * optionally with a search field filtering as you type. Arrows and Enter pick, Esc or
 * a press outside close. One component for every list in the UI, so they look and
 * behave alike; `host` classes choose the look (`picker-chip`, `picker-field`).
 */
export function mountPicker(host: HTMLElement, cfg: PickerConfig): Picker {
  const id = `picker-${nextId++}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'picker-btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', `${id}-menu`);
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
  const empty = document.createElement('p');
  empty.className = 'picker-empty';
  empty.hidden = true;

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
    empty.textContent = cfg.search.empty;
    menu.append(search);
  } else {
    // Without a search field the list itself takes focus and the arrow keys.
    list.tabIndex = -1;
  }
  menu.append(list, empty);
  host.append(button, menu);
  const keys: HTMLElement = search ?? list;

  let options: readonly string[] = [];
  let current = '';
  let shown: string[] = [];
  let active = -1;

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

  /** Rebuilds the rows; the highlight lands on the current value or on the best match. */
  const render = (onCurrent: boolean) => {
    const query = search?.value.trim() ?? '';
    shown = matchOptions(options, query);
    const typed = shown.length === 0 && query ? cfg.search?.fallback?.(query) : null;
    if (typed) shown = [typed];
    list.replaceChildren(
      ...shown.map((v, i) => {
        const row = document.createElement('div');
        row.id = `${id}-opt-${i}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(v === current));
        row.dataset.index = String(i);
        row.textContent = v;
        return row;
      }),
    );
    empty.hidden = shown.length > 0;
    active = -1;
    const at = onCurrent ? shown.indexOf(current) : -1;
    highlight(at >= 0 ? at : shown.length > 0 ? 0 : -1);
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
    render(true);
    list.children[active]?.scrollIntoView({ block: 'center' });
    keys.focus();
  };
  const show = (value: string) => {
    current = value;
    button.disabled = false;
    valueNode.textContent = value;
    button.setAttribute('aria-label', `${cfg.label}: ${value}`);
  };
  const pick = (value: string | undefined) => {
    if (value === undefined) return;
    close(true);
    if (value === current) return;
    show(value);
    cfg.onPick(value);
  };
  const rowIndex = (e: Event) => {
    const row =
      e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
    return row ? Number(row.dataset.index) : -1;
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close(false)));
  search?.addEventListener('input', () => render(false));
  keys.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (shown.length === 0) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        highlight((active + step + shown.length) % shown.length);
        return;
      }
      case 'Enter':
        e.preventDefault();
        pick(shown[active]);
        return;
      case 'Escape':
        // Inside the settings dialog Esc closes only the menu, not the dialog.
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case 'Tab':
        close(false);
    }
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
    setOptions(values) {
      options = values;
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
