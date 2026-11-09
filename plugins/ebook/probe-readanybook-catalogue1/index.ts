import type { EBookProvider, EBookSummary } from '../../../shared/types/ebook.js';
const BASE = 'https://www.readanybook.com';
const DIAG = 'readanybook-catalogue-diagnostic';
let lastReport = '';
function abs(raw: string): string {
  const s = String(raw || '').replace(/&amp;/g, '&').trim();
  return s.startsWith('//') ? 'https:' + s : s.startsWith('/') ? BASE + s : /^https?:\/\//i.test(s) ? s : '';
}
function bookPath(raw: string): string {
  const m = /^https?:\/\/(?:www\.)?readanybook\.com(\/ebook\/[a-z0-9-]+-\d+)\/?(?:[?#].*)?$/i.exec(abs(raw));
  return m ? m[1] : '';
}
async function get(url: string) {
  const r = await harbor.http(url, { responseType: 'text', timeoutMs: 15000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' for ' + url);
  return String(r.body || '');
}
function diagnostic(parts: string[]): EBookSummary[] {
  lastReport = parts.join('\n');
  return [{ id: DIAG, title: 'ReadAnyBook Catalogue Diagnostic', description: lastReport }];
}
const books = new Map<string, EBookSummary>();
async function browse(query: string, offset: number): Promise<EBookSummary[]> {
  if (offset > 0) return [];
  const url = query ? BASE + '/search?q=' + encodeURIComponent(query) : BASE + '/';
  try {
    const html = await get(url);
    const doc = await harbor.parseHtml(html);
    const out = new Map<string, EBookSummary>();
    const cards = doc.querySelectorAll('.book-preview');
    for (const card of cards) {
      const a = card.querySelector('.preview-name a');
      if (!a) continue;
      const id = bookPath(a.attr('href') || '');
      const title = a.text().trim();
      if (!id || !title) continue;
      const img = card.querySelector('img');
      const cover = abs(img?.attr('data-src') || img?.attr('src') || '');
      const author = card.querySelector('.preview-author .list')?.text().trim();
      out.set(id, { id, title, cover: cover || undefined, author: author || undefined, siteUrl: BASE + id });
    }
    const links = doc.querySelectorAll('a[href*="/ebook/"]');
    for (const a of links) {
      const id = bookPath(a.attr('href') || '');
      if (!id || out.has(id)) continue;
      const img = a.querySelector('img');
      const title = (a.text() || a.attr('title') || img?.attr('alt') || '').trim().replace(/\s+online$/i, '');
      if (!title) continue;
      const cover = abs(img?.attr('data-src') || img?.attr('src') || '');
      out.set(id, { id, title, cover: cover || undefined, siteUrl: BASE + id });
    }
    if (!out.size) return diagnostic(['URL ' + url, 'HTTP 200', 'HTML chars ' + html.length, 'Book cards ' + cards.length, 'Book links ' + links.length, 'PAGE TITLE ' + (doc.querySelector('title')?.text() || '(none)'), 'No book cards parsed']);
    for (const [id, book] of out) books.set(id, book);
    return Array.from(out.values());
  } catch (e) { return diagnostic(['URL ' + url, 'ERROR ' + String(e)]); }
}
export const plugin: EBookProvider = {
  id: 'probe-readanybook-catalogue1', name: 'ReadAnyBook Catalogue Test v2',
  async popular(offset: number) { return browse('', offset); },
  async search(query: string, offset: number) { return browse(String(query || '').trim(), offset); },
  async detail(id: string) {
    if (id === DIAG) return { id, title: 'ReadAnyBook Catalogue Diagnostic', description: lastReport };
    if (bookPath(BASE + id) !== id) return null;
    const html = await get(BASE + id);
    const doc = await harbor.parseHtml(html);
    const title = doc.querySelector('h1')?.text().trim() || doc.querySelector('.book-name')?.text().trim() || books.get(id)?.title || id;
    const cover = abs(doc.querySelector('a.gallery-item')?.attr('href') || doc.querySelector('meta[property="og:image"]')?.attr('content') || books.get(id)?.cover || '');
    const parts = ['BOOK PAGE HTTP 200'];
    const roots = new Set<string>();
    for (const el of doc.querySelectorAll('[data-link]')) {
      const raw = abs(el.attr('data-link') || '');
      if (/^https?:\/\/files\.readanybook\.com\/[^?#]+\.epub\/?$/i.test(raw)) roots.add(raw.replace(/^http:/i, 'https:').replace(/\/?$/, '/'));
    }
    parts.push('Reader roots found ' + roots.size);
    let checked = 0;
    for (const root of roots) {
      if (checked++ >= 2) break;
      parts.push('ROOT ' + root);
      try {
        const container = await get(root + 'META-INF/container.xml');
        const path = /\bfull-path\s*=\s*["\x27]([^"\x27]+)["\x27]/i.exec(container)?.[1] || '';
        parts.push('CONTAINER HTTP 200', 'OPF path ' + path);
        if (!path || path.startsWith('/') || path.includes('..') || !/^[a-z0-9_./-]+$/i.test(path)) { parts.push('Unsupported OPF path'); continue; }
        const xml = await get(root + path);
        const spine = (/<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml) || [])[1] || '';
        parts.push('OPF HTTP 200', 'SPINE sections ' + (spine.match(/<itemref\b/gi) || []).length);
      } catch (e) { parts.push('DISCOVERY ERROR ' + String(e)); }
    }
    if (!roots.size) parts.push('Need current reader markup; no root guessed.');
    return { id, title, cover: cover || undefined, siteUrl: BASE + id, description: parts.join('\n') };
  },
  async chapters(_id: string) { return []; },
  async content(_id: string) { return 'Catalogue and discovery test only. Use the separate Reader Test for reading.'; },
};
harbor.register(plugin);
