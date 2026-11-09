import type { EBookChapter, EBookProvider, EBookSummary } from '../../../shared/types/ebook.js';
import { createUrlResolver } from '../../../shared/utils/url.js';
import { cleanTitle } from '../../../shared/utils/text.js';
import { extractProse } from '../../../shared/utils/prose.js';

const BASE = 'https://standardebooks.org';
const resolveUrl = createUrlResolver(BASE);
const PAGE_SIZE = 48;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
let currentBookUrl = '';
function bookUrl(id: string) { return `${BASE}/ebooks/${id}/`; }
async function getDoc(path: string) {
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await harbor.http(url, { responseType: 'text', headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return harbor.parseHtml(res.body);
}
function parseBookLink(el: any): EBookSummary | null {
  const href = String(el.attr('href') || '').replace(/^https:\/\/standardebooks\.org/i, '');
  const match = /^\/ebooks\/([^?#]+?)\/?$/.exec(href);
  if (!match) return null;
  const id = match[1].replace(/\/+$/, '');
  const parts = id.split('/');
  if (parts.length < 2 || parts.some(p => !p || !/^[a-z0-9-]+$/.test(p))) return null;
  if (parts.some(p => ['text', 'downloads', 'images'].includes(p))) return null;
  const img = el.querySelector('img');
  const heading = el.querySelector('h2') || el.querySelector('h3');
  const title = cleanTitle(heading?.text() || img?.attr('alt') || el.text() || parts[1].replace(/-/g, ' '));
  return { id, title, cover: resolveUrl(img?.attr('data-src') || img?.attr('src')) || `${BASE}/ebooks/${id}/downloads/cover.jpg`, siteUrl: bookUrl(id) };
}
const catalogueCache = new Map<string, { books: EBookSummary[]; next: boolean }>();
async function cataloguePage(query: string, page: number) {
  const key = JSON.stringify([query, page]);
  const cached = catalogueCache.get(key);
  if (cached) return cached;
  const doc = await getDoc(`/ebooks?page=${page}&per-page=${PAGE_SIZE}&view=grid${query ? '&query=' + encodeURIComponent(query) : ''}`);
  const links = doc.querySelectorAll('main a[href*="/ebooks/"]') as any[];
  const found = new Map<string, EBookSummary>();
  for (const link of links) {
    const book = parseBookLink(link);
    if (!book) continue;
    const previous = found.get(book.id);
    if (!previous || link.querySelector('img')) found.set(book.id, book);
  }
  const result = { books: Array.from(found.values()), next: !!doc.querySelector('nav.pagination a[rel="next"][href]') };
  if (catalogueCache.size >= 30) catalogueCache.clear();
  catalogueCache.set(key, result);
  return result;
}
async function catalogue(query: string, offset: number): Promise<EBookSummary[]> {
  let skip = Math.max(0, Math.floor(Number(offset) || 0));
  const out: EBookSummary[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 200; page++) {
    const result = await cataloguePage(query, page);
    if (skip >= result.books.length) skip -= result.books.length;
    else {
      for (const book of result.books.slice(skip)) if (!seen.has(book.id) && out.length < PAGE_SIZE) { seen.add(book.id); out.push(book); }
      skip = 0;
    }
    if (out.length >= PAGE_SIZE || !result.next || !result.books.length) break;
  }
  return out;
}
export const plugin: EBookProvider = {
  id: 'standardebooks',
  name: 'Standard Ebooks',
  async popular(offset: number): Promise<EBookSummary[]> { return catalogue('', offset); },
  async search(query: string, offset: number): Promise<EBookSummary[]> { return catalogue(String(query || '').trim(), offset); },
  async detail(id: string): Promise<EBookSummary | null> {
    const url = bookUrl(id);
    const doc = await getDoc(url);
    currentBookUrl = url;
    const title = doc.querySelector('h1')?.text()?.trim();
    const cover = doc.querySelector('meta[property="og:image"]')?.attr('content');
    const description = doc.querySelector('meta[property="og:description"]')?.attr('content');
    return { id, title: cleanTitle(title || id), cover: resolveUrl(cover), description: description?.trim() || undefined, siteUrl: url };
  },
  async chapters(id: string): Promise<EBookChapter[]> {
    try {
      currentBookUrl = bookUrl(id);
      const textUrl = `${currentBookUrl}text/`;
      const doc = await getDoc(textUrl);
      const allLinks = doc.querySelectorAll('a') as any[];
      const chapters: EBookChapter[] = [];
      const seen = new Set<string>();
      for (const a of allLinks) {
        const href = a.attr('href') || '';
        if (!href.startsWith('text/') || href === 'text/') continue;
        const chapterId = href.slice(5).replace(/\/$/, '');
        if (!chapterId || seen.has(chapterId)) continue;
        const title = a.text().trim();
        if (!title) continue;
        seen.add(chapterId);
        chapters.push({ id: chapterId, title, chapter: chapterId, position: chapters.length });
      }
      if (chapters.length === 0) return [{ id: 'debug-chapters', title: `CHAPTERS 0 | LINKS ${allLinks.length} | ${textUrl}` }];
      return chapters;
    } catch (e: any) { return [{ id: 'debug-chapters-err', title: `CHAPTERS ERR | ${e?.message || e}` }]; }
  },
  async content(chapterId: string): Promise<string> {
    const chapterUrl = `${currentBookUrl}text/${chapterId}/`;
    const doc = await getDoc(chapterUrl);
    return extractProse(doc, 'body', 'p');
  },
  async tags() { return [{ id: 'popular', name: 'Popular', group: 'Browse' }]; },
};
harbor.register(plugin);
