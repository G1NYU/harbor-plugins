/**
 * DreamScan FR Probe v3 for Harbor.
 * Discovers a real series and chapter from /catalog instead of assuming a title.
 * Inspects how that chapter identifies its image loader. Testing only.
 * Search commands: discover, inspect, scripts, image.
 */
import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://dreamscan.cc';
const H = { Accept: 'text/html,application/xhtml+xml,*/*', 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36' };
type Page = { status: number; body: string; type: string };
type Found = { series: string; chapter: string; catalogue: number; seriesStatus: number; seriesCount: number };
let last = '';
function fail(e: unknown): string { return String((e as Error)?.message || e).slice(0, 125); }
function rows(parts: string[]): MangaSummary[] {
  last = parts.join(' | ');
  const out: MangaSummary[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length && out.length < 32; i += 34) {
      out.push({ id: 'v3-' + out.length, title: part.slice(i, i + 34) });
    }
  }
  return out;
}
function entity(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;/gi, "'");
}
function safePath(x: string): string {
  const text = entity(x);
  if (text.startsWith(BASE + '/')) return text.slice(BASE.length).split('?')[0].split('#')[0];
  if (text.startsWith('/') && !text.startsWith('//')) return text.split('?')[0].split('#')[0];
  return '';
}
function labelPath(x: string): string {
  return x.replace(/[\r\n]/g, ' ').split('?')[0].slice(0, 94);
}
function attr(tag: string, name: string): string {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)', 'i');
  const m = re.exec(tag);
  return m ? entity(m[1] ?? m[2] ?? '') : '';
}
function links(html: string, matcher: RegExp, max: number): string[] {
  const result: string[] = [];
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = safePath(attr(tag, 'href'));
    if (!href || !matcher.test(href) || result.includes(href)) continue;
    result.push(href);
    if (result.length >= max) break;
  }
  return result;
}
async function get(path: string): Promise<Page> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Non-local request refused');
  const r = await harbor.http(BASE + path, { responseType: 'text', timeoutMs: 8000, headers: H });
  const headers: Record<string, string> = r?.headers || {};
  const ck = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
  return { status: Number(r?.status ?? 0), body: String(r?.body ?? ''), type: ck ? String(headers[ck]) : '?' };
}
async function discover(): Promise<Found> {
  const page = await get('/catalog');
  if (page.status !== 200) throw new Error('catalog HTTP ' + page.status);
  const options = links(page.body, /^\/manga\/[^/]+\/?$/i, 10);
  if (!options.length) throw new Error('catalog had no /manga/ links');
  for (const series of options.slice(0, 4)) {
    const detail = await get(series);
    if (detail.status !== 200) continue;
    const paths = links(detail.body, /^\/read\/[^?#]+/i, 80);
    if (paths.length) return { series, chapter: paths[0], catalogue: options.length, seriesStatus: detail.status, seriesCount: paths.length };
  }
  throw new Error('No chapter link in first four catalogue series');
}
function scriptTags(html: string): { external: string[]; inline: string[] } {
  const tags = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  const external: string[] = [], inline: string[] = [];
  for (const tag of tags) {
    const opening = tag.slice(0, tag.indexOf('>') + 1);
    const src = attr(opening, 'src');
    if (src) {
      const path = safePath(src);
      if (path && /\.js(?:$|[?#])/i.test(path) && !external.includes(path)) external.push(path);
    } else {
      const body = tag.slice(opening.length).replace(/<\/script>\s*$/i, '');
      if (body.trim()) inline.push(body);
    }
  }
  return { external, inline };
}
function pageClues(html: string): string[] {
  const result: string[] = [];
  for (const key of ['Page 1', 'reader', 'chapter', 'scan', 'image', 'pages', 'srcset', 'data-src', 'data-page']) {
    const re = new RegExp(key, 'gi');
    const count = (html.match(re) || []).length;
    result.push(key + ' occurrences ' + count);
  }
  for (const match of html.matchAll(/<[^>]{1,350}(?:id|class)\s*=\s*["'][^"']*(?:page|reader|chapter|story-scan)[^"']*["'][^>]*>/gi)) {
    const tag = match[0];
    result.push('DOM ' + tag.replace(/\s+/g, ' ').slice(0, 130));
    if (result.length > 18) break;
  }
  return result;
}
function imageCandidates(html: string): string[] {
  const chosen: string[] = [];
  const scans = html.match(/<img\b[^>]*>/gi) || [];
  for (const t of scans) {
    const info = [attr(t, 'alt'), attr(t, 'class'), attr(t, 'id'), attr(t, 'data-page')].join(' ');
    if (!/(?:reader|chapter|(?:page|planche)\s*\d+)/i.test(info)) continue;
    for (const key of ['data-src', 'data-original', 'data-lazy-src', 'src']) {
      const raw = attr(t, key);
      if (/^https?:\/\//i.test(raw) && !/\/logo\/|favicon|thumbnail|avatar|\/covers?\//i.test(raw) && !chosen.includes(raw)) chosen.push(raw);
    }
  }
  return chosen;
}
async function commandDiscover(): Promise<MangaSummary[]> {
  const d = await discover();
  return rows(['CATALOG first ' + d.catalogue + ' links', 'SERIES HTTP ' + d.seriesStatus, 'chosen series ' + labelPath(d.series), 'chapter links ' + d.seriesCount, 'chosen chapter ' + labelPath(d.chapter)]);
}
async function commandInspect(): Promise<MangaSummary[]> {
  const d = await discover();
  const p = await get(d.chapter);
  const s = scriptTags(p.body);
  const imgs = imageCandidates(p.body);
  const parts = ['chapter ' + labelPath(d.chapter), 'CHAPTER HTTP ' + p.status, 'HTML chars ' + p.body.length,
    'external scripts ' + s.external.length, 'inline scripts ' + s.inline.length,
    'reader img URLs ' + imgs.length];
  for (const path of s.external.slice(0, 5)) parts.push('script ' + labelPath(path));
  parts.push(...pageClues(p.body).slice(0, 15));
  return rows(parts);
}
function apiClues(js: string): string[] {
  const found: string[] = [];
  const tokens = ['XMLHttpRequest', 'axios', 'fetch(', '/api/', '/ajax/', 'chapter', 'pages', 'image', 'reader', 'lazy'];
  for (const token of tokens) {
    const count = js.toLowerCase().split(token.toLowerCase()).length - 1;
    if (count) found.push(token + ' hits ' + count);
  }
  const re = /["'](\/(?:api|ajax|read|chapter|images?)[^"'<>\\\s]{0,95})["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) && found.length < 16) {
    const path = m[1].split('?')[0];
    found.push('route ' + labelPath(path));
  }
  return found;
}
async function commandScripts(): Promise<MangaSummary[]> {
  const d = await discover();
  const p = await get(d.chapter);
  const s = scriptTags(p.body);
  const parts = ['chapter ' + labelPath(d.chapter), 'external scripts ' + s.external.length, 'inline scripts ' + s.inline.length];
  for (const inline of s.inline.slice(0, 3)) {
    const tokens = apiClues(inline).slice(0, 4);
    if (tokens.length) parts.push('INLINE ' + tokens.join(' / '));
  }
  const ranked = s.external.slice().sort((a, b) => {
    const rank = (x: string) => /(?:reader|chapter|manga|scan|custom|app|main)/i.test(x) ? 1 : 0;
    return rank(b) - rank(a);
  });
  for (const path of ranked.slice(0, 3)) {
    try {
      const res = await get(path);
      parts.push('JS HTTP ' + res.status + ' ' + labelPath(path));
      parts.push('JS chars ' + res.body.length);
      parts.push(...apiClues(res.body).slice(0, 5));
    } catch (e) {
      parts.push('JS ERR ' + labelPath(path));
      parts.push(fail(e));
    }
  }
  return rows(parts);
}
async function commandImage(): Promise<MangaSummary[]> {
  const d = await discover();
  const p = await get(d.chapter);
  const imgs = imageCandidates(p.body);
  const parts = ['chapter ' + labelPath(d.chapter), 'image candidates ' + imgs.length];
  if (!imgs.length) return rows([...parts, 'No verified chapter image URL', 'No image request attempted']);
  const url = imgs[0];
  parts.push('image host ' + (url.match(/^https?:\/\/([^/]+)/i)?.[1] || '?'));
  parts.push('image path ' + labelPath(url.replace(/^https?:\/\/[^/]+/i, '')));
  try {
    const r = await harbor.http(url, { responseType: 'base64', timeoutMs: 8000, headers: { Accept: 'image/*,*/*' } });
    const hs: Record<string, string> = r?.headers || {};
    const type = Object.keys(hs).find(k => k.toLowerCase() === 'content-type');
    parts.push('IMAGE HTTP ' + r.status);
    parts.push('type ' + (type ? hs[type] : '?'));
    parts.push('body chars ' + String(r?.body || '').length);
  } catch (e) { parts.push('IMAGE ERR ' + fail(e)); }
  return rows(parts);
}
const plugin: MangaProvider = {
  id: 'probe-dreamscan3', name: 'Probe DreamScan FR v3',
  async popular(offset: number) {
    if (offset) return [];
    try { return await commandDiscover(); } catch (e) { return rows(['DISCOVER ERR ' + fail(e)]); }
  },
  async search(query: string, offset: number) {
    if (offset) return [];
    const q = String(query || '').trim().toLowerCase();
    try {
      if (!q || q === 'discover') return await commandDiscover();
      if (q === 'inspect') return await commandInspect();
      if (q === 'scripts') return await commandScripts();
      if (q === 'image') return await commandImage();
      return rows(['Search: discover / inspect', 'scripts / image']);
    } catch (e) { return rows(['ERR ' + q + ' ' + fail(e)]); }
  },
  async detail(id: string) { return { id, title: last.slice(0, 110) || 'DreamScan probe', description: last }; },
  async chapters(_id: string) { return []; },
  async pageUrls(_id: string) { return []; },
};
harbor.register(plugin);
