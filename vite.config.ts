import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Puts the stylesheet into index.html as a `<style>`: one network round trip fewer before the
 * first paint, which is most of a slow mobile connection's LCP. Relative `url()`s in the CSS
 * point next to the stylesheet (fonts in assets/), so they are rebased onto the page.
 */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset' || typeof html.source !== 'string') return;
      let page = html.source;
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !name.endsWith('.css')) continue;
        const href = `\\./${name.replaceAll('.', '\\.')}`;
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="${href}"[^>]*>`);
        if (!link.test(page)) continue;
        const dir = name.slice(0, name.lastIndexOf('/') + 1);
        const css = String(file.source).replace(/url\((['"]?)\.\//g, `url($1./${dir}`);
        page = page.replace(link, () => `<style>${css}</style>`);
        delete bundle[name];
      }
      html.source = page;
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the same build works at https://crypto-tune.com/ and under the old
  // https://dmitrytut.github.io/crypto-tune/ path, so DNS cutover and deploy order do not matter.
  base: './',
  plugins: [inlineCss()],
  test: {
    include: ['src/**/__specs__/**/*.spec.ts'],
    environment: 'node',
  },
});
