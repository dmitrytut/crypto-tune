/**
 * Element from index.html by id; missing markup is a programming error.
 * @package
 */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing in index.html`);
  return node as T;
}

/**
 * Compact USD, e.g. $766.3K.
 * @package
 */
export const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
