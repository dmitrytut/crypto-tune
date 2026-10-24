import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Puts the stylesheet into index.html as a `<style>`: one network round trip fewer before the
 * first paint, which is most of a slow mobile connection's LCP. Relative `url()`s in the CSS
 * point next to the stylesheet (fonts in assets/), so they are rebased onto the page. Anything
 * it cannot handle stays as it was and is reported as a build warning.
 */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    // Vite emits index.html in its own generateBundle; only a post plugin runs after it.
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset' || typeof html.source !== 'string') {
        this.warn('index.html not in the bundle: the stylesheet is not inlined');
        return;
      }
      let page = html.source;
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'asset' || !name.endsWith('.css')) continue;
        const href = `\\./${name.replaceAll('.', '\\.')}`;
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="${href}"[^>]*>`);
        const source = String(file.source);
        // Only `url(./file)` can be rebased. A bundled file (font) the CSS still names once
        // those are taken out is referenced another way (`file`, `../file`) and would break
        // once the CSS moves into the page.
        const rest = source.replace(/url\(['"]?\.\/[^'")]*/g, '');
        const unrebasable = Object.keys(bundle).some((other) =>
          rest.includes(other.slice(other.lastIndexOf('/') + 1)),
        );
        if (!link.test(page) || unrebasable) {
          this.warn(`${name} left as a file: no matching <link> or a url() it cannot rebase`);
          continue;
        }
        const dir = name.slice(0, name.lastIndexOf('/') + 1);
        const css = source.replace(/url\((['"]?)\.\//g, `url($1./${dir}`);
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
