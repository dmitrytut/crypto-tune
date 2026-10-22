/**
 * Element from index.html by id; missing markup is a programming error.
 * @package
 */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing in index.html`);
  return node as T;
}
