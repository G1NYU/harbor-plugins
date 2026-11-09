import type { EBookProvider, EBookSummary, EBookChapter } from '../../../shared/types/ebook.js';
const BASE = 'https://www.readanybook.com';
function abs(s: string): string { s = String(s || '').replace(/&amp;/g, '&').trim(); return s.startsWith('//') ? 'https:' + s : s.startsWith('/') ? BASE + s : /^https?:\/\//i.test(s) ? s.replace(/^http:/i, 'https:') : ''; }
function path(s: string): string { return /^https:\/\/(?:www\.)?readanybook\.com(\/ebook\/[a-z0-9-]+-\d+)\/?(?:[?#].*)?$/i.exec(abs(s))?.[1] || ''; }
function attr(tag: string, key: string): string { return new RegExp('\\b' + key + '\\s*=\\s*["\x27]([^"\x27]*)["\x27]', 'i').exec(tag)?.[1].replace(/&amp;/g, '&') || ''; }
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
async function get(url: string): Promise<string> { const r = await harbor.http(url, { responseType: 'text', timeoutMs: 15000 }); if (r.status !== 200) throw new Error('HTTP ' + r.status + ' at ' + url); return String(r.body || ''); }
const summaries = new Map<string, EBookSummary>();
let report = '';
async function browse(q: string, offset: number): Promise<EBookSummary[]> {
  if (offset > 0) return [];
  try {
    const doc = await harbor.parseHtml(await get(BASE + (q ? '/search?q=' + encodeURIComponent(q) : '/')));
    const out = new Map<string, EBookSummary>();
    for (const card of doc.querySelectorAll('.book-preview')) {
      const a = card.querySelector('.preview-name a'); const id = path(a?.attr('href') || ''); const title = a?.text().trim();
      if (!id || !title) continue;
      const img = card.querySelector('img');
      const book = { id, title, author: card.querySelector('.preview-author .list')?.text().trim(), cover: abs(img?.attr('data-src') || img?.attr('src') || '') || undefined, siteUrl: BASE + id };
      out.set(id, book); summaries.set(id, book);
    }
    if (!out.size) throw new Error('No book cards found');
    return Array.from(out.values());
  } catch (e) { report = String(e); return [{ id: 'catalogue-diagnostic', title: 'ReadAnyBook Beta Diagnostic', description: report }]; }
}
type Loaded = { summary: EBookSummary; sections: EBookChapter[] };
const loaded = new Map<string, Promise<Loaded>>();
const failures = new Map<string, string>();
async function load(id: string): Promise<Loaded> {
  if (path(BASE + id) !== id) throw new Error('Invalid book');
  let pending = loaded.get(id);
  if (!pending) { pending = discover(id).then(result => { failures.delete(id); return result; }).catch(e => { loaded.delete(id); failures.set(id, String(e)); throw e; }); if (loaded.size >= 20) loaded.clear(); loaded.set(id, pending); }
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
      const epubTitle = value(xml, 'title'); const epubAuthor = value(xml, 'creator');
      stage = 'identity';
      const opaqueTitle = /^[a-f0-9]{32}(?:[a-f0-9]{8}|[a-f0-9]{32})?$/i.test(epubTitle);
      const labelVerified = (labels.get(root) || []).some(label => containsAll(title, label) && containsAll(author, label));
      if (!matches(title, epubTitle) && !(opaqueTitle && labelVerified)) throw new Error('Title mismatch: expected ' + title + '; found ' + (epubTitle || '[missing]') + '; package author=' + (epubAuthor || '[missing]') + '; strict file-label match=' + labelVerified);
      if ((tokens(title).length === 1 && tokens(title)[0].length <= 2) && (!author || !epubAuthor)) throw new Error('Short title requires author metadata');
      if (author && epubAuthor && !tokens(author).some(t => tokens(epubAuthor).includes(t))) throw new Error('Author mismatch: expected ' + author + '; found ' + epubAuthor);
      stage = 'spine';
      const base = opfUrl.slice(0, opfUrl.lastIndexOf('/') + 1);
      const manifest = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(xml)?.[1] || '';
      const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml)?.[1] || '';
      const items = new Map<string, { href: string; type: string }>();
      for (const tag of manifest.match(/<item\b[^>]*>/gi) || []) items.set(attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type') });
      const sections: EBookChapter[] = [];
      for (const tag of spine.match(/<itemref\b[^>]*>/gi) || []) { const item = items.get(attr(tag, 'idref')); if (!item || !['application/xhtml+xml','text/html'].includes(item.type)) continue; const url = resource(base, item.href); sections.push({ id: id + '|' + url, title: 'Section ' + (sections.length + 1), position: sections.length }); }
      if (!sections.length) throw new Error('No readable spine sections; manifest items=' + items.size);
      const cover = abs(doc.querySelector('.book-cover a.gallery-item')?.attr('href') || summaries.get(id)?.cover || '');
      const identityNote = opaqueTitle ? 'Reader identity uses the selected page file label (title and author); internal title is an opaque identifier.' : 'Reader package title verified.';
      return { sections, summary: { id, title, author: author || epubAuthor || undefined, cover: cover || undefined, siteUrl: BASE + id, description: [doc.querySelector('.book-description .visible-text')?.text().trim(), identityNote].filter(Boolean).join('\n\n') } };
    } catch (e) { reasons.push(stage + ': ' + String(e) + '\nPackage: ' + root); }
  }
  throw new Error(reasons.join('\n\n'));
}
export const plugin: EBookProvider = {
  id: 'readanybook-beta1', name: 'ReadAnyBook Beta v1',
  async popular(offset: number) { return browse('', offset); },
  async search(q: string, offset: number) { return browse(String(q || '').trim(), offset); },
  async detail(id: string) {
    if (id === 'catalogue-diagnostic') return { id, title: 'ReadAnyBook Beta Diagnostic', description: report };
    try { return (await load(id)).summary; } catch (e) { return { id, title: summaries.get(id)?.title || 'ReadAnyBook reader diagnostic', description: 'Reader failed: ' + String(e), siteUrl: BASE + id }; }
  },
  async chapters(id: string) {
    if (id === 'catalogue-diagnostic') return [];
    try { return (await load(id)).sections; } catch { return [{ id: 'reader-diagnostic|' + id, title: 'Reader failed — open diagnostic (not a book chapter)', position: 0 }]; }
  },
  async content(id: string) {
    if (id.startsWith('reader-diagnostic|')) { const bookId = id.slice('reader-diagnostic|'.length); if (path(BASE + bookId) !== bookId) throw new Error('Invalid diagnostic'); return 'ReadAnyBook Beta 0.1.2 reader diagnostic\n\nThis is an error report, not book content.\n\n' + (failures.get(bookId) || 'Error expired; reopen the book to retry.'); }
    const split = id.indexOf('|'); if (split < 0) throw new Error('Invalid section');
    const book = await load(id.slice(0, split)); if (!book.sections.some(section => section.id === id)) throw new Error('Unknown section');
    const html = await get(id.slice(split + 1)); const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
    if (body === undefined) throw new Error('No section body');
    const doc = await harbor.parseHtml('<html><body>' + body + '</body></html>');
    const text = doc.querySelectorAll('body h1, body h2, body h3, body h4, body h5, body h6, body p, body pre').map(block => block.text().trim()).filter(Boolean).join('\n\n');
    if (!text) throw new Error('No readable text in this section'); return text;
  },
};
harbor.register(plugin);
