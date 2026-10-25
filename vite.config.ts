import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { PAIR_PAGES, type PairPage, pagePath, pairPageOf } from './src/pair-pages.ts';

/**
 * Puts the stylesheet into index.html as a `<style>`: one network round trip fewer before the
 * first paint, which is most of a slow mobile connection's LCP. The base is absolute, so the
 * CSS `url()`s (fonts in /assets/) resolve the same from the page as from the stylesheet. A
 * relative `url()` would not, so such a stylesheet stays a file, reported as a build warning.
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
        const href = `/${name.replaceAll('.', '\\.')}`;
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="${href}"[^>]*>`);
        const source = String(file.source);
        // Absolute `url(/assets/…)`s work from any page. A bundled file (font) the CSS still
        // names once those are taken out is referenced relatively and would break in the page.
        const rest = source.replace(/url\(['"]?\/[^'")]*/g, '');
        const relative = Object.keys(bundle).some((other) =>
          rest.includes(other.slice(other.lastIndexOf('/') + 1)),
        );
        if (!link.test(page) || relative) {
          this.warn(`${name} left as a file: no matching <link> or a relative url()`);
          continue;
        }
        page = page.replace(link, () => `<style>${source}</style>`);
        delete bundle[name];
      }
      html.source = page;
    },
  };
}

/** Markers in index.html's About dialog: every page's links to all pair pages, a pair page's intro. */
const LINKS_MARK = '<!-- pair-pages:links -->';
const INTRO_MARK = '<!-- pair-pages:intro -->';

/** `from` must occur exactly `times` times: a template change must fail the build, not ship a copy of the home page. */
function swap(html: string, from: string, to: string, times = 1): string {
  const parts = html.split(from);
  if (parts.length - 1 !== times) {
    throw new Error(
      `pair pages: expected ${times}× ${from} in index.html, found ${parts.length - 1}`,
    );
  }
  return parts.join(to);
}

function pick(html: string, pattern: RegExp, what: string): string {
  const value = pattern.exec(html)?.[1];
  if (!value) throw new Error(`pair pages: no ${what} in index.html`);
  return value;
}

/** Title, description and heading of a pair page; checked because they land in attributes and JSON-LD. */
function pageTexts(p: PairPage) {
  const label = p.name === p.ticker ? p.name : `${p.name} (${p.ticker})`;
  const texts = {
    title: `Listen to ${p.name} live: ${p.symbol} as music · Crypto Tune`,
    description: `Hear ${label} perpetual futures as calm generative music: live trades and liquidations from Binance set the tempo, the melody and the gongs. Free, in the browser.`,
    heading: `${label} futures, played as sound`,
    intro: p.intro,
  };
  for (const text of Object.values(texts)) {
    if (/[&<>"\\]/.test(text)) throw new Error(`pair pages: unescaped character in ${text}`);
  }
  return texts;
}

/** Links to every pair page in the About dialog, so crawlers find them; dev server included. */
function pairLinks(): Plugin {
  return {
    name: 'pair-links',
    transformIndexHtml(html) {
      const links = PAIR_PAGES.map((p) => `<a href="${pagePath(p)}">${p.name}</a>`).join(', ');
      return swap(html, LINKS_MARK, `<p>Hear a single pair: ${links}.</p>`);
    },
  };
}

/**
 * Writes `/<slug>/index.html` for every pair page from the built home page (stylesheet already
 * inlined, so it runs after `inlineCss`), plus `sitemap.xml` and `robots.txt`. The site URL,
 * title and description come from index.html, which stays their one source.
 */
function pairPages(): Plugin {
  return {
    name: 'pair-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const home = bundle['index.html'];
      if (home?.type !== 'asset' || typeof home.source !== 'string') {
        this.error('index.html not in the bundle: no pair pages');
      }
      const html = home.source;
      const site = pick(html, /<link rel="canonical" href="([^"]+)"/, 'canonical URL');
      const title = pick(html, /<title>([^<]+)<\/title>/, 'title');
      const description = pick(html, /<meta name="description" content="([^"]+)"/, 'description');
      const urls = [site];
      for (const p of PAIR_PAGES) {
        if (pairPageOf(p.symbol) !== p) this.error(`pair pages: ${p.symbol} listed twice`);
        const t = pageTexts(p);
        const path = pagePath(p);
        const url = new URL(path, site).href;
        let page = html;
        // Meta, Open Graph and JSON-LD carry the same description.
        page = swap(page, description, t.description, 3);
        page = swap(page, `<title>${title}</title>`, `<title>${t.title}</title>`);
        page = swap(
          page,
          `property="og:title" content="${title}"`,
          `property="og:title" content="${t.title}"`,
        );
        page = swap(
          page,
          `<h1 class="visually-hidden">${title}</h1>`,
          `<h1 class="visually-hidden">${t.heading}</h1>`,
        );
        page = swap(page, `rel="canonical" href="${site}"`, `rel="canonical" href="${url}"`);
        page = swap(
          page,
          `property="og:url" content="${site}"`,
          `property="og:url" content="${url}"`,
        );
        page = swap(page, `"url": "${site}"`, `"url": "${url}"`);
        page = swap(page, INTRO_MARK, `<p>${t.intro}</p>`);
        page = swap(page, `<a href="${path}">`, `<a href="${path}" aria-current="page">`);
        this.emitFile({ type: 'asset', fileName: `${p.slug}/index.html`, source: page });
        urls.push(url);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', site).href}\n`,
      });
    },
  };
}

export default defineConfig({
  // Absolute asset URLs: pair pages at /<slug>/ load the same /assets/ as the home page. The old
  // https://dmitrytut.github.io/crypto-tune/ address redirects to the custom domain.
  base: '/',
  plugins: [pairLinks(), inlineCss(), pairPages()],
  test: {
    include: ['src/**/__specs__/**/*.spec.ts'],
    environment: 'node',
  },
});
