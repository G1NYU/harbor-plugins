/**
 * DreamScan FR Probe v2 - Harbor-native, diagnostic only.
 * Reader image extraction: img/picture/srcset, page-related JSON, script arrays,
 * and URLs embedded in HTML/JS. Avoid selecting logos or cover thumbnails.
 *
 * Search: inspect | read | image | read392 | image392 | lang | series | catalog
 * No proxy, cookies, or header bypasses. All requests have an 8s timeout.
 */
import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://dreamscan.cc';
const CH389 = '/read/black-clover-chapitre-389';
const CH392 = '/read/black-clover-chapitre-392';
const HTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,*/*',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
};
type Candidate = { url: string; score: number; why: string };
type Page = { status: number; html: string };
let lastMessage = '';

function err(e: unknown): string {
  return String((e as Error)?.message || e).slice(0, 125);
}
function rows(parts: string[]): MangaSummary[] {
  lastMessage = parts.join(' | ');
  const out: MangaSummary[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length && out.length < 32; i += 34) {
      out.push({ id: 'v2-' + out.length, title: part.slice(i, i + 34) });
    }
  }
  return out;
}
async function get(path: string): Promise<Page> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Bad test path');
  const r = await harbor.http(BASE + path, { responseType: 'text', timeoutMs: 8000, headers: HTML_HEADERS });
  return { status: Number(r?.status ?? 0), html: String(r?.body ?? '') };
}
function decode(s: string): string {
  return String(s || '')
    .replace(/\\u002[fF]/g, '/').replace(/\\u003[aA]/g, ':')
    .replace(/\\u0026/g, '&').replace(/\\u003[dD]/g, '=')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'").replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
function absolute(src: string): string {
  const s = decode(src).trim().replace(/^["']|["']$/g, '');
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return BASE + s;
  return '';
}
function hostname(url: string): string { return /^https?:\/\/([^/]+)/i.exec(url)?.[1] || '?'; }
function safePath(url: string): string {
  // Do not expose signed query parameters in the UI.
  return url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].slice(0, 95);
}
function attrs(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) result[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return result;
}
function blocked(url: string): boolean {
  return /(?:\/logo(?:\/|[-_.])|favicon|\/(?:icon|icons|avatar|avatars|poster|covers?|thumb(?:nails)?|banner|static|assets|profile|emoji)(?:\/|[-_.])|\.svg(?:\?|$)|\.gif(?:\?|$))/i.test(url);
}
function isImage(url: string): boolean {
  return /\.(?:jpe?g|png|webp|avif|bmp)(?:[?#]|$)/i.test(url)
    || /\/(?:image|images|page|pages|chapter|chapters|scan)\//i.test(url);
}
function add(out: Candidate[], input: string, points: number, why: string): void {
  const url = absolute(input);
  if (!url || blocked(url) || !isImage(url)) return;
  const existing = out.find(x => x.url === url);
  if (existing) {
    if (points > existing.score) { existing.score = points; existing.why = why; }
  } else if (out.length < 120) out.push({ url, score: points, why });
}
function srcsetCandidates(s: string): string[] {
  return decode(s).split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
}

// Parse balanced JSON arrays/objects, while respecting strings and escaped quotes.
function balanced(text: string, from: number, max = 160000): string {
  const start = text.charAt(from);
  if (start !== '[' && start !== '{') return '';
  const stack: string[] = [];
  let quote = '';
  let escaped = false;
  for (let i = from; i < text.length && i < from + max; i++) {
    const ch = text.charAt(i);
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ']' || ch === '}') {
      const need = ch === ']' ? '[' : '{';
      if (stack.pop() !== need) return '';
      if (!stack.length) return text.slice(from, i + 1);
    }
  }
  return '';
}
function jsonImages(obj: any, out: Candidate[], context: string, depth = 0): void {
  if (depth > 9 || !obj) return;
  if (typeof obj === 'string') {
    if (/(?:page|image|chapter|scan|slide|file)/i.test(context)) add(out, obj, 72, 'JSON ' + context.slice(0, 18));
    return;
  }
  if (Array.isArray(obj)) {
    for (const child of obj.slice(0, 120)) jsonImages(child, out, context, depth + 1);
    return;
  }
  if (typeof obj !== 'object') return;
  for (const key of Object.keys(obj).slice(0, 80)) {
    const v = obj[key];
    const newContext = /^(?:src|url|href|path|file|image|imageUrl|image_url)$/i.test(key)
      ? context + '.' + key
      : key;
    if (typeof v === 'string') {
      if (/(?:page|image|chapter|scan|slide|file)/i.test(newContext)) add(out, v, 78, 'JSON ' + newContext.slice(0, 18));
    } else {
      jsonImages(v, out, newContext, depth + 1);
    }
  }
}
function discoverImages(html: string): { candidates: Candidate[]; tagCount: number; scriptCount: number; arrays: number; } {
  const found: Candidate[] = [];
  const tags = html.match(/<(?:img|source)\b[^>]*>/gi) || [];
  const readerAt = html.search(/(?:id=["']reader|class=["'][^"']*reader|Page\s*1)/i);
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = match[0];
    const a = attrs(tag);
    const label = [a.alt || '', a.class || '', a['data-page'] || '', a['data-index'] || ''].join(' ');
    const numbered = /\b(?:page|planche|página|pagina)\s*[-:#]?\s*\d+\b/i.test(label);
    const reader = /reader|chapter|manga-page|scan-page|reading/i.test(label);
    const inside = readerAt >= 0 && match.index >= readerAt && match.index < readerAt + 120000;
    const strength = numbered ? 98 : reader ? 82 : inside ? 52 : 8;
    for (const key of ['data-src', 'data-lazy-src', 'data-original', 'data-image', 'data-url', 'src', 'poster']) {
      if (a[key]) add(found, a[key], strength, numbered ? 'page img alt' : 'img ' + key);
    }
    for (const key of ['srcset', 'data-srcset']) {
      if (a[key]) for (const src of srcsetCandidates(a[key])) add(found, src, strength + 3, 'srcset ' + label.slice(0, 10));
    }
  }
  let arrays = 0;
  const normalized = decode(html);
  const scripts = normalized.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  // Extract image data from JSON scripts and from arrays such as images/pages/chapterImages.
  for (const tag of scripts) {
    const start = tag.indexOf('>');
    const text = tag.slice(start + 1).replace(/<\/script>\s*$/i, '').trim();
    if (!text) continue;
    const objSource = /^[\[{]/.test(text) ? text : '';
    if (objSource && objSource.length < 150000) {
      try { jsonImages(JSON.parse(objSource), found, 'data'); } catch (_e) {}
    }
    const pattern = /(?:["']?(?:chapterImages|chapter_pages|chapterPages|pageImages|pageUrls|imageUrls|image_urls|images|pages|slides)["']?\s*[:=]\s*)(?=\[|\{)/gi;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = pattern.exec(text)) !== null && count++ < 40) {
      const part = balanced(text, pattern.lastIndex);
      if (!part) continue;
      arrays++;
      try { jsonImages(JSON.parse(part), found, 'chapterPages'); } catch (_e) {
        for (const hit of part.matchAll(/["']((?:https?:)?\/\/[^"'\s<>]+|\/[^"'\s<>]+\.(?:jpe?g|png|webp|avif))["']/gi)) {
          add(found, hit[1], 70, 'JS array');
        }
      }
    }
  }
  // Detect chapter image links in JS even if they do not form valid JSON.
  const urls = normalized.match(/https?:\/\/[^\s"'<>\\]{5,320}?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>\\]*)?/gi) || [];
  for (const url of urls.slice(0, 250)) {
    const at = normalized.indexOf(url);
    const context = normalized.slice(Math.max(0, at - 130), at + 20);
    const strength = /page|chapter|reader|scan|imageUrl/i.test(context) ? 63 : 16;
    add(found, url, strength, 'script URL');
  }
  found.sort((a, b) => b.score - a.score);
  return { candidates: found, tagCount: tags.length, scriptCount: scripts.length, arrays };
}
function basics(label: string, page: Page): string[] {
  return [label + ' HTTP ' + page.status, 'HTML bytes ' + page.html.length];
}
function details(page: Page, label: string): string[] {
  const data = discoverImages(page.html);
  const strong = data.candidates.filter(x => x.score >= 50);
  const parts = basics(label, page);
  parts.push('img+source tags ' + data.tagCount);
  parts.push('script tags ' + data.scriptCount);
  parts.push('image arrays ' + data.arrays);
  parts.push('image URLs ' + data.candidates.length);
  parts.push('page candidates ' + strong.length);
  parts.push('Page 1 text ' + (/Page\s*1\b/i.test(page.html) ? 'yes' : 'no'));
  for (const item of strong.slice(0, 3)) {
    parts.push('score ' + item.score + ' ' + item.why);
    parts.push('host ' + hostname(item.url));
    parts.push('path ' + safePath(item.url));
  }
  if (!strong.length) parts.push('No confirmed page URLs yet');
  return parts;
}
async function read(path: string, testImage: boolean): Promise<MangaSummary[]> {
  const p = await get(path);
  const label = path.includes('392') ? 'READ392' : 'READ389';
  const parts = details(p, label);
  if (p.status !== 200 || !testImage) return rows(parts);
  const data = discoverImages(p.html);
  const candidate = data.candidates.find(x => x.score >= 65);
  if (!candidate) return rows([...parts, 'No trustworthy image to fetch']);
  try {
    // Plain Harbor request. No cookies, Referer, third-party proxy, or bypass.
    const r = await harbor.http(candidate.url, { responseType: 'base64', timeoutMs: 8000, headers: { Accept: 'image/*,*/*' } });
    const headers: Record<string, string> = r?.headers || {};
    const type = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    parts.push('IMAGE HTTP ' + Number(r?.status ?? 0));
    parts.push('content-type ' + (type ? headers[type] : '(unknown)'));
    parts.push('body chars ' + String(r?.body ?? '').length);
    parts.push('candidate origin ' + candidate.why);
  } catch (e) { parts.push('IMAGE ERR ' + err(e)); }
  return rows(parts);
}
async function inspect(): Promise<MangaSummary[]> {
  const p = await get(CH389);
  const parts = basics('INSPECT389', p);
  const s = decode(p.html);
  for (const key of ['<picture', 'srcset=', '__NEXT_DATA__', '__NUXT__', 'readerarea',
    'chapterImages', 'pageUrls', 'imageUrls', 'pages', 'Page 1', 'application/json', 'data-src']) {
    parts.push(key + ' = ' + (s.toLowerCase().split(key.toLowerCase()).length - 1));
  }
  const pageAt = s.search(/Page\s*1\b/i);
  if (pageAt >= 0) parts.push('page1 context ' + s.slice(Math.max(0, pageAt - 65), pageAt + 85).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 130));
  return rows(parts);
}
async function lang(): Promise<MangaSummary[]> {
  const urls = [CH389 + '?lang=fr', CH389 + '?lang=es'];
  const parts: string[] = [];
  for (const url of urls) {
    try {
      const p = await get(url);
      const data = discoverImages(p.html);
      parts.push(url.slice(-7) + ' HTTP ' + p.status);
      parts.push('bytes ' + p.html.length + ' page candidates ' + data.candidates.filter(x => x.score >= 50).length);
      const first = data.candidates.find(x => x.score >= 50);
      if (first) parts.push('host ' + hostname(first.url) + ' ' + safePath(first.url).slice(0, 45));
    } catch (e) { parts.push(url.slice(-7) + ' ERR ' + err(e)); }
  }
  return rows(parts);
}
async function series(): Promise<MangaSummary[]> {
  const p = await get('/manga/black-clover');
  const paths: string[] = [];
  for (const m of p.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decode(m[1]);
    const path = href.startsWith(BASE) ? href.slice(BASE.length) : href;
    if (path.startsWith('/read/') && !paths.includes(path)) paths.push(path);
  }
  const parts = basics('SERIES', p);
  parts.push('unique read links ' + paths.length);
  for (const path of paths.slice(0, 4)) parts.push('chapter ' + path.slice(0, 90));
  return rows(parts);
}
async function catalog(): Promise<MangaSummary[]> {
  const p = await get('/catalog');
  const links = (p.html.match(/href\s*=\s*["'][^"']*\/manga\//gi) || []).length;
  return rows([...basics('CATALOG', p), 'manga hrefs ' + links, 'img tags ' + (p.html.match(/<img\b/gi) || []).length]);
}
const plugin: MangaProvider = {
  id: 'probe-dreamscan2',
  name: 'Probe DreamScan FR v2',
  async popular(offset: number) {
    if (offset) return [];
    try { return await read(CH389, false); } catch (e) { return rows(['READ ERR ' + err(e)]); }
  },
  async search(query: string, offset: number) {
    if (offset) return [];
    const q = String(query || '').trim().toLowerCase();
    try {
      if (!q || q === 'read') return await read(CH389, false);
      if (q === 'image') return await read(CH389, true);
      if (q === 'read392') return await read(CH392, false);
      if (q === 'image392') return await read(CH392, true);
      if (q === 'inspect') return await inspect();
      if (q === 'lang') return await lang();
      if (q === 'series') return await series();
      if (q === 'catalog') return await catalog();
      return rows(['Available: inspect, read, image', 'read392, image392, lang', 'series, catalog']);
    } catch (e) { return rows(['ERR ' + q + ' ' + err(e)]); }
  },
  async detail(id: string) { return { id, title: 'DreamScan v2 diagnostics', description: lastMessage }; },
  async chapters(_id: string) { return []; },
  async pageUrls(_id: string) { return []; },
};
harbor.register(plugin);
