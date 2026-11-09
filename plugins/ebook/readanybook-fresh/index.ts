import type { EBookProvider, EBookSummary, EBookChapter } from '../../../shared/types/ebook.js';
const BASE = 'https://www.readanybook.com';
const DIAG = 'readanybook-fresh-recovery-diagnostic|';
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
async function get(url: string): Promise<string> { const r = await harbor.http(url, { responseType: 'text', timeoutMs: 15000 }); if (r.status !== 200) throw new Error('HTTP ' + r.status + ' at ' + url); return String(r.body || ''); }
type Item = { href: string; type: string; properties: string };
async function labelSections(sections: EBookChapter[], base: string, xml: string, items: Map<string, Item>, spine: string): Promise<void> {
  const names = new Map<string, string>();
  const sectionUrl = (s: EBookChapter) => s.id.slice(s.id.indexOf('|') + 1);
  const allowed = new Set(sections.map(sectionUrl));
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 240);
  function add(dir: string, href: string, title: string) {
    try { const url = resource(dir, href); const name = clean(title); if (name && allowed.has(url) && !names.has(url)) names.set(url, name); } catch {}
  }
  const nav = Array.from(items.values()).find(item => item.properties.split(/\s+/).includes('nav'));
  if (nav) {
    try {
      const url = resource(base, nav.href); const dir = url.slice(0, url.lastIndexOf('/') + 1);
      const doc = await harbor.parseHtml(await get(url));
      const toc = doc.querySelectorAll('nav').find(node => (node.attr('epub:type') || '').split(/\s+/).includes('toc') || node.attr('role') === 'doc-toc');
      for (const link of toc?.querySelectorAll('a[href]') || []) add(dir, link.attr('href') || '', link.text());
    } catch {}
  }
  if (names.size < sections.length) {
    const ncxId = attr((spine.match(/<spine\b[^>]*>/i) || [])[0] || '', 'toc');
    const ncx = items.get(ncxId) || Array.from(items.values()).find(item => item.type === 'application/x-dtbncx+xml');
    if (ncx) {
      try {
        const url = resource(base, ncx.href); const dir = url.slice(0, url.lastIndexOf('/') + 1); const source = await get(url);
        const stack: Array<{ name: string; href: string }> = [];
        for (const token of source.match(/<navPoint\b[^>]*>|<\/navPoint\s*>|<navLabel\b[^>]*>[\s\S]*?<\/navLabel\s*>|<content\b[^>]*>/gi) || []) {
          if (/^<navPoint\b/i.test(token)) stack.push({ name: '', href: '' });
          else if (/^<\/navPoint/i.test(token)) stack.pop();
          else if (stack.length) {
            const entry = stack[stack.length - 1];
            if (/^<navLabel\b/i.test(token)) entry.name = (await harbor.parseHtml('<html><body><p>' + token.replace(/<[^>]*>/g, '') + '</p></body></html>')).querySelector('p')?.text() || '';
            else { entry.href = attr(token, 'src'); add(dir, entry.href, entry.name); }
          }
        }
      } catch {}
    }
  }
  const guide = /<guide\b[^>]*>([\s\S]*?)<\/guide>/i.exec(xml)?.[1] || '';
  const standard: Record<string, string> = { cover: 'Cover', 'title-page': 'Title page', copyright: 'Copyright', dedication: 'Dedication', preface: 'Preface', foreword: 'Foreword', acknowledgements: 'Acknowledgements', toc: 'Contents', 'list-of-illustrations': 'List of illustrations', 'list-of-tables': 'List of tables', glossary: 'Glossary', bibliography: 'Bibliography', index: 'Index' };
  for (const tag of guide.match(/<reference\b[^>]*>/gi) || []) {
    try { const type = attr(tag, 'type').toLowerCase(); const title = attr(tag, 'title'); const decoded = title ? (await harbor.parseHtml('<p>' + title.replace(/</g, '&lt;') + '</p>')).querySelector('p')?.text() || '' : ''; add(base, attr(tag, 'href'), decoded || standard[type] || ''); } catch {}
  }
  const missing = sections.filter(section => !names.has(sectionUrl(section))).slice(0, 12);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
    while (next < missing.length) {
      const section = missing[next++]; const url = sectionUrl(section);
      try {
        const source = await get(url); const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)?.[1];
        if (body === undefined) continue;
        const doc = await harbor.parseHtml('<html><body>' + body + '</body></html>');
        const heading = doc.querySelector('body h1, body h2, body h3, body h4, body h5, body h6')?.text();
        if (heading && clean(heading)) names.set(url, clean(heading));
      } catch {}
    }
  }));
  for (const section of sections) {
    const number = String((section.position || 0) + 1).padStart(2, '0');
    section.title = number + ' — ' + (names.get(sectionUrl(section)) || 'Reading section');
  }
}
const summaries = new Map<string, EBookSummary>();
let report = '';
async function browse(q: string, offset: number): Promise<EBookSummary[]> {
  if (offset > 0) return [];
  try {
    const doc = await harbor.parseHtml(await get(BASE + (q ? '/search?q=' + encodeURIComponent(q) : '/')));
    const out = new Map<string, EBookSummary>();
    if (!q && !doc.querySelector('.main-list')) throw new Error('Expected main catalogue container not found');
    for (const card of doc.querySelectorAll(q ? '.book-preview' : '.main-list .book-preview')) {
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
      const spine = spineMatch?.[1] || '';
      const items = new Map<string, Item>();
      for (const tag of manifest.match(/<item\b[^>]*>/gi) || []) items.set(attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type'), properties: attr(tag, 'properties') });
      const sections: EBookChapter[] = [];
      for (const tag of spine.match(/<itemref\b[^>]*>/gi) || []) { const item = items.get(attr(tag, 'idref')); if (!item || !['application/xhtml+xml','text/html'].includes(item.type)) continue; const url = resource(base, item.href); const position = sections.length; sections.push({ id: id + '|' + url, title: String(position + 1).padStart(2, '0') + ' — Reading section', position }); }
      if (!sections.length) throw new Error('No readable spine sections; manifest items=' + items.size);
      try { await labelSections(sections, base, xml, items, spineMatch?.[0] || ''); } catch {}
      const cover = abs(doc.querySelector('.book-cover a.gallery-item')?.attr('href') || summaries.get(id)?.cover || '');
      const identityNote = opaqueTitle ? 'Reader identity uses the selected page file label (title and author) because the internal title is opaque.' : 'Reader package title verified; meaningful author metadata is checked when available.';
      return { sections, summary: { id, title, author: author || epubAuthor || undefined, cover: cover || undefined, siteUrl: BASE + id, description: [doc.querySelector('.book-description .visible-text')?.text().trim(), identityNote, 'Reader Recovery: all source sections are retained in reading order. Repeated labels identify source sections, not duplicate content. Multiple TOC links within one document remain one section.'].filter(Boolean).join('\n\n') } };
    } catch (e) { reasons.push(stage + ': ' + String(e) + '\nPackage: ' + root); }
  }
  throw new Error(reasons.join('\n\n'));
}
export const plugin: EBookProvider = {
  id: 'readanybook-fresh', name: 'ReadAnyBook Fresh',
  async popular(offset: number) { return browse('', offset); },
  async search(q: string, offset: number) { return browse(String(q || '').trim(), offset); },
  async detail(id: string) {
    if (id === 'fresh-catalogue-diagnostic') return { id, title: 'ReadAnyBook Fresh Diagnostic', description: report };
    try { return (await load(id)).summary; } catch (e) { return { id, title: summaries.get(id)?.title || 'ReadAnyBook Fresh reader diagnostic', description: 'Reader failed: ' + String(e), siteUrl: BASE + id }; }
  },
  async chapters(id: string) {
    if (id === 'fresh-catalogue-diagnostic') return [];
    try { return (await load(id)).sections; } catch { return [{ id: DIAG + id, title: 'ReadAnyBook Fresh — Reader Recovery diagnostic (not a book chapter)', position: 0 }]; }
  },
  async content(id: string) {
    if (id.startsWith(DIAG)) { const bookId = id.slice(DIAG.length); if (path(BASE + bookId) !== bookId) throw new Error('Invalid diagnostic'); return 'ReadAnyBook Fresh — Reader Recovery\n\nSource ID: readanybook-fresh\nThis is an error report, not book content.\n\n' + (failures.get(bookId) || 'Error expired; reopen the book to retry.'); }
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
