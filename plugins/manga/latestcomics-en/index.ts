/**
 * LatestComics EN — Harbor native western comics source (experimental).
 * Issue reader: server-rendered WordPress article with 001.jpeg ... images.
 * Series archive: MangaVerse AJAX pagination using public page category + nonce.
 * Based on user-supplied Amazing Spider-Man (1963), Issue #800 source (81 pages).
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://www.latestcomics.com';
const SITE = 'www.latestcomics.com';
const CDN = 'cdn.latestcomics.com';
const SOURCE_ID = 'latestcomics-en';
const PAGE_LIMIT = 36;

function decode(raw: string): string {
  return String(raw || '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_a, n: string) => {
      const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return v >= 32 && v <= 0x10ffff ? String.fromCodePoint(v) : '';
    })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_a, k: string) =>
      ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[k.toLowerCase() as 'amp'|'quot'|'apos'|'lt'|'gt'|'nbsp']);
}
function textOnly(fragment: string): string {
  return decode(String(fragment || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attr(tag: string, key: string): string {
  const quoted = new RegExp('(?:\\s|<)' + key + '\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]', 'i');
  const unquoted = new RegExp('(?:\\s|<)' + key + '\\s*=\\s*([^\\s>]+)', 'i');
  return decode(quoted.exec(tag)?.[1] || unquoted.exec(tag)?.[1] || '');
}
function sitePath(raw: string): string {
  try {
    if (!raw) return '';
    const u = new URL(raw, BASE);
    return u.protocol === 'https:' && (u.hostname === SITE || u.hostname === 'latestcomics.com')
      ? u.pathname : '';
  } catch { return ''; }
}
function seriesSlug(path: string): string {
  return /^\/en\/comic\/([a-z0-9][a-z0-9-]*)\.html\/?$/i.exec(path)?.[1] || '';
}
function issueId(raw: string, expectedSlug?: string): { id: string; number: string } | null {
  const path = sitePath(raw);
  const m = /^\/en\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)-issue-(\d+(?:[-.]\d+)?)\.html$/i.exec(path);
  if (!m || m[1] !== m[2] || (expectedSlug && m[1] !== expectedSlug)) return null;
  return { id: path, number: m[3].replace(/-/g, '.') };
}
function imageUrl(raw: string): string {
  try {
    const u = new URL(raw, BASE);
    if (u.protocol !== 'https:' || u.hostname !== CDN ||
      !u.pathname.startsWith('/cdn/') ||
      !/\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname)) return '';
    return u.href;
  } catch { return ''; }
}
function meta(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if ((attr(tag, 'property') || attr(tag, 'name')).toLowerCase() === key.toLowerCase()) {
      return attr(tag, 'content');
    }
  }
  return '';
}
function human(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function innerDiv(html: string, opener: RegExp): string {
  const root = opener.exec(html);
  if (!root) return '';
  const begin = root.index + root[0].length;
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = begin;
  let depth = 1, m: RegExpExecArray | null;
  while ((m = tags.exec(html))) {
    depth += /^<\/div/i.test(m[0]) ? -1 : 1;
    if (depth === 0) return html.slice(begin, m.index);
  }
  return '';
}
function firstImage(html: string): string | undefined {
  const match = /<img\b[^>]*>/i.exec(html)?.[0] || '';
  const value = attr(match, 'data-src') || attr(match, 'src');
  if (!value) return undefined;
  try {
    const u = new URL(value, BASE);
    return u.protocol === 'https:' && /^(?:www\.)?latestcomics\.com$/i.test(u.hostname) &&
      /\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname)
      ? u.href : undefined;
  } catch { return undefined; }
}
async function request(path: string, options?: { method: string; body: string }): Promise<string> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid LatestComics path');
  const url = BASE + path;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await harbor.http(url, {
        method: options?.method || 'GET',
        body: options?.body,
        responseType: 'text',
        timeoutMs: 12000,
        headers: {
          Accept: options ? 'application/json, */*' : 'text/html,application/xhtml+xml,*/*',
          ...(options ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
        },
      });
      const status = Number(r?.status || 0);
      const body = String(r?.body || '');
      if (status === 403 || /cf-challenge|challenge-platform|<title>\s*just a moment/i.test(body.slice(0, 20000))) {
        throw new Error('LatestComics HTTP ' + status + ' / anti-bot challenge at ' + path);
      }
      if (status === 200 && (options || /<html\b/i.test(body))) return body;
      lastError = 'HTTP ' + status + ' at ' + path;
      if (status === 400 || status === 401 || status === 404) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (/anti-bot challenge|HTTP 40[134]/.test(lastError)) break;
    }
  }
  throw new Error(lastError || 'LatestComics request failed: ' + path);
}
async function html(path: string): Promise<string> {
  return request(path);
}
function catalogueCover(fragment: string): string | undefined {
  // MangaVerse renders browse/search covers as a CSS background-image
  // on .series-card-thumb, not as an <img>. Respect the outer style
  // attribute's quote delimiter: url('...') appears inside style="...".
  for (const tag of fragment.match(/<div\b[^>]*>/gi) || []) {
    if (!attr(tag, 'class').split(/\s+/).includes('series-card-thumb')) continue;
    const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const css = style?.[1] || style?.[2] || '';
    const raw = /background(?:-image)?\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(css)?.[2];
    if (!raw) continue;
    try {
      const u = new URL(decode(raw), BASE);
      if (u.protocol === 'https:' &&
        /^(?:www\.)?latestcomics\.com$/i.test(u.hostname) &&
        u.pathname.startsWith('/wp-content/uploads/') &&
        /\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname)) return u.href;
    } catch { /* Not a valid image URL */ }
  }
  return undefined;
}
function catalogue(body: string): MangaSummary[] {
  const out: MangaSummary[] = [];
  const seen = new Set<string>();
  // The homepage contains featured "Read Now" links, and search pages
  // contain navigation links. Parse ONLY the actual series-card grid,
  // otherwise a titleless link gets recorded first with no cover.
  let grid = '';
  for (const tag of body.matchAll(/<div\b[^>]*>/gi)) {
    if (!attr(tag[0], 'class').split(/\s+/).includes('series-grid')) continue;
    grid = innerDiv(body.slice(tag.index), /^<div\b[^>]*>/i);
    break;
  }
  if (!grid) return out;
  const anchors = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchors.exec(grid))) {
    const opening = /^<a\b[^>]*>/i.exec(m[0])?.[0] || '';
    if (!attr(opening, 'class').split(/\s+/).includes('series-card-link')) continue;
    const slug = seriesSlug(sitePath(attr(opening, 'href')));
    if (!slug || seen.has(slug)) continue;
    const content = m[0].slice(opening.length).replace(/<\/a>$/i, '');
    const heading = /<h[2-4]\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-card-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[2-4]>/i.exec(content)?.[1] || '';
    const imgTag = /<img\b[^>]*>/i.exec(content)?.[0] || '';
    const title = textOnly(heading) || textOnly(attr(opening, 'title')) ||
      textOnly(attr(imgTag, 'alt')).replace(/\s+Cover Image$/i, '') || human(slug);
    const cover = catalogueCover(content) || firstImage(content);
    out.push({ id: slug, title, cover });
    seen.add(slug);
  }
  return out;
}
function chapterLinks(body: string, slug: string): MangaChapter[] {
  const out: MangaChapter[] = [];
  const seen = new Set<string>();
  for (const tag of body.match(/<a\b[^>]*>/gi) || []) {
    const issue = issueId(attr(tag, 'href'), slug);
    if (!issue || seen.has(issue.id)) continue;
    seen.add(issue.id);
    out.push({ id: issue.id, chapter: issue.number,
      title: 'Issue #' + issue.number, pages: 0, language: 'en' });
  }
  return out;
}
function merge(into: MangaChapter[], more: MangaChapter[]): void {
  const seen = new Set(into.map(x => x.id));
  for (const x of more) {
    if (!seen.has(x.id)) { into.push(x); seen.add(x.id); }
  }
}
function sortIssues(issues: MangaChapter[]): MangaChapter[] {
  return issues.sort((a, b) => Number(b.chapter || 0) - Number(a.chapter || 0));
}
function ajaxSettings(body: string): { nonce: string; category: string; count: number } | null {
  const nonce = /\bmangaverse_ajax\s*=\s*\{[\s\S]*?"nonce"\s*:\s*"([^"]+)"/i.exec(body)?.[1] || '';
  const category = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bchapters-list\b[^"']*["'][^>]*\bdata-category\s*=\s*["'](\d+)["']/i.exec(body)?.[1] ||
    /<div\b[^>]*\bdata-category\s*=\s*["'](\d+)["'][^>]*\bclass\s*=\s*["'][^"']*\bchapters-list\b/i.exec(body)?.[1] || '';
  const count = Number(/([\d,]+)\s+Chapters?\b/i.exec(body)?.[1]?.replace(/,/g, '') || 0);
  return nonce && category ? { nonce, category, count } : null;
}
async function archivePage(page: number, nonce: string, category: string): Promise<{ body: string; hasMore: boolean }> {
  const data = {
    action: 'mangaverse_load_more', nonce, page: String(page),
    type: 'series', category_id: category, order: 'desc', lang: 'en',
  };
  const form = Object.keys(data).map(key =>
    encodeURIComponent(key) + '=' + encodeURIComponent(data[key as keyof typeof data])).join('&');
  const raw = await request('/wp-admin/admin-ajax.php', { method: 'POST', body: form });
  const json = JSON.parse(raw) as {
    success?: boolean; data?: { html?: string; has_more?: boolean };
  };
  if (!json?.success || typeof json.data?.html !== 'string') {
    throw new Error('LatestComics issue pagination returned no valid HTML at page ' + page);
  }
  return { body: json.data.html, hasMore: !!json.data.has_more };
}
function readerImages(body: string): string[] {
  const content = innerDiv(body, /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bentry-content\b[^"']*["'][^>]*>/i);
  if (!content) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const fig of content.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const tag = /<img\b[^>]*>/i.exec(fig[1])?.[0] || '';
    // Lazy-loaded data-src is the real image. src is only a 1x1 GIF stub.
    const url = imageUrl(attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'src'));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

// Catalogue cards use CSS thumbnails, whereas the detail page uses a
// conventional <img>. Harbor's detail view loads that image successfully.
// Resolve each visible result through the detail cover path so browse/search
// don't depend on CSS thumbnail parsing or WordPress resized-image variants.
const detailCoverCache = new Map<string, string>();
async function detailCover(id: string): Promise<string | undefined> {
  const previous = detailCoverCache.get(id);
  if (previous) return previous;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return undefined;
  try {
    const body = await html('/en/comic/' + id + '.html');
    const section = innerDiv(body,
      /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-header-thumbnail\b[^"']*["'][^>]*>/i);
    const resolved = firstImage(section);
    if (resolved) detailCoverCache.set(id, resolved);
    return resolved;
  } catch (error) {
    harbor.log('LatestComics cover lookup: ' + id + ' — ' +
      (error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}
async function catalogueWithDetailCovers(rows: MangaSummary[]): Promise<MangaSummary[]> {
  const results = [...rows];
  // Limit concurrent connections to this WordPress origin; avoid blocking
  // the entire catalogue when an individual cover request times out.
  for (let start = 0; start < results.length; start += 5) {
    const part = results.slice(start, start + 5);
    const covers = await Promise.all(part.map(item => detailCover(item.id)));
    covers.forEach((cover, index) => {
      if (cover) results[start + index] = { ...part[index], cover };
    });
  }
  harbor.log('LatestComics covers: ' +
    results.filter(item => !!item.cover).length + '/' + results.length);
  return results;
}

const plugin: MangaProvider = {
  id: SOURCE_ID,
  name: 'LatestComics EN [TEST]',
  async popular(offset: number) {
    const all = catalogue(await html('/en/'));
    return catalogueWithDetailCovers(all.slice(Math.max(0, offset), Math.max(0, offset) + PAGE_LIMIT));
  },
  async search(query: string, offset: number) {
    const q = String(query || '').trim();
    if (!q) return this.popular(offset);
    let found: MangaSummary[] = [];
    try {
      found = catalogue(await html('/en/?s=' + encodeURIComponent(q) + '&lang=en'));
    } catch { /* Use the real catalogue as a local search fallback. */ }
    if (!found.length) {
      const needle = q.toLowerCase();
      found = catalogue(await html('/en/')).filter(x => x.title.toLowerCase().includes(needle) ||
        x.id.replace(/-/g, ' ').includes(needle));
    }
    return catalogueWithDetailCovers(found.slice(Math.max(0, offset), Math.max(0, offset) + PAGE_LIMIT));
  },
  async detail(id: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
    const body = await html('/en/comic/' + id + '.html');
    const heading = /<h1\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] || '';
    const title = textOnly(heading) || human(id);
    const coverSection = innerDiv(body, /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-header-thumbnail\b[^"']*["'][^>]*>/i);
    const cover = firstImage(coverSection) || undefined;
    if (cover) detailCoverCache.set(id, cover);
    const description = textOnly(innerDiv(body,
      /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-description\b[^"']*["'][^>]*>/i));
    return { id, title, cover, description: description || undefined };
  },
  async chapters(id: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return [];
    const body = await html('/en/comic/' + id + '.html');
    const first = chapterLinks(body, id);
    const cfg = ajaxSettings(body);
    if (!first.length || !cfg) return sortIssues(first);
    // The public HTML contains only the first 30 of up to 701+ issues.
    // Use the *site's own* load-more action; do not invent numbered URLs.
    // Bound requests and group them for reasonable Harbor response times.
    const pages = Math.min(50, Math.ceil(cfg.count / first.length));
    if (pages <= 1) return sortIssues(first);
    for (let start = 2; start <= pages; start += 5) {
      const batch = Array.from({ length: Math.min(5, pages - start + 1) },
        (_, i) => start + i);
      const results = await Promise.all(batch.map(async page => {
        try { return await archivePage(page, cfg.nonce, cfg.category); }
        catch (e) {
          harbor.log('LatestComics archive page ' + page + ': ' +
            (e instanceof Error ? e.message : String(e)));
          return null;
        }
      }));
      results.forEach(result => { if (result) merge(first, chapterLinks(result.body, id)); });
      if (results.every(result => result && !result.hasMore)) break;
    }
    return sortIssues(first);
  },
  async pageUrls(chapterId: string) {
    const issue = issueId(chapterId);
    if (!issue || issue.id !== chapterId) return [];
    const body = await html(chapterId);
    const pages = readerImages(body);
    if (!pages.length) throw new Error('LatestComics: no real reader images in ' + chapterId);
    return pages;
  },
};
harbor.register(plugin);
