import type { EBookChapter, EBookProvider, EBookSummary } from '../../../shared/types/ebook.js';
import type { HElement } from '../../../shared/types/harbor.js';
import { createUrlResolver } from '../../../shared/utils/url.js';
import { cleanTitle } from '../../../shared/utils/text.js';
import { extractProse } from '../../../shared/utils/prose.js';

const BASE = 'https://bdebooks.com';
const resolveUrl = createUrlResolver(BASE);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

let currentBookId = '';

async function getDoc(path: string) {
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await harbor.http(url, {
    responseType: 'text',
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return harbor.parseHtml(res.body);
}

function parseBookLink(el: HElement): EBookSummary | null {
  const href = el.attr('href') || '';
  const match = href.match(/\/books\/([^/?#]+)/);
  if (!match) return null;

  const id = match[1];
  const img = el.querySelector('img');

  return {
    id,
    title: cleanTitle(el.text() || el.attr('title') || id),
    cover: resolveUrl(img?.attr('src') || img?.attr('data-src')),
  };
}

export const plugin: EBookProvider = {
  id: 'bdebooks',
  name: 'BDeBooks',

  async popular(offset: number): Promise<EBookSummary[]> {
    const page = Math.floor(offset / 20) + 1;
    const doc = await getDoc(`/en/books/popular/?page=${page}`);
    return doc
      .querySelectorAll('a[href*="/books/"]')
      .map(parseBookLink)
      .filter((b): b is EBookSummary => b !== null);
  },

  async search(query: string, offset: number): Promise<EBookSummary[]> {
    const page = Math.floor(offset / 20) + 1;
    const doc = await getDoc(`/en/search/?q=${encodeURIComponent(query)}&page=${page}`);
    return doc
      .querySelectorAll('a[href*="/books/"]')
      .map(parseBookLink)
      .filter((b): b is EBookSummary => b !== null);
  },

  async detail(id: string): Promise<EBookSummary | null> {
    const doc = await getDoc(`/en/books/${id}/`);

    const title = doc.querySelector('h1')?.text()?.trim();
    const cover = doc.querySelector('meta[property="og:image"]')?.attr('content');
    const description = doc.querySelector('meta[property="og:description"]')?.attr('content');
    const siteUrl = doc.querySelector('meta[property="og:url"]')?.attr('content');

    return {
      id,
      title: cleanTitle(title || id),
      cover: resolveUrl(cover),
      description: description?.trim() || undefined,
      siteUrl: siteUrl || `${BASE}/en/books/${id}/`,
    };
  },

  async chapters(id: string): Promise<EBookChapter[]> {
    currentBookId = id;
    const doc = await getDoc(`/en/books/${id}/read/`);
    const links = doc.querySelectorAll('a[href*="chapter="]');

    const chapters: EBookChapter[] = [];
    const seen = new Set<string>();

    for (const a of links) {
      const href = a.attr('href') || '';
      const match = href.match(/chapter=(\d+)/);
      if (!match) continue;

      const chapterId = match[1];
      if (seen.has(chapterId)) continue;
      seen.add(chapterId);

      const title = a.text().trim() || `Chapter ${chapterId}`;

      chapters.push({
        id: chapterId,
        title,
        chapter: chapterId,
        position: chapters.length,
      });
    }

    if (chapters.length === 0) {
      chapters.push({
        id: '1',
        title: 'Read online',
        chapter: '1',
        position: 0,
      });
    }

    return chapters;
  },

  async content(chapterId: string): Promise<string> {
    const doc = await getDoc(`/en/books/${currentBookId}/read/?chapter=${chapterId}`);
    return extractProse(doc, 'article', 'p');
  },

  async tags() {
    return [
      { id: 'popular', name: 'Popular', group: 'Browse' },
    ];
  },
};

harbor.register(plugin);
