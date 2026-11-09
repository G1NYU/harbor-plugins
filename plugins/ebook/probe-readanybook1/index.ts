import type { EBookProvider, EBookSummary } from '../../../shared/types/ebook.js';
const ROOT = 'https://files.readanybook.com/786506/epub/jk-rowling-harry-potter-and-the-sorcerers-stone-book-1-1999-scholastic-paperbacks.epub/';
let report = 'Open browse to run the test.';
function attr(tag: string, name: string): string {
  const m = new RegExp('\\b' + name + '\\s*=\\s*["\x27]([^"\x27]*)["\x27]', 'i').exec(tag);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}
function rows(parts: string[]): EBookSummary[] {
  report = parts.join('\n');
  const out: EBookSummary[] = [];
  for (const part of parts) for (let i = 0; i < part.length; i += 34) out.push({ id: 'diag-' + out.length, title: part.slice(i, i + 34), description: report });
  return out;
}
function type(headers: Record<string, string>): string {
  for (const key of Object.keys(headers || {})) if (key.toLowerCase() === 'content-type') return headers[key];
  return 'unknown';
}
async function test(): Promise<EBookSummary[]> {
  const parts: string[] = [];
  try {
    const r = await harbor.http(ROOT + 'content.opf', { responseType: 'text', timeoutMs: 8000 });
    const xml = String(r.body || '');
    parts.push('OPF HTTP ' + r.status, 'TYPE ' + type(r.headers), 'OPF chars ' + xml.length);
    if (r.status !== 200) return rows(parts);
    if (!/<package\b/i.test(xml)) return rows([...parts, 'NO package XML']);
    const manifest = (/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(xml) || [])[1] || '';
    const spine = (/<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(xml) || [])[1] || '';
    const items = new Map<string, string>();
    for (const tag of manifest.match(/<item\b[^>]*>/gi) || []) if (attr(tag, 'media-type') === 'application/xhtml+xml') items.set(attr(tag, 'id'), attr(tag, 'href'));
    const ordered = (spine.match(/<itemref\b[^>]*>/gi) || []).map(tag => items.get(attr(tag, 'idref')) || '').filter(Boolean);
    parts.push('XHTML items ' + items.size, 'SPINE sections ' + ordered.length);
    const href = ordered.find(path => /split_001\.xhtml$/i.test(path)) || ordered.find(path => !/title/i.test(path)) || ordered[0];
    if (!href) return rows([...parts, 'NO text section']);
    if (href.startsWith('/') || href.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(href) || !/^[a-z0-9_./-]+$/i.test(href)) return rows([...parts, 'Unsupported section path']);
    parts.push('SECTION ' + href);
    const section = await harbor.http(ROOT + href, { responseType: 'text', timeoutMs: 8000 });
    const html = String(section.body || '');
    parts.push('SECTION HTTP ' + section.status, 'TYPE ' + type(section.headers), 'HTML chars ' + html.length);
    if (section.status !== 200) return rows(parts);
    const body = (/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [])[1];
    if (body === undefined) return rows([...parts, 'NO body element']);
    const text = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    parts.push('TEXT chars ' + text.length, 'PARAGRAPHS ' + (body.match(/<p\b/gi) || []).length, 'Text present ' + (text.length > 0));
    return rows(parts);
  } catch (e) { return rows([...parts, 'ERROR ' + String(e)]); }
}
export const plugin: EBookProvider = {
  id: 'probe-readanybook1', name: 'ReadAnyBook Test v1',
  async popular(offset: number) { return offset > 0 ? [] : test(); },
  async search(_query: string, offset: number) { return offset > 0 ? [] : test(); },
  async detail(id: string) { return { id, title: 'ReadAnyBook diagnostic', description: report }; },
  async chapters(_id: string) { return []; },
  async content(_id: string) { return report; },
};
harbor.register(plugin);
