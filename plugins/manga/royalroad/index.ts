/**
 * Royal Road native Manga test. Uses the direct HTML approach of the working
 * native eBook source, not the Paperback adapter. Manga cannot render prose yet.
 */
import type { MangaProvider, MangaSummary, MangaChapter, MangaTag, PluginFilterGroup } from '../../../shared/types/manga.js';
import type { HElement } from '../../../shared/types/harbor.js';
import { createUrlResolver } from '../../../shared/utils/url.js';
import { calcPage } from '../../../shared/utils/text.js';

const BASE = 'https://www.royalroad.com';
const resolveUrl = createUrlResolver(BASE);
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};
const tidy = (v?: string | null): string => (v || '').replace(/\s+/g, ' ').trim();

function fictionId(raw?: string | null): string | undefined {
  const value = (raw || '').trim();
  // Accept legacy numeric IDs as well as the eBook's ID/slug identifiers.
  const path = value.replace(/^https?:\/\/(?:www\.)?royalroad\.com\//i, '').replace(/^\/?(?:fiction\/)?/, '');
  return /^(\d+(?:\/[a-z0-9][a-z0-9-]*)?)(?:\/?(?:[?#].*)?)$/i.exec(path)?.[1];
}

function chapterPath(raw?: string | null): string | undefined {
  const value = (raw || '').trim().replace(/^https?:\/\/(?:www\.)?royalroad\.com\//i, '').replace(/^\//, '');
  // Only visit real Royal Road fiction chapter paths; never arbitrary URLs.
  return /^(fiction\/\d+(?:\/[a-z0-9][a-z0-9-]*)?\/chapter\/\d+(?:\/[a-z0-9][a-z0-9-]*)?)(?:\/?(?:[?#].*)?)$/i.exec(value)?.[1];
}

async function getDoc(path: string) {
  const res = await harbor.http(BASE + path, { responseType: 'text', headers: HEADERS, timeoutMs: 12000 });
  if (!res.ok) throw new Error('Royal Road HTTP ' + res.status + ' (' + path.split('?')[0] + ')');
  if (/(?:<title>\s*just a moment|cf-chl-|challenge-platform)/i.test(res.body.slice(0, 2500))) {
    throw new Error('Royal Road returned browser verification instead of fiction HTML');
  }
  return harbor.parseHtml(res.body);
}

function parseCard(el: HElement): MangaSummary | null {
  const link = el.querySelector('.fiction-title a');
  const id = fictionId(link?.attr('href'));
  const title = tidy(link?.text());
  if (!id || !title) return null;
  const img = el.querySelector('img');
  return {
    id, title,
    cover: resolveUrl(img?.attr('data-src') || img?.attr('src')),
    author: tidy(el.querySelector('.author a')?.text() || el.querySelector('span.author')?.text()) || undefined,
    description: tidy(el.querySelector('.fiction-description')?.text()) || undefined,
    status: tidy(el.querySelector('.label')?.text()).toLowerCase() || undefined,
  };
}

function selectedTag(tag?: string | PluginFilterGroup[]): string | undefined {
  // Simple tags, matching the working eBook plugin. Harbor may send structured filters.
  if (typeof tag === 'string') return tag;
  return undefined;
}

async function catalogue(path: string): Promise<MangaSummary[]> {
  const doc = await getDoc(path);
  const seen = new Set<string>();
  const entries: MangaSummary[] = [];
  for (const card of doc.querySelectorAll('.fiction-list-item')) {
    const item = parseCard(card);
    if (!item || seen.has(item.id.split('/')[0])) continue;
    seen.add(item.id.split('/')[0]);
    entries.push(item);
  }
  return entries;
}

export const plugin: MangaProvider & { content(chapterId: string): Promise<string> } = {
  id: 'royalroad',
  name: 'RoyalRoad (Native test)',

  async popular(offset, tagId) {
    const page = calcPage(offset);
    const tag = selectedTag(tagId);
    let path = '/fictions/active-popular?page=' + page;
    if (tag === 'sort:rating') path = '/fictions/best-rated?page=' + page;
    else if (tag === 'sort:popular') path = '/fictions/weekly-popular?page=' + page;
    else if (tag?.startsWith('genre:')) path = '/fictions/search?genre=' + encodeURIComponent(tag.slice(6)) + '&page=' + page + '&orderBy=popularity';
    return catalogue(path);
  },

  async search(query, offset, tagId) {
    const tag = selectedTag(tagId);
    let path = '/fictions/search?title=' + encodeURIComponent(query) + '&page=' + calcPage(offset);
    if (tag?.startsWith('genre:')) path += '&genre=' + encodeURIComponent(tag.slice(6));
    return catalogue(path);
  },

  async detail(rawId) {
    const id = fictionId(rawId);
    if (!id) return null;
    const doc = await getDoc('/fiction/' + id);
    const root = doc.querySelector('.fiction-header, .page-content-inner');
    if (!root) return null;
    const title = tidy(root.querySelector('h1.font-white, h1')?.text());
    if (!title) return null;
    const coverEl = root.querySelector('img.thumbnail, .cover-art-container img');
    return {
      id: rawId,
      title,
      author: tidy(root.querySelector('h4 a, .fiction-info a')?.text()) || undefined,
      cover: resolveUrl(coverEl?.attr('data-src') || coverEl?.attr('src')),
      description: tidy(doc.querySelector('.description .hidden-content, .description')?.text()) || undefined,
      status: tidy(doc.querySelector('.fiction-info .label')?.text()).toLowerCase() || undefined,
    };
  },

  async chapters(rawId) {
    const id = fictionId(rawId);
    if (!id) return [];
    const doc = await getDoc('/fiction/' + id);
    const rows = doc.querySelectorAll('#chapters tbody tr');
    const chapters: MangaChapter[] = [];
    const seen = new Set<string>();
    let volume = 1;
    let hasVolume = false;
    for (const row of rows) {
      if (row.attr('class')?.includes('volume-header') || row.querySelector('.volume-header')) {
        if (chapters.length) volume++;
        hasVolume = true;
        continue;
      }
      const link = row.querySelector('a[href*="/chapter/"]') || row.querySelector('a');
      const path = chapterPath(link?.attr('href'));
      if (!path || seen.has(path) || path.split('/')[1] !== id.split('/')[0]) continue;
      seen.add(path);
      const title = tidy(link?.text());
      const date = row.querySelector('time');
      chapters.push({
        id: path, chapter: String(chapters.length + 1),
        title: title || undefined, volume: hasVolume ? String(volume) : null,
        pages: 0, language: 'en',
        publishAt: date?.attr('datetime') || date?.text()?.trim() || undefined,
      });
    }
    return chapters.reverse(); // numbering follows the source's reading order
  },

  // Optional developer-facing proof of text extraction, NOT a supported Manga
  // reader method today. Preserve prose rather than fabricate image URLs.
  async content(chapterId) {
    const path = chapterPath(chapterId);
    if (!path) throw new Error('Invalid Royal Road chapter ID');
    const doc = await getDoc('/' + path);
    const chapter = doc.querySelector('.chapter-inner.chapter-content, .chapter-content');
    if (!chapter) throw new Error('Royal Road chapter content not found');
    const paragraphs = chapter.querySelectorAll('p').map((p) => p.text().trim()).filter(Boolean);
    return paragraphs.length ? paragraphs.join('\n\n') : chapter.text().trim();
  },

  async pageUrls() {
    throw new Error('Royal Road chapters contain prose, not manga page images. Use Royal Road in eBooks until the Manga reader supports text or HTML chapters.');
  },

  async tags(): Promise<MangaTag[]> {
    return [
      { id: 'sort:popular', name: 'Weekly Popular', group: 'Sort' },
      { id: 'sort:rating', name: 'Best Rated', group: 'Sort' },
      ...['Action', 'Adventure', 'Fantasy', 'Sci-Fi', 'LitRPG', 'Comedy', 'Mystery', 'Psychological'].map(name => ({ id: 'genre:' + name.toLowerCase(), name, group: 'Genre' })),
    ];
  },
};
harbor.register(plugin);
