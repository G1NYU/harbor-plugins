/**
 * Komiku (Indonesian) - native Harbor manga provider.
 * Adapted from the Seanime Komiku provider by Pal:
 * https://github.com/Seanime-contributions/Seanime-Providers/tree/main/src/manga/komiku
 *
 * MIT License
 * Copyright (c) 2025 Pal
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Harbor-specific work: native MangaProvider methods, Harbor HTTP/DOM bridge,
 * modern /daftar-komik/ browse and URL normalization. No cookies or Referer.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://komiku.org';
const SEARCH = 'https://api.komiku.org';
const HEADERS = { Accept: 'text/html,application/xhtml+xml,*/*' };
const LANGUAGE = 'id';
let lastError = '';

function errorMessage(error: unknown): string {
  return String((error as Error)?.message || error).slice(0, 130);
}
function debugRows(message: string): MangaSummary[] {
  lastError = message;
  const rows: MangaSummary[] = [];
  for (let i = 0; i < message.length && rows.length < 8; i += 34) {
    rows.push({ id: 'error-' + i, title: message.slice(i, i + 34) });
  }
  return rows;
}
function debugChapter(id: string, message: string): MangaChapter {
  return { id: id + '#debug', chapter: null, title: message.slice(0, 110), pages: 0, language: LANGUAGE };
}
function absolute(raw: string | null | undefined, origin = BASE): string {
  if (!raw || /^(?:data|blob|javascript):/i.test(raw)) return '';
  try {
    const u = new URL(raw, origin);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch { return ''; }
}
function pathId(raw: string | null | undefined, kind: 'series' | 'chapter'): string {
  const url = absolute(raw);
  if (!url) return '';
  const u = new URL(url);
  if (!['komiku.org', 'www.komiku.org', 'api.komiku.org'].includes(u.hostname)) return '';
  const path = u.pathname.replace(/\/+$/, '/') || '/';
  if (kind === 'series') return path.startsWith('/manga/') && path !== '/manga/' ? path : '';
  return path.includes('-chapter-') ? path : '';
}
async function documentAt(url: string) {
  const response = await harbor.http(url, { responseType: 'text', headers: HEADERS, timeoutMs: 15000 });
  if (response.status !== 200 || !response.body) throw new Error('HTTP ' + response.status + ': ' + url);
  return harbor.parseHtml(response.body);
}
function imageFrom(node: { attr(name: string): string | null } | null, base = BASE): string | undefined {
  if (!node) return undefined;
  for (const key of ['data-src', 'data-lazy-src', 'src']) {
    const url = absolute(node.attr(key), base);
    if (url && !url.includes('placeholder')) return url;
  }
  return undefined;
}
function uniqueSummaries(items: MangaSummary[]): MangaSummary[] {
  const seen = new Set<string>();
  return items.filter((s) => !seen.has(s.id) && Boolean(seen.add(s.id)));
}
function parseSearch(document: Awaited<ReturnType<typeof documentAt>>): MangaSummary[] {
  const entries: MangaSummary[] = [];
  for (const card of document.querySelectorAll('div.bge')) {
    const link = card.querySelector('div.kan a') || card.querySelector('a[href*="/manga/"]');
    const id = pathId(link?.attr('href'), 'series');
    const title = (card.querySelector('div.kan h3')?.text() || card.querySelector('h3')?.text() || '').trim();
    if (!id || !title) continue;
    entries.push({ id, title, cover: imageFrom(card.querySelector('div.bgei img') || card.querySelector('img'), SEARCH) });
  }
  return uniqueSummaries(entries);
}
function parseCatalog(document: Awaited<ReturnType<typeof documentAt>>): MangaSummary[] {
  const entries: MangaSummary[] = [];
  for (const article of document.querySelectorAll('article')) {
    const link = article.querySelector('a[href*="/manga/"]');
    const id = pathId(link?.attr('href'), 'series');
    const title = (article.querySelector('h4')?.text() || article.querySelector('h3')?.text() || link?.text() || '').trim();
    if (!id || !title) continue;
    entries.push({ id, title, cover: imageFrom(article.querySelector('img')) });
  }
  return uniqueSummaries(entries);
}

const plugin: MangaProvider = {
  id: 'komiku-harbor',
  name: 'Komiku (Indonesia)',

  async popular(offset: number) {
    if (offset > 0) return [];
    try {
      const entries = parseCatalog(await documentAt(BASE + '/daftar-komik/'));
      return entries.length ? entries : debugRows('Komiku: no catalogue entries parsed');
    } catch (e) { return debugRows('Komiku browse: ' + errorMessage(e)); }
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (!q) return this.popular(0);
    try {
      const document = await documentAt(SEARCH + '/?post_type=manga&s=' + encodeURIComponent(q));
      const entries = parseSearch(document);
      return entries.length ? entries : debugRows('Komiku: no results parsed; site layout may have changed');
    } catch (e) { return debugRows('Komiku search: ' + errorMessage(e)); }
  },

  async detail(id: string) {
    if (id.startsWith('error-')) return { id, title: lastError, description: lastError };
    const path = pathId(id, 'series');
    if (!path) return null;
    try {
      const doc = await documentAt(BASE + path);
      const title = (doc.querySelector('h1')?.text() || doc.querySelector('meta[property="og:title"]')?.attr('content') || '').trim();
      if (!title) throw new Error('No series title');
      const cover = absolute(doc.querySelector('meta[property="og:image"]')?.attr('content')) || imageFrom(doc.querySelector('article img'));
      const description = doc.querySelector('meta[name="description"]')?.attr('content') || undefined;
      return { id: path, title: title.replace(/^Komik\s+/i, ''), cover: cover || undefined, description };
    } catch (e) { return { id: path, title: 'Komiku detail error', description: errorMessage(e) }; }
  },

  async chapters(id: string) {
    const path = pathId(id, 'series');
    if (!path) return [];
    try {
      const doc = await documentAt(BASE + path);
      const links = doc.querySelectorAll('td.judulseries a');
      const candidates = links.length ? links : doc.querySelectorAll('table a[href*="chapter"]');
      const seen = new Set<string>();
      const chapters: MangaChapter[] = [];
      for (const link of candidates) {
        const chapterPath = pathId(link.attr('href'), 'chapter');
        if (!chapterPath || seen.has(chapterPath)) continue;
        seen.add(chapterPath);
        const title = (link.text() || '').replace(/\s+/g, ' ').trim() || 'Chapter';
        const number = /(?:chapter|ch\.?|bab)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(title)?.[1] || null;
        chapters.push({ id: chapterPath, chapter: number, title, pages: 0, language: LANGUAGE });
      }
      if (!chapters.length) return [debugChapter(path, 'Komiku: 0 chapters parsed')];
      return chapters;
    } catch (e) { return [debugChapter(path, 'Komiku chapters: ' + errorMessage(e))]; }
  },

  async pageUrls(chapterId: string) {
    const path = pathId(chapterId, 'chapter');
    if (!path || chapterId.endsWith('#debug')) return [];
    const doc = await documentAt(BASE + path);
    const imgs = doc.querySelectorAll('img.klazy.ww');
    const pages = imgs.map((img) => imageFrom(img)).filter((url): url is string => Boolean(url));
    const unique = [...new Set(pages)];
    if (!unique.length) throw new Error('Komiku: reader yielded no page images');
    return unique;
  },
};

harbor.register(plugin);
