import type { EBookProvider, EBookSummary } from '../../../shared/types/ebook.js';
import { createReader, type Item, type Reader } from './chapter-reader.js';
const BASE = 'https://www.readanybook.com';
const DIAG = 'readanybook-fresh-ranges-diagnostic|';
function abs(s: string): string { s = String(s || '').replace(/&amp;/g, '&').trim(); return s.startsWith('//') ? 'https:' + s : s.startsWith('/') ? BASE + s : /^https?:\/\//i.test(s) ? s.replace(/^http:/i, 'https:') : ''; }
function path(s: string): string { return /^https:\/\/(?:www\.)?readanybook\.com(\/ebook\/[a-z0-9-]+-\d+)\/?(?:[?#].*)?$/i.exec(abs(s))?.[1] || ''; }
function attr(tag: string, key: string): string { return new RegExp('(?:^|\\s)' + key + '\\s*=\\s*["\x27]([^"\x27]*)["\x27]', 'i').exec(tag)?.[1].replace(/&amp;/g, '&') || ''; }
function value(xml: string, key: string): string { return (new RegExp('<dc:' + key + '\\b[^>]*>([\\s\\S]*?)<\\/dc:' + key + '>', 'i').exec(xml)?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').trim(); }
function tokens(s: string): string[] { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(t => t.length > 1 && !['the','and','of','book','one','two','three','epub','online'].includes(t)); }
function matches(title: string, other: string): boolean { const wanted = Array.from(new Set(tokens(title))); const actual = new Set(tokens(other)); return wanted.length > 0 && wanted.filter(t => actual.has(t)).length / wanted.length >= 0.75; }
function containsAll(expected: string, label: string): boolean { const wanted = tokens(expected); const actual = new Set(tokens(label)); return wanted.length > 0 && wanted.every(t => actual.has(t)); }
function resource(base: string, relative: string): string {
  const root = /^https:\/\/files\.readanybook\.com\/\d+\/epub\/[^/?#]+\//i.exec(base)?.[0];
  if (!root || !base.startsWith(root)) throw new Error('Invalid reader package base');
  const rel = relative.split('#')[0];
  if (!rel || /^[a-z][a-z0-9+.-]*:|^[\/\\]|[?\\]/i.test(rel)) throw new Error('Unsupported resource reference: ' + relative);
  const parts = base.slice(root.length).split('/').filter(Boolean);
  for (const piece of rel.split('/')) {
    const decoded = decodeURIComponent(piece);
    if (!decoded || decoded === '.') continue;
    if (decoded === '..') { if (!parts.length) throw new Error('Path escapes reader package'); parts.pop(); }
    else { if (/[\/\\\u0000-\u001f]/.test(decoded)) throw new Error('Invalid resource path'); parts.push(encodeURIComponent(decoded)); }
  }
  return root + parts.join('/');
}
async function get(url: string, timeoutMs = 15000): Promise<string> { const r = await harbor.http(url, { responseType: 'text', timeoutMs }); if (r.status !== 200) throw new Error('HTTP ' + r.status + ' at ' + url); return String(r.body || ''); }
const summaries = new Map<string, EBookSummary>();
let report = '';
async function browse(q: string, offset: number): Promise<EBookSummary[]> {
  if (offset > 0) return [];
  try {
    const doc = await harbor.parseHtml(await get(BASE + (q ? '/search?q=' + encodeURIComponent(q) : '/')));
    const out = new Map<string, EBookSummary>();
    const container = q ? '.search-books:not(.ext-net)' : '.main-list';
    if (!doc.querySelector(container)) throw new Error('Expected catalogue container not found: ' + container);
    for (const card of doc.querySelectorAll(container + ' .book-preview')) {
      const a = card.querySelector('.preview-name a'); const id = path(a?.attr('href') || ''); const title = a?.text().trim();
      if (!id || !title) continue;
      const img = card.querySelector('img');
      const book = { id, title, author: card.querySelector('.preview-author .list')?.text().trim(), cover: abs(img?.attr('data-src') || img?.attr('src') || '') || undefined, siteUrl: BASE + id };
      out.set(id, book); summaries.set(id, book);
    }
    if (!q && !out.size) throw new Error('No book cards found in main catalogue');
    return Array.from(out.values());
  } catch (e) { report = String(e); return [{ id: 'fresh-catalogue-diagnostic', title: 'ReadAnyBook Fresh Diagnostic', description: report }]; }
}
type Loaded = { summary: EBookSummary; reader: Reader };
const loaded = new Map<string, Promise<Loaded>>();
const failures = new Map<string, string>();
async function load(id: string): Promise<Loaded> {
  if (path(BASE + id) !== id) throw new Error('Invalid book');
  let pending = loaded.get(id);
  if (!pending) { pending = discover(id).then(result => { failures.delete(id); return result; }).catch(e => { loaded.delete(id); failures.set(id, String(e)); throw e; }); if (loaded.size >= 3) loaded.clear(); loaded.set(id, pending); }
  return pending;
}
async function discover(id: string): Promise<Loaded> {
  const doc = await harbor.parseHtml(await get(BASE + id));
  const title = doc.querySelector('.book-name h1')?.text().trim() || doc.querySelector('h1')?.text().trim() || summaries.get(id)?.title || '';
  const author = doc.querySelector('.book-details .authors-list')?.text().trim() || summaries.get(id)?.author || '';
  if (!title) throw new Error('Book page: missing selected title');
  const candidates: string[] = [];
  const labels = new Map<string, string[]>();
  const rows = doc.querySelectorAll('.book-mini-reader .reader-files .links-row[data-link]');
  for (const row of rows) {
    const label = row.querySelector('.links-name')?.text() || ''; const root = abs(row.attr('data-link') || '');
    if (!matches(title, label) || !/^https:\/\/files\.readanybook\.com\/\d+\/epub\/[^/?#]+\/?$/i.test(root)) continue;
    const base = root.replace(/\/?$/, '/'); if (!candidates.includes(base)) candidates.push(base);
    labels.set(base, [...(labels.get(base) || []), label]);
  }
  if (!candidates.length) throw new Error('Selection: no matching package among ' + rows.length + ' reader files for ' + title);
  const reasons: string[] = [];
  for (const root of candidates.slice(0, 4)) {
    let stage = 'container';
    try {
      const container = await get(root + 'META-INF/container.xml');
      const rootfile = container.match(/<rootfile\b[^>]*>/i)?.[0] || '';
      const opfUrl = resource(root, attr(rootfile, 'full-path'));
      stage = 'package metadata'; const xml = await get(opfUrl);
      const epubTitle = value(xml, 'title'); const rawAuthor = value(xml, 'creator');
      const epubAuthor = /^unknown$/i.test(rawAuthor.trim()) ? '' : rawAuthor;
      stage = 'identity';
      const opaqueTitle = /^[a-f0-9]{32}(?:[a-f0-9]{8}|[a-f0-9]{32})?$/i.test(epubTitle);
      const labelVerified = (labels.get(root) || []).some(label => containsAll(title, label) && containsAll(author, label));
      const shortTitle = tokens(title).length === 1 && tokens(title)[0].length <= 2;
      const titleVerified = !opaqueTitle && matches(title, epubTitle) && (shortTitle || containsAll(title, epubTitle));
      if (!titleVerified && !(opaqueTitle && labelVerified)) throw new Error('Title mismatch: expected ' + title + '; found ' + (epubTitle || '[missing]') + '; package author=' + (rawAuthor || '[missing]') + '; strict file-label match=' + labelVerified);
      if (shortTitle && (!author || !epubAuthor)) throw new Error('Short title requires author metadata');
      if (author && epubAuthor && !tokens(author).some(t => tokens(epubAuthor).includes(t))) throw new Error('Author mismatch: expected ' + author + '; found ' + epubAuthor);
      stage = 'spine';
      const base = opfUrl.slice(0, opfUrl.lastIndexOf('/') + 1);
      const manifest = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(xml)?.[1] || '';
      const spineMatch = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml);
      const items = new Map<string, Item>();
      for (const tag of manifest.match(/<item\b[^>]*>/gi) || []) items.set(attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type'), properties: attr(tag, 'properties') });
      const urls: string[] = [];
      for (const tag of (spineMatch?.[1] || '').match(/<itemref\b[^>]*>/gi) || []) { const item = items.get(attr(tag, 'idref')); if (item && ['application/xhtml+xml','text/html'].includes(item.type)) urls.push(resource(base, item.href)); }
      if (!urls.length) throw new Error('No readable spine sections');
      stage = 'chapter ranges';
      let reader: Reader;
      try { reader = await createReader(id, urls, base, xml, items, spineMatch?.[0] || '', get, resource, attr); }
      catch (e) {
        reader = { mode: 'Source sections: optional range reader failed: ' + String(e), chapters: urls.map((url, i) => ({ id: id + '|ranges-v1|' + i, title: 'Source section ' + (i + 1), position: i })), async read(route: string) {
          const index = reader.chapters.findIndex(c => c.id === route); const legacy = urls.find(url => id + '|' + url === route); const url = index >= 0 ? urls[index] : legacy;
          if (!url) throw new Error('Unknown chapter route');
          const source = await get(url); const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)?.[1]; if (body === undefined) throw new Error('Missing source body');
          const parsed = await harbor.parseHtml('<html><body>' + body + '</body></html>'); const text = parsed.querySelector('body')?.text().trim(); if (!text) throw new Error('No readable text'); return text;
        } };
      }
      const cover = abs(doc.querySelector('.book-cover a.gallery-item')?.attr('href') || summaries.get(id)?.cover || '');
      return { reader, summary: { id, title, author: author || epubAuthor || undefined, cover: cover || undefined, siteUrl: BASE + id, description: [doc.querySelector('.book-description .visible-text')?.text().trim(), 'Chapter Ranges: ' + reader.mode + '. All source text ranges are retained; separate editions remain separate.'].filter(Boolean).join('\n\n') } };
    } catch (e) { reasons.push(stage + ': ' + String(e) + '\nPackage: ' + root); }
  }
  throw new Error(reasons.join('\n\n'));
}
export const plugin: EBookProvider = {
  id: 'readanybook-fresh', name: 'ReadAnyBook Fresh',
  async popular(offset: number) { return browse('', offset); },
  async search(q: string, offset: number) { return browse(String(q || '').trim(), offset); },
  async detail(id: string) { if (id === 'fresh-catalogue-diagnostic') return { id, title: 'ReadAnyBook Fresh Diagnostic', description: report }; try { return (await load(id)).summary; } catch (e) { return { id, title: summaries.get(id)?.title || 'ReadAnyBook Fresh reader diagnostic', description: 'Reader failed: ' + String(e), siteUrl: BASE + id }; } },
  async chapters(id: string) { if (id === 'fresh-catalogue-diagnostic') return []; try { return (await load(id)).reader.chapters; } catch { return [{ id: DIAG + id, title: 'ReadAnyBook Fresh — Chapter Ranges diagnostic (not a book chapter)', position: 0 }]; } },
  async content(id: string) {
    if (id.startsWith(DIAG)) { const bookId = id.slice(DIAG.length); if (path(BASE + bookId) !== bookId) throw new Error('Invalid diagnostic'); return 'ReadAnyBook Fresh — Chapter Ranges\n\nSource ID: readanybook-fresh\nThis is an error report, not book content.\n\n' + (failures.get(bookId) || 'Error expired; reopen the book to retry.'); }
    const split = id.indexOf('|'); if (split < 0) throw new Error('Invalid chapter'); return (await load(id.slice(0, split))).reader.read(id);
  },
};
harbor.register(plugin);
