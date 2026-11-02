/**
 * TooComic FR / Harbor compatibility probe v1.
 * Source under test: the exact chapter link supplied by the user.
 * No assumption about site CMS, catalogue, HTML selectors or reader engine.
 * Diagnostics only; does NOT publish a working chapter reader.
 *
 * Browse: chapter HTML + reader/image indications.
 * Search "image": test a likely actual chapter image via plain harbor.http.
 * Search "chapter": list chapter indicators and candidate image hosts.
 * Search "series": test parent path (heuristic, not established series URL).
 * Search "home": homepage HTTP and sample manga links.
 * Search "inspect": image attribute and inline script diagnostics.
 */
import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const ROOT = 'https://www.toocomic.com';
const PATH = '/fr/101%E1%B5%89-confession-fr/101%E1%B5%89-confession-fr-chapitre-37.html';
const PARENT = '/fr/101%E1%B5%89-confession-fr/';
const HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,*/*',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
};
let lastMessage = '';

type Page = { status: number; body: string; headers: Record<string, string> };
type Candidate = { url: string; score: number; reason: string };

const errText = (e: unknown): string => String((e as Error)?.message || e).slice(0, 160);

function report(parts: string[]): MangaSummary[] {
  lastMessage = parts.join(' | ');
  const out: MangaSummary[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length && out.length < 24; i += 34) {
      out.push({ id: 'too-diag-' + out.length, title: part.slice(i, i + 34) });
    }
  }
  return out;
}

function decode(s: string): string {
  return s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'").replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\\u002[fF]/g, '/').replace(/\\u003[aA]/g, ':')
    .replace(/\\u0026/g, '&').replace(/\\\//g, '/');
}
function absolute(s: string): string {
  const v = decode(String(s || '').trim());
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return 'https:' + v;
  if (v.startsWith('/')) return ROOT + v;
  return '';
}
function domain(s: string): string { return /^https?:\/\/([^/]+)/i.exec(s)?.[1] || '?'; }
function attr(tag: string, key: string): string {
  const re = new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]*)"|\x27([^\x27]*)\x27)', 'i');
  const m = re.exec(tag);
  return m ? decode(m[1] ?? m[2] ?? '') : '';
}
function imageLike(u: string): boolean {
  return /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(u)
    || /\/(?:image|images|page|pages|chapter|chapters|upload|uploads)\//i.test(u);
}
function isSiteArt(u: string): boolean {
  return /(?:favicon|logo|avatar|icon|sprite|emoji|banner|\/assets?\/|\/covers?\/|\/thumb(?:nails)?\/|\.svg(?:[?#]|$))/i.test(u);
}
function add(candidates: Candidate[], raw: string, score: number, reason: string): void {
  const url = absolute(raw);
  if (!url || !imageLike(url) || isSiteArt(url)) return;
  const existing = candidates.find(c => c.url === url);
  if (existing) {
    if (score > existing.score) { existing.score = score; existing.reason = reason; }
  } else if (candidates.length < 200) {
    candidates.push({ url, score, reason });
  }
}
function imageCandidates(html: string): { imgs: Candidate[]; htmlTags: number; scriptTags: number; arrays: number } {
  const found: Candidate[] = [];
  const tags = html.match(/<(?:img|source)\b[^>]*>/gi) || [];
  const readerMarker = /(?:chapter-content|reading-content|chapter-image|page-chapter|readerarea|reader-content|chapter-reader|reading-area)/i;
  const readerAt = html.search(readerMarker);
  for (const item of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = item[0];
    const label = [attr(tag, 'alt'), attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'data-page')].join(' ');
    const numbered = /(?:page|planche)\s*[-#:]*\s*\d+\b/i.test(label);
    const isReader = /(?:chapter|reader|reading|page-img|scan-page|page-chapter)/i.test(label);
    const nearReader = readerAt >= 0 && item.index >= readerAt && item.index < readerAt + 120000;
    const score = numbered ? 95 : isReader ? 85 : nearReader ? 64 : 20;
    for (const k of ['data-src', 'data-lazy-src', 'data-original', 'data-image', 'data-url', 'src']) {
      const url = attr(tag, k);
      if (url) add(found, url, score, k + ' ' + label.slice(0, 16));
    }
    for (const k of ['srcset', 'data-srcset']) {
      const list = attr(tag, k);
      if (list) for (const src of list.split(',').map(s => s.trim().split(/\s+/)[0])) add(found, src, score, 'srcset');
    }
  }
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  let arrays = 0;
  // Look for named arrays embedded in inline JS, without requiring DOM globals.
  const re = /(?:chapter_images|chapterImages|chapterPages|chapter_pages|pageUrls|pages|images)\s*["']?\s*[:=]\s*\[/gi;
  const normalized = decode(html);
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null && arrays < 20) {
    arrays++;
    const start = re.lastIndex;
    const end = normalized.indexOf(']', start);
    if (end < 0 || end - start > 150000) continue;
    const str = normalized.slice(start, end);
    for (const link of str.matchAll(/["']((?:(?:https?:)?\/\/|\/)[^"'<>\s]{5,350})["']/g)) {
      add(found, link[1], 82, 'script array');
    }
  }
  // Last resort: discover image URLs in scripts (low confidence unless close to a reader term).
  const matches = normalized.match(/https?:\/\/[^\s"'<>\\]{8,320}?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>\\]*)?/gi) || [];
  for (const link of matches.slice(0, 150)) {
    const at = normalized.indexOf(link);
    const context = normalized.slice(Math.max(0, at - 160), at);
    add(found, link, /(?:reader|chapter|(?:page|image)\s*[:=])/i.test(context) ? 70 : 15, 'embedded URL');
  }
  found.sort((a, b) => b.score - a.score);
  return { imgs: found, htmlTags: tags.length, scriptTags: scripts.length, arrays };
}
async function get(path: string): Promise<Page> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Unexpected path');
  const r = await harbor.http(ROOT + path, { responseType: 'text', timeoutMs: 7000, headers: HEADERS });
  return { status: Number(r?.status ?? 0), body: String(r?.body ?? ''), headers: r?.headers || {} };
}
function summary(p: Page): string[] {
  const found = imageCandidates(p.body);
  const parts = [
    'CHAPTER HTTP ' + p.status, 'HTML chars ' + p.body.length,
    'img/source tags ' + found.htmlTags, 'script tags ' + found.scriptTags,
    'image arrays ' + found.arrays, 'image candidates ' + found.imgs.length,
    'strong candidates ' + found.imgs.filter(x => x.score >= 60).length,
  ];
  if (p.status === 403 || p.status === 503) {
    parts.push('Challenge/denial suspected');
    parts.push('Cloudflare ' + (/cloudflare|cf-chl|challenge-platform/i.test(p.body) ? 'mentioned' : 'not detected'));
  }
  const top = found.imgs.filter(x => x.score >= 60).slice(0, 2);
  for (const img of top) {
    parts.push('candidate ' + img.score + ' ' + img.reason.slice(0, 16));
    parts.push('host ' + domain(img.url));
    parts.push('image path ' + img.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 90));
  }
  if (!top.length) parts.push('No confident page image found');
  return parts;
}
async function chapter(testImage = false): Promise<MangaSummary[]> {
  const p = await get(PATH);
  const parts = summary(p);
  if (!testImage || p.status !== 200) return report(parts);
  const img = imageCandidates(p.body).imgs.find(x => x.score >= 60);
  if (!img) return report([...parts, 'IMAGE not attempted (no page URL)']);
  try {
    // Plain Harbor HTTP, no cookie/referer or proxy. Test image origin as is.
    const r = await harbor.http(img.url, { responseType: 'base64', timeoutMs: 7000, headers: { Accept: 'image/*,*/*' } });
    const h: Record<string, string> = r?.headers || {};
    const key = Object.keys(h).find(x => x.toLowerCase() === 'content-type');
    const type = key ? String(h[key]) : '?';
    parts.push('IMAGE HTTP ' + Number(r?.status ?? 0));
    parts.push('content type ' + type);
    parts.push('body chars ' + String(r?.body || '').length);
    parts.push('is image ' + (type.toLowerCase().startsWith('image/') ? 'yes' : 'unconfirmed'));
  } catch (e) { parts.push('IMAGE ERR ' + errText(e)); }
  return report(parts);
}
async function home(): Promise<MangaSummary[]> {
  const p = await get('/fr/');
  const paths: string[] = [];
  for (const tag of p.body.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (/^\/fr\//i.test(href) && !paths.includes(href)) paths.push(href);
    if (paths.length >= 3) break;
  }
  return report(['HOME HTTP ' + p.status, 'HTML chars ' + p.body.length, 'FR links found ' + paths.length,
    ...paths.map(x => 'link ' + x.slice(0, 90))]);
}
async function series(): Promise<MangaSummary[]> {
  const p = await get(PARENT);
  const matches = (p.body.match(/href=["'][^"']*chapitre[^"']*["']/gi) || []);
  return report(['GUESSED PARENT URL', 'SERIES HTTP ' + p.status, 'HTML chars ' + p.body.length,
    'chapter link matches ' + matches.length, 'first ' + (matches[0] || '(none)').slice(0, 95)]);
}
async function inspect(): Promise<MangaSummary[]> {
  const p = await get(PATH);
  const html = p.body;
  const parts = ['CHAPTER HTTP ' + p.status, 'HTML chars ' + html.length];
  for (const word of ['readerarea', 'chapter-content', 'reading-content', 'page-chapter', 'ts_reader', 'data-src', 'srcset', 'images', 'pages', 'Cloudflare']) {
    const count = html.toLowerCase().split(word.toLowerCase()).length - 1;
    parts.push(word + ' ' + count);
  }
  const scripts = html.match(/<script\b[^>]*>/gi) || [];
  parts.push('script tags ' + scripts.length);
  for (const tag of scripts.slice(0, 3)) {
    parts.push('script src ' + (attr(tag, 'src') || '(inline)').slice(0, 75));
  }
  return report(parts);
}
const plugin: MangaProvider = {
  id: 'probe-toocomic1', name: 'Probe TooComic FR v1',
  async popular(offset: number) {
    if (offset > 0) return [];
    try { return await chapter(); } catch (e) { return report(['CHAPTER ERR ' + errText(e)]); }
  },
  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').toLowerCase().trim();
    try {
      if (!q || q === 'chapter') return await chapter();
      if (q === 'image') return await chapter(true);
      if (q === 'home') return await home();
      if (q === 'series') return await series();
      if (q === 'inspect') return await inspect();
      return report(['Use image, chapter, home,', 'series, or inspect']);
    } catch (e) { return report(['ERR ' + q + ' ' + errText(e)]); }
  },
  async detail(id: string) { return { id, title: 'TooComic diagnostics', description: lastMessage }; },
  async chapters(_id: string) { return []; },
  async pageUrls(_id: string) { return []; },
};
harbor.register(plugin);
