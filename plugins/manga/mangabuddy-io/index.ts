/**
 * MangaBuddy (mangak.io) for Harbor.
 *
 * Written for Harbor from scratch. The site's endpoints and data layout were learned from two
 * existing extensions: the MangaBuddy provider in Seanime-Providers by Pal (MIT License,
 * https://github.com/Seanime-contributions/Seanime-Providers) and the Mangak extension in
 * karrot0/KakarotExtension. No code was copied from either.
 *
 * Data used: search API https://api.mangak.io/titles/search, chapter list API
 * https://api.mangak.io/titles/<id>/chapters, and the __NEXT_DATA__ JSON embedded in the series
 * and chapter pages.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const SITE = 'https://mangak.io';
const API = 'https://api.mangak.io';
const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

let lastMsg = '';

function errText(e: any): string {
  return String((e && e.message) || e).slice(0, 160);
}

function errRows(msg: string): MangaSummary[] {
  lastMsg = msg;
  const out: MangaSummary[] = [];
  for (let i = 0; i < msg.length && out.length < 12; i += 34) {
    out.push({ id: 'err-' + out.length, title: msg.slice(i, i + 34) } as MangaSummary);
  }
  return out;
}

async function getText(url: string, json: boolean): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: json ? 'application/json' : 'text/html',
    Referer: SITE + '/',
  };
  if (json) headers['X-Requested-With'] = 'XMLHttpRequest';
  const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 20000, headers } as any);
  const status = Number(r?.status ?? 0);
  if (status !== 200) throw new Error('HTTP ' + status + ' ' + url.replace(SITE, '').replace(API, 'api'));
  return String(r?.body ?? '');
}

async function getJson(url: string): Promise<any> {
  return JSON.parse(await getText(url, true));
}

function absUrl(u: any): string | undefined {
  if (typeof u !== 'string' || !u) return undefined;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return /^https?:\/\//i.test(u) ? u : undefined;
}

function pageProps(html: string): any {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps ?? null;
  } catch (_) {
    return null;
  }
}

async function search(q: string, label: string): Promise<MangaSummary[]> {
  try {
    const j = await getJson(API + '/titles/search?q=' + encodeURIComponent(q) + '&page=1&limit=24');
    const items: any[] = j?.data?.items ?? [];
    if (!j?.success || !Array.isArray(items)) return errRows('BAD JSON ' + label + ': success=' + String(j?.success));
    const out: MangaSummary[] = [];
    for (const it of items) {
      if (!it?.slug) continue;
      out.push({
        id: String(it.slug),
        title: String(it.name || it.slug),
        cover: absUrl(it.cover),
        lastChapter: it.latest_chapters?.[0]?.name ? String(it.latest_chapters[0].name) : undefined,
      });
    }
    if (out.length === 0) return label === 'search' ? [] : errRows('EMPTY ' + label + ' (0 series in API reply)');
    return out;
  } catch (e) {
    return errRows('ERR ' + label + ': ' + errText(e));
  }
}

async function seriesData(slug: string): Promise<any> {
  const props = pageProps(await getText(SITE + '/' + slug, false));
  const manga = props?.initialManga;
  if (!manga) throw new Error('series data not found');
  return manga;
}

function chapterNumber(ch: any): string | null {
  const fromName = /chapter[-\s]*(\d+(?:[.-]\d+)?)/i.exec(String(ch?.name || ''));
  if (fromName) return fromName[1].replace('-', '.');
  if (ch?.chapter_number !== undefined && ch?.chapter_number !== null) return String(ch.chapter_number);
  return null;
}

function debugChapter(id: string, msg: string): MangaChapter {
  return { id: id + '::debug', chapter: null, title: msg.slice(0, 120), pages: 0, language: 'en' };
}

const plugin: MangaProvider = {
  id: 'mangabuddy-io',
  name: 'MangaBuddy (mangak.io)',

  async popular(offset: number) {
    if (offset > 0) return [];
    return search('', 'popular');
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    return search(String(query || '').trim(), 'search');
  },

  async detail(id: string) {
    if (id.indexOf('err-') === 0) return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    try {
      const m = await seriesData(id);
      const alt = (m.altNames || []).map((a: any) => String(a?.name || '')).find((n: string) => n && n !== m.name);
      const status = String(m.status || '').toLowerCase();
      return {
        id,
        title: String(m.name || id),
        altTitle: alt || undefined,
        cover: absUrl(m.cover),
        description: m.summary ? String(m.summary) : undefined,
        status: status || undefined,
      } as MangaSummary;
    } catch (e) {
      lastMsg = 'ERR detail: ' + errText(e);
      return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    }
  },

  async chapters(id: string) {
    if (id.indexOf('err-') === 0) return [];
    try {
      const m = await seriesData(id);
      if (!m.id) throw new Error('series has no internal id');
      const j = await getJson(API + '/titles/' + m.id + '/chapters');
      const list: any[] = j?.data?.chapters ?? [];
      if (!j?.success || !Array.isArray(list) || list.length === 0) {
        return [debugChapter(id, 'EMPTY chapters (API success=' + String(j?.success) + ')')];
      }
      const out: MangaChapter[] = list
        .filter((c) => c?.slug)
        .map((c) => ({
          id: id + '/' + c.slug,
          chapter: chapterNumber(c),
          title: c.name ? String(c.name) : undefined,
          pages: 0,
          language: 'en',
          publishAt: c.updated_at ? String(c.updated_at) : undefined,
        }));
      out.sort((a, b) => parseFloat(String(a.chapter ?? '0')) - parseFloat(String(b.chapter ?? '0')));
      return out;
    } catch (e) {
      return [debugChapter(id, 'ERR chapters: ' + errText(e))];
    }
  },

  async pageUrls(chapterId: string) {
    if (chapterId.indexOf('::debug') >= 0) return [];
    const props = pageProps(await getText(SITE + '/' + chapterId, false));
    const images = props?.initialChapter?.images;
    if (!Array.isArray(images) || images.length === 0) throw new Error('no images in chapter data');
    const out: string[] = [];
    for (const src of images) {
      const u = absUrl(src);
      if (u) out.push(u);
    }
    if (out.length === 0) throw new Error('0 usable image links');
    return out;
  },
};

harbor.register(plugin);
