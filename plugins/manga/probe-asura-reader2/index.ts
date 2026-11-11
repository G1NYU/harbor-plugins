/**
 * Asura reader v2 diagnostic for Harbor's testing repository.
 * Uses a current, publicly linked chapter to distinguish HTML extraction from
 * CDN image delivery. This is NOT intended to replace the production plugin.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const SITE = 'https://asurascans.com';
const API = 'https://api.asurascans.com/api';
const SERIES = '/comics/cyberpunk-chivalry-f212c582';
const CHAPTER = SERIES + '/chapter/1';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

function entity(s: string): string {
  return s.replace(/&quot;/gi, '"').replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}
function attr(tag: string, name: string): string {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\x27([^\x27]*)\x27)', 'i').exec(tag);
  return m ? entity(m[1] ?? m[2] ?? '') : '';
}
function abs(url: unknown): string {
  const v = String(url || '').trim();
  if (v.startsWith('//')) return 'https:' + v;
  if (v.startsWith('/')) return SITE + v;
  return /^https?:\/\//i.test(v) ? v : '';
}
function astroVal(value: any): any {
  if (!Array.isArray(value)) return value;
  if (value[0] === 0) return value[1];
  if (value[0] === 1 && Array.isArray(value[1])) return value[1].map(astroVal);
  return value[1];
}
function fromAstro(html: string): string[] {
  for (const tag of html.match(/<astro-island\b[^>]*>/gi) || []) {
    if (!/ChapterReader/i.test(attr(tag, 'component-url') + ' ' + attr(tag, 'opts'))) continue;
    let props: any;
    try { props = JSON.parse(attr(tag, 'props')); } catch { continue; }
    const pages = astroVal(props?.pages);
    if (!Array.isArray(pages)) continue;
    const out: string[] = [];
    for (const page of pages) {
      const value = astroVal(page);
      const src = abs(astroVal(value?.url));
      if (src && !out.includes(src)) out.push(src);
    }
    if (out.length) return out;
  }
  return [];
}
function fromImages(html: string): string[] {
  const matches: Array<{ number: number; pos: number; url: string }> = [];
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const alt = attr(tag, 'alt');
    if (!/\bPage\s*\d+\s*-\s*Chapter\b/i.test(alt)) continue;
    const src = abs(attr(tag, 'data-src') || attr(tag, 'src'));
    if (!/^https:\/\/cdn\.asurascans\.com\//i.test(src)) continue;
    const page = /\bPage\s*(\d+)/i.exec(alt);
    matches.push({ number: page ? Number(page[1]) : 0, pos: m.index, url: src });
  }
  matches.sort((a, b) => (a.number || a.pos) - (b.number || b.pos));
  return [...new Set(matches.map(m => m.url))];
}
async function request(url: string, responseType: 'text' | 'base64' = 'text'): Promise<any> {
  return harbor.http(url, {
    responseType, timeoutMs: 8000,
    headers: { 'User-Agent': USER_AGENT, Accept: responseType === 'text' ? 'text/html,application/json,*/*' : 'image/*,*/*' },
  });
}
function typeOf(headers: any): string {
  if (!headers || typeof headers !== 'object') return '(unknown)';
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
  return match ? String(match[1]) : '(unknown)';
}
function rows(parts: string[]): MangaSummary[] {
  const out: MangaSummary[] = [];
  for (const item of parts) for (let i = 0; i < item.length; i += 34)
    out.push({ id: 'diag-' + out.length, title: item.slice(i, i + 34) });
  return out;
}
async function inspect(command: string): Promise<MangaSummary[]> {
  try {
    if (command === 'api') {
      const r = await request(API + '/series/cyberpunk-chivalry/chapters/1');
      const body = String(r.body ?? '');
      let count = 0;
      try { const data = JSON.parse(body); count = data?.data?.chapter?.pages?.length ?? 0; } catch { /* diagnostic */ }
      return rows(['API HTTP ' + r.status, 'TYPE ' + typeOf(r.headers), 'BYTES ' + body.length, 'API PAGES ' + count,
        'BODY ' + body.replace(/\s+/g, ' ').slice(0, 90)]);
    }
    const r = await request(SITE + CHAPTER);
    const html = String(r.body ?? '');
    const fromProps = fromAstro(html);
    const fromTags = fromImages(html);
    const images = fromProps.length ? fromProps : fromTags;
    const parts = ['CHAPTER HTTP ' + r.status, 'HTML CHARS ' + html.length,
      'ASTRO ISLAND ' + /<astro-island/i.test(html), 'ASTRO PAGES ' + fromProps.length,
      'IMG PAGES ' + fromTags.length, 'FIRST ' + (images[0] || '(none)')];
    if (command === 'image' && images.length) {
      try {
        const img = await request(images[0], 'base64');
        parts.push('IMAGE HTTP ' + img.status, 'TYPE ' + typeOf(img.headers),
          'BASE64 CHARS ' + String(img.body ?? '').length);
      } catch (e) { parts.push('IMAGE ERROR ' + String(e).slice(0, 140)); }
    }
    return rows(parts);
  } catch (e) { return rows(['REQUEST ERROR ' + String(e).slice(0, 180)]); }
}

const plugin: MangaProvider = {
  id: 'probe-asura-reader2', name: 'Probe Asura Reader v2',
  async popular(offset: number) {
    if (offset > 0) return [];
    return [{ id: SERIES, title: 'TEST Cyberpunk Chivalry' }, ...(await inspect('chapter'))];
  },
  async search(query: string, offset: number) { return offset ? [] : inspect(query.trim().toLowerCase()); },
  async detail(id: string) { return { id, title: 'Asura Reader v2 test', description: 'Open the chapter to test images. Search image or api to see request diagnostics.' }; },
  async chapters(id: string): Promise<MangaChapter[]> {
    return id === SERIES ? [{ id: CHAPTER, chapter: '1', title: 'Test Chapter 1', pages: 0, language: 'en' }] : [];
  },
  async pageUrls(id: string) {
    if (id !== CHAPTER) return [];
    const r = await request(SITE + id);
    if (Number(r.status) !== 200) throw new Error('Chapter HTTP ' + r.status);
    const html = String(r.body || '');
    const urls = fromAstro(html);
    const result = urls.length ? urls : fromImages(html);
    if (!result.length) throw new Error('No reader images: HTML ' + html.length + ' chars');
    return result;
  },
};
harbor.register(plugin);
