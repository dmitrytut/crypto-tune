import { priceDecimals, splitPrice } from './format';

/**
 * The big price. Decimals are fixed per pair from its first price, so the
 * layout never jitters; only the digits that changed flash in the move's colour.
 * @package
 */
export class PriceReadout {
  private decimals = -1;
  private shown = '';

  constructor(
    private readonly node: HTMLElement,
    private readonly reducedMotion: MediaQueryList,
  ) {}

  /** Integer and fraction parts as the readout shows them (also used for the tab title). */
  format(p: number): { int: string; frac: string } {
    if (this.decimals < 0) this.decimals = priceDecimals(p);
    return splitPrice(p, this.decimals);
  }

  render(p: number): void {
    if (Number.isNaN(p)) return;
    const { int, frac } = this.format(p);
    const text = int + frac;
    if (text === this.shown) return;
    const prev = this.shown;
    const up = Number(text.replaceAll(',', '')) > Number(prev.replaceAll(',', ''));
    // Only compare digit by digit when the layout is the same; otherwise nothing flashes.
    const flash = prev.length === text.length && !this.reducedMotion.matches;
    this.shown = text;
    const part = (chars: string, offset: number, cls: string) => {
      const box = document.createElement('span');
      box.className = cls;
      for (const [i, ch] of [...chars].entries()) {
        const c = document.createElement('span');
        if (ch === ',' || ch === '.') c.className = 'sep';
        else if (flash && prev[offset + i] !== ch) c.className = up ? 'chg up' : 'chg down';
        c.textContent = ch;
        box.append(c);
      }
      return box;
    };
    this.node.replaceChildren(part(int, 0, 'int'), part(frac, int.length, 'frac'));
  }

  /** A new pair: decimals are chosen again from its first price. */
  reset(): void {
    this.decimals = -1;
    this.shown = '';
    this.node.textContent = '—';
  }
}
