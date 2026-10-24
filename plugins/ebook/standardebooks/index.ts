import type { EBookChapter, EBookProvider, EBookSummary } from '../../../shared/types/ebook.js';
import { createUrlResolver } from '../../../shared/utils/url.js';
import { cleanTitle } from '../../../shared/utils/text.js';
import { extractProse } from '../../../shared/utils/prose.js';

const BASE = 'https://standardebooks.org';
const resolveUrl = createUrlResolver(BASE);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

let currentBookUrl = '';

async function getDoc(path: string) {
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await harbor.http(url, {
    responseType: 'text',
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return harbor.parseHtml(res.body);
}

function parseBookLink(el: any): EBookSummary | null {
  const href = el.attr('href') || '';
  const match = href.match(/\/ebooks\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;

  const id = `${match[1]}/${match[2]}`;
  const img = el.querySelector('img');

  return {
    id,
    title: cleanTitle(el.text() || id),
    cover: resolveUrl(img?.attr('src')),
  };
}

export const plugin: EBookProvider = {
  id: 'standardebooks',
  name: 'Standard Ebooks',

  async popular(offset: number): Promise<EBookSummary[]> {
    return [
      {
        id: 'henry-seton-merriman/suspense',
        title: 'Suspense',
        cover: 'https://standardebooks.org/ebooks/henry-seton-merriman/suspense/downloads/cover.jpg',
      },
    ];
  },

  async search(query: string, offset: number): Promise<EBookSummary[]> {
    try {
      const doc = await getDoc(`/ebooks?query=${encodeURIComponent(query)}`);
      const results = (doc.querySelectorAll('a[href*="/ebooks/"]') as any[])
        .map(parseBookLink)
        .filter((b: EBookSummary | null) => b !== null) as EBookSummary[];

      if (results.length === 0) {
        return [
          {
            id: 'debug-search',
            title: `SEARCH 0 | ${query}`,
          },
        ];
      }

      return results;
    } catch (e: any) {
      return [
        {
          id: 'debug-search-err',
          title: `SEARCH ERR | ${e?.message || e}`,
        },
      ];
    }
  },

  async detail(id: string): Promise<EBookSummary | null> {
    const url = `${BASE}/ebooks/${id}/`;
    const doc = await getDoc(url);

    currentBookUrl = url;

    const title = doc.querySelector('h1')?.text()?.trim();
    const cover = doc.querySelector('meta[property="og:image"]')?.attr('content');
    const description = doc.querySelector('meta[property="og:description"]')?.attr('content');

    return {
      id,
      title: cleanTitle(title || id),
      cover: resolveUrl(cover),
      description: description?.trim() || undefined,
      siteUrl: url,
    };
  },

  async chapters(id: string): Promise<EBookChapter[]> {
    try {
      const textUrl = `${currentBookUrl}text/`;
      const doc = await getDoc(textUrl);

      const links = doc.querySelectorAll('a[href^="#"]');
      const chapters: EBookChapter[] = [];
      const seen = new Set<string>();

      for (const a of links as any[]) {
        const href = a.attr('href') || '';
        const chapterId = href.slice(1);
        if (!chapterId || seen.has(chapterId)) continue;

        const title = a.text().trim();
        if (!title) continue;

        seen.add(chapterId);
        chapters.push({
          id: chapterId,
          title,
          chapter: chapterId,
          position: chapters.length,
        });
      }

      if (chapters.length === 0) {
        return [
          {
            id: 'debug-chapters',
            title: `CHAPTERS 0 | ${textUrl}`,
          },
        ];
      }

      return chapters;
    } catch (e: any) {
      return [
        {
          id: 'debug-chapters-err',
          title: `CHAPTERS ERR | ${e?.message || e}`,
        },
      ];
    }
  },

  async content(chapterId: string): Promise<string> {
    const textUrl = `${currentBookUrl}text/`;
    const doc = await getDoc(textUrl);

    const start = doc.querySelector(`#${chapterId}`) as any;
    if (!start || !start.nextElementSibling) {
      return extractProse(doc, 'body', 'p');
    }

    const parts: string[] = [];
    let el = start.nextElementSibling as any;

    while (el) {
      if (el.attr && el.attr('id')) break;
      const text = el.text ? el.text().trim() : '';
      if (text) parts.push(text);
      el = el.nextElementSibling;
    }

    if (parts.length === 0) {
      return extractProse(doc, 'body', 'p');
    }

    return parts.join('\n\n');
  },

  async tags() {
    return [
      { id: 'popular', name: 'Popular', group: 'Browse' },
    ];
  },
};

harbor.register(plugin);
