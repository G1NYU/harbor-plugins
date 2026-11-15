import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist/manga');
const testing = JSON.parse(fs.readFileSync(path.join(dist, 'repo-testing.json'), 'utf8'));
const main = JSON.parse(fs.readFileSync(path.join(dist, 'repo.json'), 'utf8'));
const ebook = JSON.parse(fs.readFileSync('dist/ebook/repo.json', 'utf8'));
assert.deepEqual(testing.plugins.map((p: any) => p.id).sort(), ['batcave', 'royalroad']);
const manifest = testing.plugins.find((p: any) => p.id === 'royalroad');
assert.equal(manifest.version, '1.1.0');
assert.equal(manifest.name, 'RoyalRoad (Native test)');
assert.ok(!main.plugins.some((p: any) => ['batcave', 'royalroad'].includes(p.id)));
assert.equal(ebook.plugins.find((p: any) => p.id === 'royalroad').version, '1.0.0');

type Fixture = {
  text(): string; attr(name: string): string | null;
  querySelector(selector: string): Fixture | null;
  querySelectorAll(selector: string): Fixture[];
};
function node(value = '', attrs: Record<string, string> = {}, children: Record<string, Fixture | Fixture[]> = {}): Fixture {
  return {
    text: () => value, attr: key => attrs[key] ?? null,
    querySelector: key => { const v = children[key]; return Array.isArray(v) ? v[0] ?? null : v ?? null; },
    querySelectorAll: key => { const v = children[key]; return Array.isArray(v) ? v : v ? [v] : []; },
  };
}
const card = node('', {}, {
  '.fiction-title a': node('Example Story!', {href: '/fiction/123/example-story'}),
  'img': node('', {src: 'https://www.royalroad.com/cover.png'}),
  '.author a': node('Example author'),
});
const catalogue = node('', {}, {'.fiction-list-item': [card, card, node()]});
const firstPath = '/fiction/123/example-story/chapter/456/prologue';
const secondPath = '/fiction/123/example-story/chapter/789/arrival';
const chapterRow = (title: string, href: string) => node('', {}, {
  'a[href*="/chapter/"]': node(title, {href}),
  'time': node('', {datetime: '2026-01-01T12:00:00Z'}),
});
const detail = node('', {}, {
  '.fiction-header, .page-content-inner': node('', {}, {
    'h1.font-white, h1': node('Example Story!'),
    'h4 a, .fiction-info a': node('Example author'),
    'img.thumbnail, .cover-art-container img': node('', {src: '//www.royalroad.com/cover.png'}),
  }),
  '.description .hidden-content, .description': node('Example summary.'),
  '#chapters tbody tr': [chapterRow('Prologue', firstPath), chapterRow('Arrival', secondPath), chapterRow('Duplicate', secondPath),
    chapterRow('Other fiction', '/fiction/999/other/chapter/5/other')],
});
const prose = node('', {}, {
  '.chapter-inner.chapter-content, .chapter-content': node('First paragraph. Second paragraph.', {}, {'p': [node('First paragraph.'), node('Second paragraph.')]}),
});
const requests: string[] = [];
let provider: any;
const mock = {
  register: (p: any) => { provider = p; },
  http: async (url: string) => {
    requests.push(url);
    if (url.includes('title=blocked')) return {status: 403, ok: false, body: 'Forbidden'};
    if (url.includes('/fictions/')) return {status: 200, ok: true, body: 'catalogue'};
    if (url.endsWith(firstPath)) return {status: 200, ok: true, body: 'prose'};
    if (url.includes('/fiction/123')) return {status: 200, ok: true, body: 'detail'};
    throw new Error('Unexpected request: ' + url);
  },
  parseHtml: async (body: string) => (({catalogue, detail, prose} as Record<string, Fixture>)[body] ?? (() => {throw new Error('Unexpected fixture: ' + body)})()),
  log: () => {},
};
const bundle = fs.readFileSync(path.join(dist, manifest.entry), 'utf8');
assert.ok(!bundle.includes('__executeUpstream'), 'Paperback converter overwrote the native bundle');
new Function('harbor', bundle)(mock);
assert.equal(provider.id, 'royalroad');
assert.equal(provider.name, manifest.name);
for (const method of ['popular','search','detail','chapters','pageUrls','content']) assert.equal(typeof provider[method], 'function');

const cards = await provider.popular(0);
assert.equal(cards.length, 1, 'duplicates and invalid cards must be ignored');
assert.equal(cards[0].id, '123/example-story');
assert.equal(cards[0].title, 'Example Story!');
assert.equal(cards[0].cover, 'https://www.royalroad.com/cover.png');
await provider.popular(48);
assert.ok(requests.at(-1)?.endsWith('page=2'));
await provider.search('a & b', 0);
assert.ok(requests.at(-1)?.includes('title=a%20%26%20b'));
assert.equal((await provider.detail('123')).title, 'Example Story!');
assert.equal((await provider.detail('123/example-story')).cover, 'https://www.royalroad.com/cover.png');
const chapters = await provider.chapters('123/example-story');
assert.deepEqual(chapters.map((c: any) => [c.title, c.chapter, c.language]), [['Arrival', '2', 'en'], ['Prologue','1','en']]);
assert.equal(await provider.content(chapters[1].id), 'First paragraph.\n\nSecond paragraph.');
await assert.rejects(provider.pageUrls(chapters[1].id), /prose, not manga page images/);
await assert.rejects(provider.search('blocked', 0), /HTTP 403/);
await assert.rejects(provider.content('https://example.com/private'), /Invalid Royal Road chapter ID/);
assert.equal(await provider.detail('https://example.com/private'), null);
console.log('Native Royal Road fixture checks passed: manifests, bundle registration, browse, pagination, search, covers, detail, chapters, prose, reader limitation and HTTP errors.');
