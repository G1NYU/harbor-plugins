/**
 * DreamScan FR diagnostic source for Harbor.
 * Deliberately does not claim to be a complete manga reader.
 * Test keys: home, catalog, read, image, series, search.
 */
import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://dreamscan.cc';
const READ_PATH = '/read/black-clover-chapitre-389';
const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*',
};
let lastMessage = '';

type Page = { status: number; body: string; headers: Record<string, string> };
const error = (e: unknown) => String((e as Error)?.message || e).slice(0, 140);

function rows(parts: string[]): MangaSummary[] {
  const out: MangaSummary[] = [];
  lastMessage = parts.join(' | ');
  for (const part of parts) {
    for (let i = 0; i < part.length && out.length < 23; i += 34) {
      out.push({ id: 'diag-' + out.length, title: part.slice(i, i + 34) });
    }
  }
  return out;
}

async function get(path: string): Promise<Page> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Unexpected path');
  const r = await harbor.http(BASE + path, { responseType: 'text', headers: HEADERS, timeoutMs: 8000 });
  return { status: Number(r?.status ?? 0), body: String(r?.body ?? ''), headers: r?.headers || {} };
}

function decode(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function urlOf(s: string): string {
  const v = decode(s.trim());
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return 'https:' + v;
  if (v.startsWith('/')) return BASE + v;
  return '';
}
function host(u: string): string { return /^https?:\/\/([^/]+)/i.exec(u)?.[1] || '(none)'; }
function pathForInternal(u: string): string {
  const abs = urlOf(u);
  if (!abs.startsWith(BASE + '/')) return '';
  return abs.slice(BASE.length).split('#')[0];
}
function attrs(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) result[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  return result;
}

function pageImages(source: string): string[] {
  const all = source.match(/<img\b[^>]*>/gi) || [];
  const candidates: { src: string; score: number }[] = [];
  for (const tag of all) {
    const a = attrs(tag);
    const src = urlOf(a['data-src'] || a['data-lazy-src'] || a['data-original'] || a.src || '');
    if (!src || src.startsWith('data:')) continue;
    const description = (a.alt || '') + ' ' + (a.class || '');
    const score = /page\s*\d+|planche\s*\d+|reader|chapter|scan-page/i.test(description) ? 5 : 0;
    if (score > 0 || /\/read\//i.test(src) || /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(src)) candidates.push({ src, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const unique: string[] = [];
  for (const item of candidates) if (!unique.includes(item.src)) unique.push(item.src);
  return unique;
}

function pageStats(page: Page, label: string): string[] {
  const links = page.body.match(/<a\b[^>]*\bhref\s*=\s*["'][^"']+["']/gi) || [];
  return [label + ' HTTP ' + page.status, 'HTML bytes ' + page.body.length, 'anchor links ' + links.length, 'IMG tags ' + (page.body.match(/<img\b/gi) || []).length, 'Next.js ' + (/__NEXT_DATA__|self\.__next_f|_next\/static/i.test(page.body) ? 'yes' : 'no')];
}

function discover(source: string, filter: RegExp, limit = 3): string[] {
  const found: string[] = [];
  const tags = source.match(/<a\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const href = attrs(tag).href;
    if (!href) continue;
    const path = pathForInternal(href);
    if (!path || !filter.test(path) || found.includes(path)) continue;
    found.push(path);
    if (found.length >= limit) break;
  }
  return found;
}

async function checkIndex(path: string, name: string): Promise<MangaSummary[]> {
  const p = await get(path);
  const links = discover(p.body, /\/(?:manga|series|title|read|catalog|webtoon|comic)[\/?-]/i, 6);
  const parts = pageStats(p, name);
  parts.push('discovered links ' + links.length);
  for (const link of links.slice(0, 4)) parts.push('link ' + link.slice(0, 90));
  if (name === 'HOME') {
    const bc = discover(p.body, /black-clover/i, 2);
    parts.push('Black Clover links ' + bc.length);
    for (const link of bc) parts.push('BC ' + link.slice(0, 95));
  }
  return rows(parts);
}

async function checkReader(checkImage: boolean): Promise<MangaSummary[]> {
  const p = await get(READ_PATH);
  const parts = pageStats(p, 'READ');
  parts.push('Page 1 label ' + (/alt\s*=\s*["']Page\s*1["']/i.test(p.body) ? 'yes' : 'no'));
  parts.push('reader images ' + pageImages(p.body).length);
  if (p.status !== 200) return rows(parts);
  const images = pageImages(p.body);
  if (!images.length) return rows([...parts, 'No HTML image URLs parsed']);
  parts.push('image host ' + host(images[0]));
  parts.push('image URL ' + images[0].slice(0, 115));
  if (checkImage) {
    try {
      // Deliberately omit Cookie and Referer; this is Harbor's real limitation.
      const r = await harbor.http(images[0], { responseType: 'base64', timeoutMs: 8000, headers: { Accept: 'image/*,*/*' } });
      parts.push('IMAGE HTTP ' + Number(r?.status ?? 0));
      const headers = r?.headers || {};
      const contentType = headers['content-type'] || headers['Content-Type'] || '(unknown)';
      parts.push('type ' + contentType);
      parts.push('image body chars ' + String(r?.body ?? '').length);
    } catch (e) { parts.push('IMAGE ERR ' + error(e)); }
  }
  return rows(parts);
}

async function checkSeries(): Promise<MangaSummary[]> {
  const home = await get('/');
  let paths = discover(home.body, /black-clover/i, 12).filter(v => !v.startsWith('/read/'));
  if (!paths.length) {
    const c = await get('/catalog');
    paths = discover(c.body, /black-clover/i, 12).filter(v => !v.startsWith('/read/'));
  }
  if (!paths.length) return rows(['No series route discovered', 'Home HTTP ' + home.status, 'Do not guess series URL']);
  const path = paths[0];
  const p = await get(path);
  const chapterLinks = discover(p.body, /\/read\//i, 5);
  const parts = pageStats(p, 'SERIES');
  parts.push('path ' + path.slice(0, 110));
  parts.push('chapter links ' + chapterLinks.length);
  for (const link of chapterLinks.slice(0, 3)) parts.push('chapter ' + link.slice(0, 95));
  return rows(parts);
}

async function checkSearchForm(): Promise<MangaSummary[]> {
  const p = await get('/');
  const forms = p.body.match(/<form\b[^>]*>/gi) || [];
  const inputs = (p.body.match(/<input\b[^>]*>/gi) || []).map(attrs);
  const parts = pageStats(p, 'SEARCH');
  parts.push('form tags ' + forms.length);
  for (const form of forms.slice(0, 3)) parts.push('form action ' + (attrs(form).action || '(none)').slice(0, 60));
  for (const input of inputs.filter(a => /search|query|^q$|title/i.test([a.name, a.placeholder, a.type].join(' '))).slice(0, 3)) parts.push('search input ' + String(input.name || input.placeholder || '(unnamed)').slice(0, 70));
  return rows(parts);
}

const plugin: MangaProvider = {
  id: 'probe-dreamscan1',
  name: 'Probe DreamScan FR v1',
  async popular(offset: number) {
    if (offset > 0) return [];
    try { return await checkIndex('/', 'HOME'); }
    catch (e) { return rows(['HOME ERR ' + error(e)]); }
  },
  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim().toLowerCase();
    try {
      if (!q || q === 'home') return await checkIndex('/', 'HOME');
      if (q === 'catalog') return await checkIndex('/catalog', 'CATALOG');
      if (q === 'read') return await checkReader(false);
      if (q === 'image') return await checkReader(true);
      if (q === 'series') return await checkSeries();
      if (q === 'search') return await checkSearchForm();
      return rows(['Unknown diagnostic', 'Use: catalog, read, image, series, search']);
    } catch (e) { return rows(['ERR ' + q + ': ' + error(e)]); }
  },
  async detail(id: string) { return { id, title: (lastMessage || 'DreamScan diagnostic').slice(0, 110), description: lastMessage }; },
  async chapters(_id: string) { return []; },
  async pageUrls(_id: string) { return []; },
};

harbor.register(plugin);
