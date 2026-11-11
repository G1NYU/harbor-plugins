/**
 * OceComic - trial Harbor source for Western comics.
 * Grounded in supplied Battleworld Issue #1 HTML (28 direct reader images).
 * No cookies, browser emulation, external proxy or image rehosting.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://ocecomic.com';
const ID = 'ocecomic-com';
const PER_PAGE = 24;

function attr(tag: string, key: string): string {
  const re = new RegExp('(?:\\s|<)' + key + '\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]', 'i');
  return (re.exec(tag)?.[1] || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}
function clean(s: string): string {
  return String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}
function local(raw: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw, BASE);
    return url.protocol === 'https:' && url.hostname === 'ocecomic.com' ? url.pathname : '';
  } catch { return ''; }
}
function seriesFromPath(path: string): string {
  const m = /^\/comic\/(\d{2,12})\/([a-z][a-z0-9-]*)\/?$/i.exec(path);
  return m ? m[1] + '/' + m[2] : '';
}
function numericId(id: string): string {
  return /^(\d{2,12})(?:\/[a-z][a-z0-9-]*)?$/.exec(id)?.[1] || '';
}
function pageUrl(raw: string): string {
  try {
    const url = new URL(raw, BASE);
    if (url.protocol !== 'https:' || !/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(url.href)) return '';
    return url.href;
  } catch { return ''; }
}
function meta(html: string, name: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if ((attr(tag, 'property') || attr(tag, 'name')).toLowerCase() === name.toLowerCase()) return attr(tag, 'content');
  }
  return '';
}
function heading(html: string): string {
  return clean(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '');
}
function human(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
async function get(path: string): Promise<string> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid OceComic path');
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await harbor.http(BASE + path, {
        method: 'GET', responseType: 'text', timeoutMs: 12000,
        headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
      });
      const status = Number(r?.status || 0);
      const body = String(r?.body || '');
      if (status === 403 || /cf-challenge|challenge-platform|<title>\s*just a moment/i.test(body.slice(0, 20000))) {
        throw new Error('OceComic anti-bot / HTTP ' + status + ' at ' + path);
      }
      if (status === 200 && /<html\b/i.test(body)) return body;
      error = 'HTTP ' + status + (status === 200 ? ' (no HTML)' : '') + ' at ' + path;
      if (status === 404 || status === 401) break;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (/anti-bot|HTTP 40[134]/i.test(error)) break;
    }
  }
  throw new Error('OceComic ' + error);
}
function catalogue(html: string, query = ''): MangaSummary[] {
  const result: MangaSummary[] = [];
  const seen = new Set<string>();
  const needle = query.toLowerCase();
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const opening = /^<a\b[^>]*>/i.exec(m[0])?.[0] || '';
    const id = seriesFromPath(local(attr(opening, 'href')));
    if (!id || seen.has(id)) continue;
    const slug = id.split('/')[1];
    const title = clean(attr(opening, 'title') || m[0].slice(opening.length).replace(/<\/a>$/i, '')) ||
      clean(attr(/<img\b[^>]*>/i.exec(m[0])?.[0] || '', 'alt')) || human(slug);
    if (needle && !(title.toLowerCase().includes(needle) || slug.includes(needle.replace(/\s+/g, '-')))) continue;
    const img = /<img\b[^>]*>/i.exec(m[0])?.[0] || '';
    const cover = pageUrl(attr(img, 'data-src') || attr(img, 'src')) || undefined;
    seen.add(id);
    result.push({ id, title, cover });
  }
  return result;
}
function issueList(html: string, seriesId: string): MangaChapter[] {
  const found = new Map<string, MangaChapter>();
  const re = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const path = local(attr(m[0], 'href'));
    const issue = /^\/comic\/(\d{2,12})\/(\d+(?:\.\d+)?)\/?$/.exec(path);
    if (!issue || issue[1] !== seriesId || found.has(issue[2])) continue;
    found.set(issue[2], {
      id: issue[1] + '/' + issue[2], chapter: issue[2],
      title: 'Issue #' + issue[2], pages: 0, language: 'en',
    });
  }
  return [...found.values()].sort((a,b) => Number(b.chapter || 0) - Number(a.chapter || 0));
}
// Extract a balanced HTML div, not the entire article/sidebar, so that
// cover art, advertisements and other issues never appear as reader pages.
function reader(html: string): string {
  const opening = /<div\b[^>]*class\s*=\s*["'][^"']*\bpage\b[^"']*\bissue\b[^"']*["'][^>]*>/i.exec(html);
  if (!opening) return '';
  const start = opening.index + opening[0].length;
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 1, tag: RegExpExecArray | null;
  while ((tag = tags.exec(html))) {
    depth += /^<\/div/i.test(tag[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, tag.index);
  }
  return '';
}
function images(html: string): string[] {
  const section = reader(html);
  if (!section) return [];
  const out: string[] = [];
  for (const figure of section.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const img = /<img\b[^>]*>/i.exec(figure[1])?.[0] || '';
    const url = pageUrl(attr(img, 'data-src') || attr(img, 'src') || attr(img, 'data-original'));
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
function titleFromHtml(html: string, fallback: string): string {
  return clean(heading(html) || meta(html, 'og:title') || fallback)
    .replace(/\s*[-|]\s*OceComic\s*$/i, '')
    .replace(/\s*[-–]\s*Issue\s*#?\d+(?:\.\d+)?$/i, '');
}

const plugin: MangaProvider = {
  id: ID,
  name: 'OceComic [TEST]',
  async popular(offset: number) {
    const page = Math.max(1, Math.floor(Math.max(0, offset) / PER_PAGE) + 1);
    try {
      const entries = catalogue(await get('/comic' + (page > 1 ? '?page=' + page : '')));
      if (entries.length) return entries;
    } catch { /* The public index is a fallback, not a forged catalogue. */ }
    const all = catalogue(await get('/index'));
    return all.slice(Math.max(0, offset), Math.max(0, offset) + PER_PAGE);
  },
  async search(query: string, offset: number) {
    const q = String(query || '').trim();
    if (!q) return this.popular(offset);
    // The site has a POST search form. Its public A-Z index is GET-accessible,
    // so filter genuine linked series there without relying on browser forms.
    const all = catalogue(await get('/index'), q);
    return all.slice(Math.max(0, offset), Math.max(0, offset) + PER_PAGE);
  },
  async detail(id: string) {
    const series = numericId(id);
    if (!series) return null;
    let html = '';
    try { html = await get('/comic/' + id); }
    catch { html = await get('/comic/' + series + '/1'); }
    const slug = id.includes('/') ? id.split('/')[1] : 'Comic ' + series;
    const title = titleFromHtml(html, human(slug));
    const cover = pageUrl(meta(html, 'og:image')) || pageUrl(/<figure\b[^>]*>\s*<img\b[^>]*>/i.exec(html)?.[0] || '') || undefined;
    const description = clean(meta(html, 'og:description') || meta(html, 'description'));
    return { id, title, cover, description: description || undefined };
  },
  async chapters(id: string) {
    const series = numericId(id);
    if (!series) return [];
    let issues: MangaChapter[] = [];
    try { issues = issueList(await get('/comic/' + id), series); } catch { /* reader fallback */ }
    if (!issues.length) issues = issueList(await get('/comic/' + series + '/1'), series);
    return issues;
  },
  async pageUrls(chapterId: string) {
    const m = /^(\d{2,12})\/(\d+(?:\.\d+)?)$/.exec(chapterId);
    if (!m) return [];
    const html = await get('/comic/' + m[1] + '/' + m[2]);
    const pages = images(html);
    if (!pages.length) throw new Error('OceComic Issue #' + m[2] + ' has no reader pages; check live issue HTML');
    return pages;
  },
};
harbor.register(plugin);
