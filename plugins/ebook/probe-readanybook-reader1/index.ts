import type { EBookProvider, EBookSummary, EBookChapter } from '../../../shared/types/ebook.js';
const ROOT = 'https://files.readanybook.com/786506/epub/jk-rowling-harry-potter-and-the-sorcerers-stone-book-1-1999-scholastic-paperbacks.epub/';
const SITE = 'https://www.readanybook.com/ebook/harry-potter-and-the-sorcerers-stone-book-one-68';
const BOOK = 'readanybook-68';
function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function attr(tag: string, name: string): string {
  const m = new RegExp('\\b' + name + '\\s*=\\s*["\x27]([^"\x27]*)["\x27]', 'i').exec(tag);
  return m ? decode(m[1]) : '';
}
function resource(href: string): string {
  const path = href.replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.includes('..') || !/^[a-z0-9_./-]+$/i.test(path)) throw new Error('Unsupported EPUB resource path');
  return ROOT + path;
}
async function fetchText(url: string): Promise<string> {
  const r = await harbor.http(url, { responseType: 'text', timeoutMs: 15000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  return String(r.body || '');
}
type BookData = { summary: EBookSummary; sections: EBookChapter[] };
let cached: Promise<BookData> | undefined;
async function load(): Promise<BookData> {
  if (!cached) cached = loadManifest().catch(e => { cached = undefined; throw e; });
  return cached;
}
async function loadManifest(): Promise<BookData> {
  const xml = await fetchText(ROOT + 'content.opf');
  if (!/<package\b/i.test(xml)) throw new Error('Not an EPUB manifest');
  const manifest = (/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(xml) || [])[1] || '';
  const spine = (/<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml) || [])[1] || '';
  const items = new Map<string, { href: string; type: string }>();
  for (const tag of manifest.match(/<item\b[^>]*>/gi) || []) items.set(attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type') });
  const sections: EBookChapter[] = [];
  for (const tag of spine.match(/<itemref\b[^>]*>/gi) || []) {
    const item = items.get(attr(tag, 'idref'));
    if (!item || item.type !== 'application/xhtml+xml') continue;
    sections.push({ id: resource(item.href), title: 'Section ' + (sections.length + 1), position: sections.length });
  }
  if (!sections.length) throw new Error('No readable spine sections');
  const title = decode((/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(xml) || [])[1] || 'Harry Potter and the Sorcerer\x27s Stone').trim();
  const author = decode((/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(xml) || [])[1] || '').trim();
  let cover: string | undefined;
  for (const tag of xml.match(/<meta\b[^>]*>/gi) || []) {
    if (attr(tag, 'name') !== 'cover') continue;
    const item = items.get(attr(tag, 'content'));
    if (item && item.type.startsWith('image/')) cover = resource(item.href);
  }
  return { sections, summary: { id: BOOK, title, author: author || undefined, cover, siteUrl: SITE, description: 'One-book reader test. Sections follow the EPUB reading order; some chapters span several sections.' } };
}
export const plugin: EBookProvider = {
  id: 'probe-readanybook-reader1', name: 'ReadAnyBook Reader Test v1',
  async popular(offset: number) { return offset > 0 ? [] : [(await load()).summary]; },
  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const book = (await load()).summary;
    return (book.title + ' ' + (book.author || '')).toLowerCase().includes(query.trim().toLowerCase()) ? [book] : [];
  },
  async detail(id: string) { return id === BOOK ? (await load()).summary : null; },
  async chapters(id: string) { return id === BOOK ? (await load()).sections : []; },
  async content(id: string) {
    const book = await load();
    if (!book.sections.some(section => section.id === id)) throw new Error('Unknown section');
    const html = await fetchText(id);
    const body = (/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [])[1];
    if (body === undefined) throw new Error('Section has no body');
    const doc = await harbor.parseHtml('<html><body>' + body + '</body></html>');
    const blocks = doc.querySelectorAll('body h1, body h2, body h3, body h4, body h5, body h6, body p, body pre');
    const text = blocks.map(block => block.text().trim()).filter(Boolean).join('\n\n');
    if (!text) throw new Error('No readable text in section');
    return text;
  },
};
harbor.register(plugin);
