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
 *
 * Images: the site's image host most likely refuses requests without a mangak.io Referer, and
 * Harbor cannot attach headers to images. Cover and page links therefore go through the public
 * wsrv.nl image proxy (set USE_PROXY to false to hand out the original links).
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const SITE = 'https://mangak.io';
const API = 'https://api.mangak.io';
const PROXY = 'https://wsrv.nl/?url=';
const USE_PROXY = true;
const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

let lastMsg = '';

function errText(e: any): string {
  return String((e && e.message) || e).slice(0, 380);
}

function toRows(prefix: string, msg: string, max: number): MangaSummary[] {
  const out: MangaSummary[] = [];
  for (let i = 0; i < msg.length && out.length < max; i += 34) {
    out.push({ id: prefix + out.length, title: msg.slice(i, i + 34) } as MangaSummary);
  }
  return out;
}

function errRows(msg: string): MangaSummary[] {
  lastMsg = msg;
  return toRows('err-', msg, 12);
}

function shortUrl(url: string): string {
  return url.replace(SITE, '').replace(API, 'api');
}

async function getText(url: string, json: boolean, xhr: boolean): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: json ? 'application/json' : 'text/html',
    Referer: SITE + '/',
  };
  if (json && xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 20000, headers } as any);
  const status = Number(r?.status ?? 0);
  if (status !== 200) {
    const snippet = String(r?.body ?? '').replace(/\s+/g, ' ').slice(0, 90);
    throw new Error('HTTP ' + status + ' ' + shortUrl(url) + (snippet ? ' | ' + snippet : ''));
  }
  return String(r?.body ?? '');
}

// Try with the XHR header first, then without it
async function getJson(url: string): Promise<any> {
  try {
    return JSON.parse(await getText(url, true, true));
  } catch (e1) {
    try {
      return JSON.parse(await getText(url, true, false));
    } catch (e2) {
      throw new Error(errText(e1) + ' || no XHR header: ' + errText(e2));
    }
  }
}

function absUrl(u: any): string | undefined {
  if (typeof u !== 'string' || !u) return undefined;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE + u;
  return /^https?:\/\//i.test(u) ? u : undefined;
}

function viaProxy(url: string, cover: boolean): string {
  if (!USE_PROXY) return url;
  return PROXY + encodeURIComponent(url) + (cover ? '&w=400&output=jpg' : '');
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : '?';
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

async function seriesData(slug: string): Promise<any> {
  const props = pageProps(await getText(SITE + '/' + slug, false, false));
  const manga = props?.initialManga;
  if (!manga) throw new Error('series data not found');
  return manga;
}

async function search(q: string, label: string): Promise<MangaSummary[]> {
  const base = API + '/titles/search?';
  const urls = q
    ? [base + 'q=' + encodeURIComponent(q) + '&page=1&limit=24']
    : [base + 'page=1&limit=24', base + 'q=&page=1&limit=24', base + 'q=a&page=1&limit=24'];
  let errors = '';
  for (const url of urls) {
    try {
      const j = await getJson(url);
      const items: any[] = j?.data?.items ?? [];
      if (!j?.success || !Array.isArray(items)) {
        errors += ' ## BAD JSON success=' + String(j?.success);
        continue;
      }
      const out: MangaSummary[] = [];
      for (const it of items) {
        if (!it?.slug) continue;
        const cover = absUrl(it.cover);
        out.push({
          id: String(it.slug),
          title: String(it.name || it.slug),
          cover: cover ? viaProxy(cover, true) : undefined,
          lastChapter: it.latest_chapters?.[0]?.name ? String(it.latest_chapters[0].name) : undefined,
        });
      }
      if (out.length > 0) return out;
      if (label === 'search') return [];
      errors += ' ## EMPTY reply for ' + shortUrl(url);
    } catch (e) {
      errors += ' ## ' + errText(e);
    }
  }
  return errRows('ERR ' + label + ':' + errors.slice(0, 360));
}

// Fetch an image with harbor.http and describe the answer in a few characters
async function probeImage(label: string, url: string): Promise<string> {
  try {
    const r: any = await harbor.http(url, { responseType: 'base64', timeoutMs: 20000 } as any);
    const h: any = r?.headers || {};
    const ct = String(h['content-type'] || h['Content-Type'] || '?').slice(0, 24);
    const kb = Math.round((String(r?.body || '').length * 0.75) / 1024);
    return label + ': ' + r?.status + ' ' + ct + ' ' + kb + 'KB';
  } catch (e) {
    return label + ': ERR ' + errText(e).slice(0, 50);
  }
}

// Search for 'diag' to run this: tests the cover host and the page image host directly and through the proxy
async function diagnostics(): Promise<MangaSummary[]> {
  const lines: string[] = [];
  try {
    const j = await getJson(API + '/titles/search?page=1&limit=24');
    const first = (j?.data?.items ?? []).find((it: any) => it?.slug);
    if (!first) {
      lines.push('diag: no series in API reply');
    } else {
      const cover = absUrl(first.cover) || '';
      lines.push('cover host: ' + hostOf(cover));
      lines.push(await probeImage('cover direct', cover));
      lines.push(await probeImage('cover via wsrv', PROXY + encodeURIComponent(cover) + '&w=400&output=jpg'));
      try {
        const m = await seriesData(String(first.slug));
        const cj = await getJson(API + '/titles/' + m.id + '/chapters');
        const ch = (cj?.data?.chapters ?? []).find((c: any) => c?.slug);
        const props = pageProps(await getText(SITE + '/' + first.slug + '/' + ch.slug, false, false));
        const img = absUrl((props?.initialChapter?.images ?? [])[0]) || '';
        lines.push('page host: ' + hostOf(img));
        lines.push(await probeImage('page direct', img));
        lines.push(await probeImage('page via wsrv', PROXY + encodeURIComponent(img)));
      } catch (e) {
        lines.push('diag chapter ERR ' + errText(e).slice(0, 80));
      }
    }
  } catch (e) {
    lines.push('diag ERR ' + errText(e).slice(0, 120));
  }
  const out: MangaSummary[] = [];
  for (const l of lines) {
    for (const row of toRows('diag-' + out.length + '-', l, 4)) {
      out.push({ id: 'diag-' + out.length, title: row.title } as MangaSummary);
    }
  }
  return out;
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

function isRow(id: string): boolean {
  return id.indexOf('err-') === 0 || id.indexOf('diag-') === 0;
}

const plugin: MangaProvider = {
  id: 'mangabuddy-io3',
  name: 'MangaBuddy (mangak.io) 0.0.3',

  async popular(offset: number) {
    if (offset > 0) return [];
    return search('', 'popular');
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (q.toLowerCase() === 'diag') return diagnostics();
    return search(q, 'search');
  },

  async detail(id: string) {
    if (isRow(id)) return { id, title: lastMsg.slice(0, 120) || id, description: lastMsg } as MangaSummary;
    try {
      const m = await seriesData(id);
      const alt = (m.altNames || []).map((a: any) => String(a?.name || '')).find((n: string) => n && n !== m.name);
      const status = String(m.status || '').toLowerCase();
      const cover = absUrl(m.cover);
      return {
        id,
        title: String(m.name || id),
        altTitle: alt || undefined,
        cover: cover ? viaProxy(cover, true) : undefined,
        description: m.summary ? String(m.summary) : undefined,
        status: status || undefined,
      } as MangaSummary;
    } catch (e) {
      lastMsg = 'ERR detail: ' + errText(e);
      return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    }
  },

  async chapters(id: string) {
    if (isRow(id)) return [];
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
    const props = pageProps(await getText(SITE + '/' + chapterId, false, false));
    const images = props?.initialChapter?.images;
    if (!Array.isArray(images) || images.length === 0) throw new Error('no images in chapter data');
    const out: string[] = [];
    for (const src of images) {
      const u = absUrl(src);
      if (u) out.push(viaProxy(u, false));
    }
    if (out.length === 0) throw new Error('0 usable image links');
    return out;
  },
};

harbor.register(plugin);
