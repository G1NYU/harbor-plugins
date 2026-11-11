/**
 * BatCave Native v3 — Harbor testing source (no Paperback or Suwayomi runtime).
 *
 * Uses BatCave's public HTML for search/catalogue. Pages are extracted
 * directly from each /reader/... HTML's __DATA__. The BatCave AJAX endpoint
 * remains a secondary fallback for older HTML variants. This is experimental
 * and NOT verified end-to-end in Harbor (DLE session handoff still required).
 *
 * Reference: Kotatsu-Redo/kotatsu-parsers-redo/.../site/en/BatCave.kt
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://batcave.biz';
const API = '/engine/ajax/controller.php?mod=api&action=reader/getChapterData';
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json,*/*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};
function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function unescape(raw: string): string {
  return String(raw || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function abs(raw: string): string {
  const u = unescape(raw).trim().replace(/\\\//g, '/');
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return BASE + u;
  return '';
}
function path(raw: string): string {
  const url = abs(raw);
  if (!url.startsWith(BASE + '/')) return '';
  return url.slice(BASE.length).split('?')[0].split('#')[0];
}
async function request(url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<any> {
  const r = await harbor.http(url, {
    responseType: 'text', method: opts?.method || 'GET', body: opts?.body,
    timeoutMs: 12000, headers: { ...HEADERS, ...(opts?.headers || {}) },
  });
  const status = Number(r?.status ?? 0);
  const body = String(r?.body || '');
  if (status === 403 || /(?:just a moment|cf-challenge|\/_c\b|pow_nonce)/i.test(body.slice(0, 1500)))
    throw new Error('HTTP ' + status + ': BatCave DLE Guard not cleared. Open the source WebView and retry.');
  if (status !== 200) throw new Error('HTTP ' + status + ' at ' + url.slice(0, 120));
  return r;
}
async function html(pathname: string): Promise<string> {
  return String((await request(BASE + pathname)).body || '');
}
function meta(source: string, key: string): string {
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const prop = (/\b(?:property|name)=["']([^"']+)/i.exec(tag) || [])[1];
    if (prop?.toLowerCase() !== key.toLowerCase()) continue;
    return unescape((/\bcontent=["']([^"']*)/i.exec(tag) || [])[1] || '');
  }
  return '';
}
function cleanTitle(s: string): string { return unescape(s.replace(/\s+/g, ' ').trim()); }
function seriesId(href: string): string {
  const value = path(href);
  return /^\/\d+-[^/?#]+\.html$/i.test(value) ? value : '';
}
async function seriesList(source: string): Promise<MangaSummary[]> {
  const doc = await harbor.parseHtml(source);
  const list: MangaSummary[] = [];
  const seen = new Set<string>();
  for (const box of doc.querySelectorAll('#dle-content .readed')) {
    const anchor = box.querySelector('.readed__title a');
    if (!anchor) continue;
    const id = seriesId(anchor.attr('href') || '');
    const title = cleanTitle(anchor.text());
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const coverEl = box.querySelector('.readed__img img');
    const cover = coverEl ? abs(coverEl.attr('data-src') || coverEl.attr('src') || '') : '';
    list.push({ id, title, cover: cover || undefined });
  }
  return list;
}
function chapterData(source: string): any {
  const marker = /(?:window\.)?__DATA__\s*=\s*/i.exec(source);
  if (!marker) throw new Error('No BatCave chapter data in HTML');
  let start = marker.index + marker[0].length;
  while (/\s/.test(source[start] || '')) start++;
  if (source[start] !== '{') throw new Error('BatCave chapter data is not a JSON object');
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); }
        catch { throw new Error('BatCave chapter data JSON malformed'); }
      }
    }
  }
  throw new Error('BatCave chapter data JSON incomplete');
}
function imagesFromData(data: any): string[] {
  // Kotatsu's BatCave reader exposes a top-level __DATA__.images array;
  // the older AJAX endpoint wraps the same images under data.images.
  const raw = Array.isArray(data?.images)
    ? data.images : Array.isArray(data?.data?.images) ? data.data.images : [];
  const urls: string[] = [];
  for (const item of raw) {
    const entry = typeof item === 'string' ? item
      : item && typeof item === 'object' ? String(item.url || item.src || '') : '';
    const url = abs(entry);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
function parseImages(response: string): string[] {
  let json: any;
  try { json = JSON.parse(response); }
  catch { throw new Error('BatCave chapter API did not return JSON'); }
  if (json?.success === false) throw new Error('BatCave chapter API rejected request');
  return imagesFromData(json);
}
function ids(chapterId: string): { newsId: string; chapterId: string } {
  const m = /^\/?reader\/(\d+)\/(\d+)(?:[/?#]|$)/i.exec(chapterId);
  if (!m) throw new Error('Invalid BatCave reader chapter ID');
  return { newsId: m[1], chapterId: m[2] };
}
const plugin: MangaProvider = {
  id: 'batcave-native3',
  name: 'BatCave Native v3 (reader-first test)',

  async popular(offset: number) {
    if (offset > 0) return [];
    const body = 'dlenewssortby=rating&dledirection=desc&set_new_sort=dle_sort_cat_1&set_direction_sort=dle_direction_cat_1';
    const response = await request(BASE + '/comix/', { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return seriesList(String(response.body || ''));
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (!q) return this.popular(0);
    return seriesList(await html('/search/' + encodeURIComponent(q) + '/'));
  },

  async detail(id: string) {
    if (!seriesId(BASE + id)) return null;
    try {
      const source = await html(id);
      const doc = await harbor.parseHtml(source);
      const title = cleanTitle(doc.querySelector('header.page__header h1')?.text() || meta(source, 'og:title') || id);
      const image = doc.querySelector('.page__poster img');
      const cover = abs(image?.attr('src') || '') || abs(meta(source, 'og:image'));
      const description = cleanTitle(doc.querySelector('div.page__text')?.text() || meta(source, 'og:description') || '');
      return { id, title, cover: cover || undefined, description: description || undefined };
    } catch (e) { throw new Error('BatCave details: ' + errorText(e)); }
  },

  async chapters(id: string) {
    if (!seriesId(BASE + id)) return [];
    try {
      const data = chapterData(await html(id));
      const newsId = String(data.news_id ?? /^\/(\d+)/.exec(id)?.[1] ?? '');
      if (!/^\d+$/.test(newsId)) throw new Error('No comic ID');
      const chapters: MangaChapter[] = [];
      for (const ch of Array.isArray(data.chapters) ? data.chapters : []) {
        const num = String(ch.posi ?? ch.number ?? '');
        const cid = String(ch.id || '');
        if (!/^\d+$/.test(cid)) continue;
        chapters.push({ id: '/reader/' + newsId + '/' + cid,
          chapter: num || null, title: cleanTitle(String(ch.title || 'Issue ' + num)),
          pages: 0, language: 'en' });
      }
      if (!chapters.length) throw new Error('0 chapters in __DATA__');
      return chapters.sort((a, b) => Number(b.chapter || 0) - Number(a.chapter || 0));
    } catch (e) { throw new Error('BatCave chapters: ' + errorText(e)); }
  },

  async pageUrls(chapterId: string) {
    const { newsId, chapterId: cid } = ids(chapterId);
    // Kotatsu-Redo reads the images straight from the chapter's own HTML.
    // This avoids depending on a second guarded AJAX request when possible.
    let readerFailure = '';
    try {
      const source = await html('/reader/' + newsId + '/' + cid);
      const pages = imagesFromData(chapterData(source));
      if (pages.length) return pages;
      readerFailure = 'reader HTML returned no images';
    } catch (e) {
      readerFailure = errorText(e);
    }

    // Fallback for sites/versions where images are only served via AJAX.
    // Mihon uses JSON, while Paperback uses URL-encoded POST data.
    let apiFailure = '';
    for (const isJson of [true, false]) {
      try {
        const body = isJson
          ? JSON.stringify({ news_id: newsId, chapter_id: cid })
          : 'news_id=' + encodeURIComponent(newsId) + '&chapter_id=' + encodeURIComponent(cid);
        const response = await request(BASE + API, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': isJson
              ? 'application/json' : 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        });
        const pages = parseImages(String(response.body || ''));
        if (pages.length) return pages;
        apiFailure = 'API returned zero images';
      } catch (e) {
        apiFailure = errorText(e);
      }
    }
    throw new Error('BatCave chapter unavailable: reader ' + readerFailure + '; API ' + apiFailure);
  },
};
harbor.register(plugin);
