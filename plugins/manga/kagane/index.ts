import type { MangaProvider, MangaSummary, MangaChapter } from '@shared/types/manga.js';

const API = 'https://yuzuki.kagane.org/api/v2';
const PAGE = 24;
const RATINGS = ['Safe', 'Suggestive'];

const img = (id?: string | null) => (id ? `${API}/image/${id}` : undefined); // TODO verify

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
  if (query) body.title = query; // TODO confirm the search field name
  const res = await post<{ content: any[] }>(`/search/series${q}`, body);
  return (res?.content ?? []).map(toSummary);
}

export const plugin: MangaProvider = {
  id: 'kagane',
  name: 'Kagane',

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
    return books
      .map((b): MangaChapter => ({
        id: b.book_id,
        chapter: b.chapter_no != null ? String(b.chapter_no) : null,
        title: b.title || undefined,
        volume: b.volume_no != null ? String(b.volume_no) : null,
        pages: b.page_count ?? 0,
        language: d.translated_language ?? 'en',
        group: b.groups?.[0]?.title,
        publishAt: b.published_on ?? undefined,
      }))
      .sort((a, b) => Number(b.chapter ?? 0) - Number(a.chapter ?? 0));
  },

  async pageUrls(chapterId) {
    // TODO: POST /books/{id}?intent=Read needs x-integrity-token.
    harbor.log('pageUrls not implemented', chapterId);
    return [];
  },
};

harbor.register(plugin);
