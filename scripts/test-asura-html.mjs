// Run with: npx tsx scripts/test-asura-html.mjs
// Fixture smoke tests for the AsuraScans provider (no live network required).
import assert from 'node:assert/strict';

const site = 'https://asurascans.com';
const series = '/comics/cyberpunk-chivalry-7ba78ec7';
const cover = 'https://cdn.asurascans.com/asura-images/covers/cyberpunk-chivalry.webp';
const pages = [
  'https://cdn.asurascans.com/asura-images/chapters/cyberpunk-chivalry/1/01.webp',
  'https://cdn.asurascans.com/asura-images/chapters/cyberpunk-chivalry/1/02.webp',
];

const initialSeries = [1, [[0, {
  slug: [0, 'cyberpunk-chivalry-7ba78ec7'],
  title: [0, 'Cyberpunk Chivalry'],
  public_url: [0, series],
  cover: [0, cover],
}]]];
const props = JSON.stringify({ initialSeries }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const astroBrowse = `<astro-island client="visible" props="${props}" ssr opts="{}" component-url="/BrowseFilters.js"></astro-island>`;
const renderedBrowse = `<a href="${series}"><img alt="Cyberpunk Chivalry" src="${cover}"/><h3>Cyberpunk Chivalry</h3></a>`;
const detailHtml = `
  <meta property="og:title" content="Cyberpunk Chivalry"/>
  <meta property="og:image" content="${cover}"/>
  <a href='${site + series}/chapter/2'>Chapter 2</a>
  <a href="${series}/chapter/1">Chapter 1</a>
  <a href="${series}/chapter/1">Read first chapter</a>
`;
const chapterHtml = pages.map((url, i) => `<img alt="Page ${i + 1} - Chapter 1" src="${url}"/>`).join('');
let browseHtml = astroBrowse;
let provider;

globalThis.harbor = {
  register: (p) => { provider = p; },
  async http(url) {
    if (url.startsWith(site + '/browse')) return { status: 200, ok: true, body: browseHtml };
    if (url === site + series) return { status: 200, ok: true, body: detailHtml };
    if (url === site + series + '/chapter/1') return { status: 200, ok: true, body: chapterHtml };
    throw new Error('Unexpected fixture URL: ' + url);
  },
  log() {},
};

await import('../plugins/manga/asura-seanime-v2/index.ts');
assert.ok(provider, 'Asura v2 registered');

const fromAstro = await provider.popular(0);
assert.equal(fromAstro.length, 1, 'Astro island with rearranged attrs parses');
assert.deepEqual({ id: fromAstro[0].id, title: fromAstro[0].title, cover: fromAstro[0].cover },
  { id: series, title: 'Cyberpunk Chivalry', cover });

browseHtml = renderedBrowse;
const fromRendered = await provider.popular(0);
assert.equal(fromRendered[0]?.cover, cover, 'Rendered catalogue fallback preserves cover');
assert.equal(fromRendered[0]?.id, series);

const chapters = await provider.chapters(series);
assert.deepEqual(chapters.map((c) => c.chapter), ['1', '2'], 'Mixed absolute/relative and quoted links, deduplicated and sorted');
assert.deepEqual(await provider.pageUrls(chapters[0].id), pages, 'Chapter images retain reading order');

console.log('Asura v2 fixture smoke tests passed: catalogue, covers, chapters, reader pages');
