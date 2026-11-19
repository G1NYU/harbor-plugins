/**
 * Atsumaru native MangaProvider for Harbor.
 *
 * Endpoint conventions adapted from the MIT-licensed Seanime providers:
 * https://github.com/Seanime-contributions/Seanime-Providers
 * https://github.com/trashpenguin/seanime-extensions
 *
 * Unlike the old Paperback compatibility layer, this provider makes direct
 * JSON requests through Harbor's supported HTTP bridge. The site endpoints
 * are undocumented and may change. No cookie or anti-bot circumvention.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://atsu.moe';
const CDN = 'https://cdn.atsu.moe';
const PAGE_SIZE = 20;
const ID_PATTERN = /^[a-z0-9_-]{1,100}$/i;
const HEADER = {
  Accept: 'application/json',
  Referer: BASE + '/',
};
const cache = new Map<string, MangaSummary>();

interface AtsuDocument {
  id?: string;
  title?: string;
  englishTitle?: string;
  synopsis?: string;
  description?: string;
  posterMedium?: string;
  poster?: string;
  releaseYear?: number;
  authors?: string[];
  status?: string;
  chapterCount?: number;
}

function validId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error('Atsumaru: invalid series or chapter ID');
  return id;
}

function imageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const url = raw.trim();
  if (!url) return undefined;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return CDN + url;
  if (/^https?:\/\//i.test(url)) return url;
  return undefined;
}

async function requestJSON(url: string): Promise<any> {
  const response = await harbor.http(url, {
    responseType: 'text', timeoutMs: 18000, headers: HEADER,
  });
  if (response.status !== 200) throw new Error('Atsumaru HTTP ' + response.status);
  if (typeof response.body !== 'string' || !response.body.trim().startsWith('{')) {
    throw new Error('Atsumaru: expected JSON, received unexpected page');
  }
  try { return JSON.parse(response.body); }
  catch { throw new Error('Atsumaru: invalid JSON response'); }
}

function summary(doc: AtsuDocument): MangaSummary | null {
  const id = String(doc.id || '');
  if (!ID_PATTERN.test(id) || !doc.title) return null;
  const item: MangaSummary = {
    id,
    title: doc.englishTitle || doc.title,
    cover: imageUrl(doc.posterMedium || doc.poster),
    description: doc.synopsis || doc.description || undefined,
    year: Number.isFinite(doc.releaseYear) ? doc.releaseYear : undefined,
    author: Array.isArray(doc.authors) ? doc.authors.filter(x => typeof x === 'string').join(', ') : undefined,
    status: doc.status || undefined,
  };
  return item;
}

async function searchList(query: string, offset: number): Promise<MangaSummary[]> {
  const page = Math.floor(Math.max(0, Number(offset) || 0) / PAGE_SIZE) + 1;
  const url = BASE + '/collections/manga/documents/search?' +
    'q=' + encodeURIComponent(query.trim() || '*') +
    '&query_by=title%2CenglishTitle%2CotherNames' +
    '&page=' + page + '&per_page=' + PAGE_SIZE;
  const data = await requestJSON(url);
  if (!Array.isArray(data?.hits)) throw new Error('Atsumaru: search results missing');
  const items: MangaSummary[] = [];
  const seen = new Set<string>();
  for (const hit of data.hits) {
    const item = summary(hit?.document || {});
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      cache.set(item.id, item);
      items.push(item);
    }
  }
  return items;
}

const plugin: MangaProvider = {
  id: 'atsumaru',
  name: 'Atsumaru',
  async popular(offset: number) { return searchList('*', offset); },
  async search(query: string, offset: number) { return searchList(query, offset); },
  async detail(id: string) {
    validId(id);
    // The search JSON already provides catalogue details. Never fetch the
    // protected HTML manga page just to fill optional metadata fields.
    return cache.get(id) || { id, title: id };
  },
  async chapters(id: string) {
    validId(id);
    const data = await requestJSON(BASE + '/api/manga/allChapters?mangaId=' + encodeURIComponent(id));
    if (!Array.isArray(data?.chapters)) throw new Error('Atsumaru: chapters missing');
    const seen = new Set<string>();
    const chapters: MangaChapter[] = [];
    for (const c of data.chapters) {
      const chapterId = String(c?.id || '');
      const chapterNum = Number(c?.number);
      if (!ID_PATTERN.test(chapterId) || c?.number == null || !Number.isFinite(chapterNum) || seen.has(chapterId)) continue;
      seen.add(chapterId);
      chapters.push({
        id: id + '::' + chapterId,
        chapter: String(c.number),
        title: typeof c.title === 'string' ? c.title : 'Chapter ' + c.number,
        pages: Number.isFinite(c.pageCount) ? Math.max(0, Math.floor(c.pageCount)) : 0,
        language: 'en',
      });
    }
    chapters.sort((a, b) => Number(a.chapter) - Number(b.chapter));
    return chapters;
  },
  async pageUrls(chapterId: string) {
    const parts = chapterId.split('::');
    if (parts.length !== 2) throw new Error('Atsumaru: invalid composite chapter ID');
    const mangaId = validId(parts[0]);
    const id = validId(parts[1]);
    const data = await requestJSON(BASE + '/api/read/chapter?mangaId=' +
      encodeURIComponent(mangaId) + '&chapterId=' + encodeURIComponent(id));
    if (!Array.isArray(data?.readChapter?.pages)) throw new Error('Atsumaru: reader pages missing');
    const seen = new Set<string>();
    const pages: string[] = [];
    for (const row of [...data.readChapter.pages].sort((a, b) => Number(a.number) - Number(b.number))) {
      const url = imageUrl(row?.image);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pages.push(url);
    }
    if (!pages.length) throw new Error('Atsumaru: reader returned zero images');
    return pages;
  },
};

harbor.register(plugin);
