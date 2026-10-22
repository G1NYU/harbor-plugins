import type { MangaProvider, MangaSummary, MangaChapter } from '@shared/types/manga.js';

const SITE = 'https://kagane.moe';
const API = `${SITE}/api/v2`;
const PAGE = 24;
const RATINGS = ['Safe', 'Suggestive'];

// UNVERIFIED: cover image URL format
const img = (id?: string | null) => (id ? `${API}/image/${id}` : undefined);

const uniq = (a: string[]) => a.filter((v, i) => a.indexOf(v) === i);
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function post<T>(path: string, body: unknown): Promise<T | null> {
  return harbor.http<T>(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    responseType: 'json',
  });
}

const toSummary = (s: any): MangaSummary => ({
  id: s.series_id,
  title: s.title,
  cover: img(s.cover_image_id),
  year: s.start_year ?? undefined,
  status: s.publication_status,
  contentRating: s.content_rating,
});

async function list(offset: number, sort?: string, query?: string) {
  const page = Math.floor(offset / PAGE);
  const q = `?page=${page}&size=${PAGE}${sort ? `&sort=${sort}` : ''}`;
  const body: any = { content_rating: RATINGS };
  if (query) body.title = query; // UNVERIFIED: search field name
  const res = await post<{ content: any[] }>(`/search/series${q}`, body);
  return (res?.content ?? []).map(toSummary);
}

// The reader page embeds a short-lived signed token (payload starts with {"authority":)
const TOKEN_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJhdXRob3JpdHki[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

async function getIntegrityToken(urls: string[]): Promise<{ token: string; readerUrl: string } | null> {
  for (const url of urls) {
    try {
      const res = await harbor.http(url, { responseType: 'text' });
      if (!res.ok) {
        harbor.log('kagane: reader page status', res.status, url);
        continue;
      }
      const m = res.body.match(TOKEN_RE);
      if (m) return { token: m[0], readerUrl: url };
      harbor.log('kagane: no integrity token found in', url);
    } catch (e) {
      harbor.log('kagane: reader page fetch failed', url, String(e));
    }
  }
  return null;
}

export const plugin: MangaProvider = {
  id: 'kagane',
  name: 'Kagane',

  preferences: [
    {
      key: 'pageFormat',
      label: 'Page format (auto = whatever the site sends, usually jxl)',
      type: 'select',
      options: ['auto', 'jpg', 'webp', 'png'],
      default: 'auto',
    },
  ],

  popular: (offset) => list(offset),
  search: (query, offset) => list(offset, undefined, query),

  async detail(id) {
    const d: any = await harbor.http(`${API}/series/${id}`, { responseType: 'json' });
    if (!d) return null;
    return {
      ...toSummary(d),
      description: d.description ?? undefined,
      lastChapter: d.current_books ? String(d.current_books) : undefined,
    };
  },

  async chapters(id) {
    const d: any = await harbor.http(`${API}/series/${id}`, { responseType: 'json' });
    const books: any[] = d?.series_books ?? [];
    const slug = slugify(String(d?.title ?? ''));
    return books
      .map((b): MangaChapter => {
        const no = b.chapter_no != null ? String(b.chapter_no) : '';
        return {
          id: [id, slug, no, b.book_id].join('::'),
          chapter: b.chapter_no != null ? String(b.chapter_no) : null,
          title: b.title || undefined,
          volume: b.volume_no != null ? String(b.volume_no) : null,
          pages: b.page_count ?? 0,
          language: d.translated_language ?? 'en',
          group: b.groups?.[0]?.title,
          publishAt: b.published_on ?? undefined,
        };
      })
      .sort((a, b) => Number(b.chapter ?? 0) - Number(a.chapter ?? 0));
  },

  async pageUrls(chapterId) {
    const parts = chapterId.split('::');
    if (parts.length < 4) {
      harbor.log('kagane: unexpected chapter id', chapterId);
      return [];
    }
    const [seriesId, slug, chNo, bookId] = parts;

    const seriesSlugs = uniq([slug ? `${slug}-${seriesId}` : '', seriesId].filter(Boolean));
    const chapterSlugs = uniq([`chapter-${chNo}`, `chapter-${chNo.replace(/\./g, '-')}`]);
    const readerUrls: string[] = [];
    for (const s of seriesSlugs) {
      for (const c of chapterSlugs) {
        readerUrls.push(`${SITE}/series/${s}/reader/${c}-${bookId}`);
      }
    }

    const found = await getIntegrityToken(readerUrls);
    if (!found) {
      harbor.log('kagane: could not obtain integrity token for', bookId);
      return [];
    }

    let grant: any = null;
    try {
      grant = await harbor.http<any>(`${API}/books/${bookId}?intent=Read`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'x-integrity-token': found.token,
          origin: SITE,
        },
        responseType: 'json',
        allowReferer: found.readerUrl,
      });
    } catch (e) {
      harbor.log('kagane: intent=Read request failed', String(e));
      return [];
    }

    const pages: any[] = grant?.manifest?.pages ?? [];
    const cdn: string = grant?.cache_url ?? 'https://kstatic.to';
    const token: string = grant?.access_token ?? '';
    if (!pages.length || !token) {
      harbor.log('kagane: grant had no pages or token', JSON.stringify(grant ?? {}).slice(0, 300));
      return [];
    }

    const fmt = harbor.getPreference<string>('pageFormat', 'auto');
    return pages.map((p: any) => {
      const ext = fmt && fmt !== 'auto' ? fmt : p.ext;
      return `${cdn}/api/v2/books/page/${bookId}/${p.page_id}.${ext}?token=${token}`;
    });
  },
};

harbor.register(plugin);
