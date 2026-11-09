import type { EBookProvider, EBookSummary, EBookChapter } from '../../../shared/types/ebook.js';
const BASE = 'https://www.readanybook.com';
function abs(s: string): string {
  s = String(s || '').replace(/&amp;/g, '&').trim();
  return s.startsWith('//') ? 'https:' + s : s.startsWith('/') ? BASE + s : /^https?:\/\//i.test(s) ? s.replace(/^http:/i, 'https:') : '';
}
function path(s: string): string {
  return /^https:\/\/(?:www\.)?readanybook\.com(\/ebook\/[a-z0-9-]+-\d+)\/?(?:[?#].*)?$/i.exec(abs(s))?.[1] || '';
}
function attr(tag: string, key: string): string {
  return new RegExp('\\b' + key + '\\s*=\\s*["\x27]([^"\x27]*)["\x27]', 'i').exec(tag)?.[1].replace(/&amp;/g, '&') || '';
}
function value(xml: string, key: string): string {
  return (new RegExp('<dc:' + key + '\\b[^>]*>([\\s\\S]*?)<\\/dc:' + key + '>', 'i').exec(xml)?.[1] || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
}
function tokens(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(t => t.length > 2 && !['the','and','book','one','two','three','epub','online'].includes(t));
}
function matches(title: string, other: string): boolean {
  const wanted = Array.from(new Set(tokens(title)));
  const actual = new Set(tokens(other));
  return wanted.length > 0 && wanted.filter(t => actual.has(t)).length / wanted.length >= 0.75;
}
function resource(base: string, relative: string): string {
  const clean = relative.split('#')[0].replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || clean.includes('..') || !/^[a-z0-9_./%-]+$/i.test(clean)) throw new Error('Unsupported EPUB path');
  return base + clean;
}
async function get(url: string): Promise<string> {
  const r = await harbor.http(url, { responseType: 'text', timeoutMs: 15000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  return String(r.body || '');
}
const summaries = new Map<string, EBookSummary>();
let report = '';
async function browse(q: string, offset: number): Promise<EBookSummary[]> {
  if (offset > 0) return [];
  try {
    const doc = await harbor.parseHtml(await get(BASE + (q ? '/search?q=' + encodeURIComponent(q) : '/')));
    const out = new Map<string, EBookSummary>();
    for (const card of doc.querySelectorAll('.book-preview')) {
      const a = card.querySelector('.preview-name a');
      const id = path(a?.attr('href') || '');
      const title = a?.text().trim();
      if (!id || !title) continue;
      const img = card.querySelector('img');
      const book = { id, title, author: card.querySelector('.preview-author .list')?.text().trim(), cover: abs(img?.attr('data-src') || img?.attr('src') || '') || undefined, siteUrl: BASE + id };
      out.set(id, book); summaries.set(id, book);
    }
    if (!out.size) throw new Error('No book cards found');
    return Array.from(out.values());
  } catch (e) {
    report = String(e);
    return [{ id: 'catalogue-diagnostic', title: 'ReadAnyBook Beta Diagnostic', description: report }];
  }
}
type Loaded = { summary: EBookSummary; sections: EBookChapter[] };
const loaded = new Map<string, Promise<Loaded>>();
async function load(id: string): Promise<Loaded> {
  if (path(BASE + id) !== id) throw new Error('Invalid book');
  let pending = loaded.get(id);
  if (!pending) {
    pending = discover(id).catch(e => { loaded.delete(id); throw e; });
    if (loaded.size >= 20) loaded.clear();
    loaded.set(id, pending);
  }
  return pending;
}
async function discover(id: string): Promise<Loaded> {
  const doc = await harbor.parseHtml(await get(BASE + id));
  const title = doc.querySelector('.book-name h1')?.text().trim() || doc.querySelector('h1')?.text().trim() || summaries.get(id)?.title || '';
  const author = doc.querySelector('.book-details .authors-list')?.text().trim() || summaries.get(id)?.author || '';
  if (!title) throw new Error('Missing selected book title');
  const candidates: string[] = [];
  for (const row of doc.querySelectorAll('.book-mini-reader .reader-files .links-row[data-link]')) {
    const label = row.querySelector('.links-name')?.text() || '';
    const root = abs(row.attr('data-link') || '');
    if (!matches(title, label) || !/^https:\/\/files\.readanybook\.com\/\d+\/epub\/[^?#]+\.epub\/?$/i.test(root)) continue;
    const base = root.replace(/\/?$/, '/');
    if (!candidates.includes(base)) candidates.push(base);
  }
  if (!candidates.length) throw new Error('No matching reader file; refusing unrelated EPUBs');
  let reason = 'No EPUB passed identity checks';
  for (const root of candidates.slice(0, 4)) {
    try {
      const container = await get(root + 'META-INF/container.xml');
      const rootfile = container.match(/<rootfile\b[^>]*>/i)?.[0] || '';
      const opfUrl = resource(root, attr(rootfile, 'full-path'));
      const xml = await get(opfUrl);
      const epubTitle = value(xml, 'title');
      const epubAuthor = value(xml, 'creator');
      if (!matches(title, epubTitle)) { reason = 'EPUB title does not match selected book'; continue; }
      if (author && epubAuthor && !tokens(author).some(t => tokens(epubAuthor).includes(t))) { reason = 'EPUB author does not match selected book'; continue; }
      const base = opfUrl.slice(0, opfUrl.lastIndexOf('/') + 1);
      const manifest = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(xml)?.[1] || '';
      const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml)?.[1] || '';
      const items = new Map<string, { href: string; type: string }>();
      for (const tag of manifest.match(/<item\b[^>]*>/gi) || []) items.set(attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type') });
      const sections: EBookChapter[] = [];
      for (const tag of spine.match(/<itemref\b[^>]*>/gi) || []) {
        const item = items.get(attr(tag, 'idref'));
        if (!item || item.type !== 'application/xhtml+xml') continue;
        const url = resource(base, item.href);
        sections.push({ id: id + '|' + url, title: 'Section ' + (sections.length + 1), position: sections.length });
      }
      if (!sections.length) throw new Error('No spine sections');
      const cover = abs(doc.querySelector('.book-cover a.gallery-item')?.attr('href') || summaries.get(id)?.cover || '');
      const description = doc.querySelector('.book-description .visible-text')?.text().trim();
      return { sections, summary: { id, title, author: author || epubAuthor || undefined, cover: cover || undefined, siteUrl: BASE + id, description: description || 'EPUB title verified. Sections follow the original reading order.' } };
    } catch (e) { reason = String(e); }
  }
  throw new Error(reason);
}
export const plugin: EBookProvider = {
  id: 'readanybook-beta1', name: 'ReadAnyBook Beta v1',
  async popular(offset: number) { return browse('', offset); },
  async search(q: string, offset: number) { return browse(String(q || '').trim(), offset); },
  async detail(id: string) {
    if (id === 'catalogue-diagnostic') return { id, title: 'ReadAnyBook Beta Diagnostic', description: report };
    try { return (await load(id)).summary; }
    catch (e) { return { id, title: summaries.get(id)?.title || 'ReadAnyBook file selection failed', description: 'Cannot select a matching EPUB: ' + String(e), siteUrl: BASE + id }; }
  },
  async chapters(id: string) { return id === 'catalogue-diagnostic' ? [] : (await load(id)).sections; },
  async content(id: string) {
    const split = id.indexOf('|');
    if (split < 0) throw new Error('Invalid section');
    const book = await load(id.slice(0, split));
    if (!book.sections.some(section => section.id === id)) throw new Error('Unknown section');
    const html = await get(id.slice(split + 1));
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
    if (body === undefined) throw new Error('No section body');
    const doc = await harbor.parseHtml('<html><body>' + body + '</body></html>');
    const text = doc.querySelectorAll('body h1, body h2, body h3, body h4, body h5, body h6, body p, body pre').map(block => block.text().trim()).filter(Boolean).join('\n\n');
    if (!text) throw new Error('No readable text in this section');
    return text;
  },
};
harbor.register(plugin);
