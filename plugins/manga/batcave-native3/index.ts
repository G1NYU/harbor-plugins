/**
 * BatCave Native v3 — Harbor testing source (no Paperback or Suwayomi runtime).
 *
 * Uses BatCave's public HTML for search/catalogue and the same chapter AJAX
 * endpoint used by Mihon/Paperback. The site requires its DLE Guard browser
 * session: the user must first unlock BatCave in Harbor's native WebView.
 * This is experimental and NOT verified end-to-end in Harbor.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://batcave.biz';
const API = '/engine/ajax/controller.php?mod=api&action=reader/getChapterData';
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json,*/*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};
let lastError = '';

function err(e: unknown): string { return String((e as Error)?.message || e).slice(0, 160); }
function diagnostics(message: string): MangaSummary[] {
  lastError = message;
  const out: MangaSummary[] = [];
  for (let i = 0; i < message.length && out.length < 12; i += 35)
    out.push({ id: 'error-' + out.length, title: message.slice(i, i + 35) });
  return out;
}
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
    throw new Error('HTTP ' + status + ': BatCave guard. Unlock BatCave using the globe button in Harbor Extensions.');
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
    list.push({ id, title, cover: cover || BASE + '/uploads/posts/hd/' + (id.match(/^\/(\d+)/) || [,''])[1] + '.webp' });
  }
  return list;
}
function chapterData(source: string): any {
  const m = /window\.__DATA__\s*=\s*(\{[\s\S]*?\})\s*;/i.exec(source);
  if (!m) throw new Error('No window.__DATA__ chapter list in BatCave HTML');
  try { return JSON.parse(m[1]); }
  catch { throw new Error('BatCave chapter JSON malformed'); }
}
function parseImages(response: string): string[] {
  let json: any;
  try { json = JSON.parse(response); } catch { throw new Error('BatCave chapter API did not return JSON'); }
  if (json?.success === false) throw new Error('BatCave chapter API rejected request');
  const images: unknown[] = Array.isArray(json?.data?.images) ? json.data.images : [];
  const urls: string[] = [];
  for (const item of images) {
    const raw = typeof item === 'string' ? item : typeof item === 'object' && item ? (item as any).url : '';
    const url = abs(String(raw || ''));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
function ids(chapterId: string): { newsId: string; chapterId: string } {
  const m = /^\/?reader\/(\d+)\/(\d+)(?:[/?#]|$)/i.exec(chapterId);
  if (!m) throw new Error('Invalid BatCave reader chapter ID');
  return { newsId: m[1], chapterId: m[2] };
}
const plugin: MangaProvider = {
  id: 'batcave-native3',
  name: 'BatCave Native v3 (WebView test)',

  async popular(offset: number) {
    if (offset > 0) return [];
    try { return await seriesList(await html('/comix/')); }
    catch (e) { return diagnostics('ERR popular: ' + err(e)); }
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (!q) return this.popular(0);
    try { return await seriesList(await html('/search/' + encodeURIComponent(q) + '/')); }
    catch (e) { return diagnostics('ERR search: ' + err(e)); }
  },

  async detail(id: string) {
    if (id.startsWith('error-')) return { id, title: lastError, description: lastError };
    if (!seriesId(BASE + id)) return null;
    try {
      const source = await html(id);
      const doc = await harbor.parseHtml(source);
      const title = cleanTitle(doc.querySelector('header.page__header h1')?.text() || meta(source, 'og:title') || id);
      const image = doc.querySelector('.page__poster img');
      const cover = abs(image?.attr('src') || '') || abs(meta(source, 'og:image'));
      const description = cleanTitle(doc.querySelector('div.page__text')?.text() || meta(source, 'og:description') || '');
      return { id, title, cover: cover || undefined, description: description || undefined };
    } catch (e) {
      return { id, title: 'ERR detail: ' + err(e), description: err(e) };
    }
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
    } catch (e) {
      return [{ id: id + '#debug', chapter: null, title: 'ERR chapters: ' + err(e), pages: 0, language: 'en' }];
    }
  },

  async pageUrls(chapterId: string) {
    if (chapterId.endsWith('#debug')) return [];
    const { newsId, chapterId: cid } = ids(chapterId);
    const payload = JSON.stringify({ news_id: newsId, chapter_id: cid });
    let r = await request(BASE + API, { method: 'POST', body: payload,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
    let pages = parseImages(String(r.body || ''));
    // Paperback's version of the AJAX endpoint uses form data; try it if JSON
    // succeeded but returned no pages, rather than fabricating page URLs.
    if (!pages.length) {
      const body = 'news_id=' + encodeURIComponent(newsId) + '&chapter_id=' + encodeURIComponent(cid);
      r = await request(BASE + API, { method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
      pages = parseImages(String(r.body || ''));
    }
    if (!pages.length) throw new Error('0 BatCave chapter images after native API request');
    return pages;
  },
};
harbor.register(plugin);
