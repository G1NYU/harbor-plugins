/**
 * Read Comics Online — native Harbor comics source (experimental).
 *
 * Server-rendered comic listing, issue selection and #reader-all image URLs.
 * Based on an actual page source supplied by a user (33 / 33 issue pages).
 * No browser challenges, proxy, cookies or app rebuilds are added here.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://readcomicsonline.ru';
const SOURCE_ID = 'readcomicsonline-ru';
const SITE_HOST = 'readcomicsonline.ru';
const CDN_HOST = 'cdn.readcomicsonline.ru';
const PAGE_SIZE = 24;

function decode(text: string): string {
  return String(text || '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp|#39);/gi, (m) => ({
      '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
      '&nbsp;': ' ', '&#39;': "'",
    })[m.toLowerCase()] || m);
}
function stripTags(raw: string): string {
  return decode(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attribute(tag: string, key: string): string {
  const quoted = new RegExp('(?:\\s|<)' + key + '\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]', 'i');
  const unquoted = new RegExp('(?:\\s|<)' + key + '\\s*=\\s*([^\\s>]+)', 'i');
  return decode(quoted.exec(tag)?.[1] || unquoted.exec(tag)?.[1] || '');
}
function urlOf(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const u = new URL(decode(raw.trim()), BASE + '/');
    if (u.protocol !== 'https:' || (u.hostname !== SITE_HOST && u.hostname !== CDN_HOST)) return null;
    return u.href;
  } catch { return null; }
}
function pathOf(raw: string): string | null {
  const u = urlOf(raw);
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.hostname === SITE_HOST ? parsed.pathname : null;
  } catch { return null; }
}
function seriesSlug(raw: string): string | null {
  const path = pathOf(raw);
  return /^\/comic\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(path || '')?.[1] || null;
}
function issuePath(raw: string): { slug: string; issue: string } | null {
  const path = pathOf(raw);
  const m = /^\/comic\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)\/?$/i.exec(path || '');
  return m ? { slug: m[1], issue: m[2] } : null;
}
function readTitleFromMetadata(html: string, name: string): string {
  for (const t of html.match(/<meta\b[^>]*>/gi) || []) {
    if (attribute(t, 'property').toLowerCase() === name.toLowerCase() ||
        attribute(t, 'name').toLowerCase() === name.toLowerCase()) {
      return attribute(t, 'content');
    }
  }
  return '';
}
function cleanTitle(value: string): string {
  return stripTags(value).replace(/\s+(?:[—|-])\s+Read Comics Online\s*$/i, '').trim();
}
function niceSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (s) => s.toUpperCase());
}
function imageUrl(imgTag: string): string | undefined {
  const url = urlOf(attribute(imgTag, 'data-src') || attribute(imgTag, 'src'));
  return url || undefined;
}
function imageIn(html: string): string | undefined {
  return imageUrl(/<img\b[^>]*>/i.exec(html)?.[0] || '');
}
function latestCoverNear(html: string, index: number, anchor: string): string | undefined {
  const inner = imageIn(anchor);
  if (inner) return inner;
  // Covers may be sibling nodes within a card instead of nested anchors.
  // Never attach an image across unrelated cards or take a tracking pixel.
  const vicinity = html.slice(Math.max(0, index - 350), Math.min(html.length, index + anchor.length + 250));
  const m = /<img\b[^>]*\b(?:src|data-src)=["'][^"']*uploads\/manga\/[^"']+/i.exec(vicinity);
  if (!m) return undefined;
  return imageUrl(/<img\b[^>]*>/i.exec(vicinity.slice(m.index))?.[0] || '');
}
function parseCatalogue(html: string): MangaSummary[] {
  const seen = new Set<string>();
  const out: MangaSummary[] = [];
  const anchors = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(html)) !== null) {
    const anchor = match[0];
    const opening = /^<a\b[^>]*>/i.exec(anchor)?.[0] || '';
    const slug = seriesSlug(attribute(opening, 'href'));
    if (!slug || seen.has(slug)) continue;
    const label = cleanTitle(anchor.slice(opening.length).replace(/<\/a>\s*$/i, ''));
    const picture = /<img\b[^>]*>/i.exec(anchor)?.[0] || '';
    const alt = picture ? cleanTitle(attribute(picture, 'alt')) : '';
    let title = label || alt;
    if (!title || /^(?:read|view|continue|details|read now|more|view all)$/i.test(title)) {
      const neighborhood = html.slice(match.index, Math.min(html.length, match.index + 900));
      const head = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(neighborhood);
      title = head ? cleanTitle(head[1]) : niceSlug(slug);
    }
    if (!title) continue;
    const cover = latestCoverNear(html, match.index, anchor);
    seen.add(slug);
    out.push({ id: slug, title, cover });
  }
  return out;
}
function parseIssues(html: string, slug: string): MangaChapter[] {
  const unique = new Map<string, MangaChapter>();
  // Issue IDs, not surrounding link text, determine the displayed issue number.
  // The detail page includes links like "Read First" whose text is not a title.
  function add(url: string) {
    const found = issuePath(url);
    if (!found || found.slug !== slug || !/^\d+(?:\.\d+)?$/.test(found.issue)
      || unique.has(found.issue)) return;
    const issue = found.issue;
    unique.set(issue, {
      id: slug + '/' + issue,
      chapter: issue,
      title: 'Issue #' + issue,
      pages: 0,
      language: 'en',
    });
  }

  // The real reader exposes issue selection through .js-chapter-select.
  // Options are authoritative; scan other issue links only as a fallback for
  // series-detail templates with no selector.
  const chapterSelect = /<select\b[^>]*\bclass\s*=\s*["'][^"']*js-chapter-select[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi;
  for (const select of html.matchAll(chapterSelect)) {
    for (const option of select[1].matchAll(/<option\b[^>]*>/gi)) {
      add(attribute(option[0], 'value'));
    }
  }
  if (unique.size === 0) {
    for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
      add(attribute(anchor[0], 'href'));
    }
  }
  return [...unique.values()].sort((a, b) =>
    Number(b.chapter || 0) - Number(a.chapter || 0) || b.id.localeCompare(a.id));
}
function readerSection(html: string): string {
  const root = /<div\b[^>]*\bid\s*=\s*["']reader-all["'][^>]*>/i.exec(html);
  if (!root) return '';
  const begin = root.index + root[0].length;
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = begin;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    if (/^<\/div/i.test(match[0])) depth--;
    else depth++;
    if (depth === 0) return html.slice(begin, match.index);
  }
  return html.slice(begin);
}
function parsePages(html: string, slug: string, issue: string): string[] {
  const section = readerSection(html);
  // The issue-specific #reader-all HTML is authoritative. If absent, accept
  // only images under the exact requested issue directory as a fallback.
  const body = section || html;
  const prefix = '/uploads/manga/' + slug + '/chapters/';
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const srcset = attribute(tag, 'srcset') || attribute(tag, 'data-srcset');
    const candidates = [
      attribute(tag, 'data-src'), attribute(tag, 'data-original'),
      attribute(tag, 'data-lazy-src'), attribute(tag, 'src'),
      srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '',
    ];
    let image: string | undefined;
    for (const candidate of candidates) {
      const url = urlOf(candidate);
      if (!url) continue;
      const parsed = new URL(url);
      const path = parsed.pathname;
      if (!path.startsWith(prefix) || !/\.(?:webp|png|jpe?g|avif)$/i.test(path)) continue;
      if (!section && !path.startsWith(prefix + issue + '/')) continue;
      image = url;
      break;
    }
    if (!image || seen.has(image)) continue;
    seen.add(image);
    out.push(image);
  }
  return out;
}
function hasChallenge(body: string): boolean {
  return /<title>\s*(?:just a moment|attention required)/i.test(body) ||
    /cf-challenge|challenge-platform|cf-turnstile|\/cdn-cgi\/challenge/i.test(body.slice(0, 20000));
}
async function getHtml(path: string): Promise<string> {
  const url = BASE + path;
  const response = await harbor.http(url, {
    method: 'GET', responseType: 'text', timeoutMs: 12000,
    headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
  });
  const status = Number(response?.status || 0);
  const body = String(response?.body || '');
  if (status !== 200 || hasChallenge(body)) {
    if (status === 403 || hasChallenge(body)) {
      throw new Error('Read Comics Online returned HTTP ' + status +
        ' / anti-bot challenge at ' + path + '. Harbor browser session may be required.');
    }
    throw new Error('Read Comics Online HTTP ' + status + ' at ' + path);
  }
  if (!body.includes('<html') && !body.includes('<HTML')) {
    throw new Error('Read Comics Online returned non-HTML content at ' + path);
  }
  return body;
}
function extractYear(title: string): number | undefined {
  const m = /\((20\d\d|19\d\d)(?:-|\))/.exec(title);
  return m ? Number(m[1]) : undefined;
}

const plugin: MangaProvider = {
  id: SOURCE_ID,
  name: 'Read Comics Online',

  async popular(offset: number) {
    const page = Math.max(1, Math.floor(Math.max(0, offset) / PAGE_SIZE) + 1);
    // The site exposes the latest releases in a regular paginated HTML listing.
    const html = await getHtml('/latest-release' + (page > 1 ? '?page=' + page : ''));
    return parseCatalogue(html);
  },

  async search(query: string, offset: number) {
    const q = String(query || '').trim();
    if (!q) return this.popular(offset);
    const page = Math.max(1, Math.floor(Math.max(0, offset) / PAGE_SIZE) + 1);
    const path = '/advanced-search?name=' + encodeURIComponent(q) + (page > 1 ? '&page=' + page : '');
    return parseCatalogue(await getHtml(path));
  },

  async detail(id: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
    const html = await getHtml('/comic/' + id);
    const titleTag = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '';
    const title = (cleanTitle(titleTag || readTitleFromMetadata(html, 'og:title'))
      .replace(/\s+#\d+(?:\s+p\.?\s*\d+)?$/i, '')) || niceSlug(id);
    const cover = urlOf(readTitleFromMetadata(html, 'og:image')) || undefined;
    const description = cleanTitle(readTitleFromMetadata(html, 'og:description') ||
      readTitleFromMetadata(html, 'description'));
    return { id, title, cover, description: description || undefined, year: extractYear(title) };
  },

  async chapters(id: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return [];
    const html = await getHtml('/comic/' + id);
    let chapters = parseIssues(html, id);
    // Some series detail templates omit the reader's chapter dropdown.
    if (!chapters.length) {
      const sample = await getHtml('/comic/' + id + '/1');
      chapters = parseIssues(sample, id);
    }
    return chapters;
  },

  async pageUrls(chapterId: string) {
    const m = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/i.exec(chapterId);
    if (!m) return [];
    const [, slug, issue] = m;
    let html = await getHtml('/comic/' + slug + '/' + issue);
    let pages = parsePages(html, slug, issue);
    if (!pages.length) {
      // The confirmed source HTML uses /issue/page and embeds the full issue.
      html = await getHtml('/comic/' + slug + '/' + issue + '/1');
      pages = parsePages(html, slug, issue);
    }
    if (!pages.length) {
      const sectionPresent = /\bid\s*=\s*["']reader-all["']/i.test(html);
      const imageTags = (html.match(/<img\b/gi) || []).length;
      throw new Error('Issue #' + issue + ' has no usable comic pages (' +
        (sectionPresent ? 'reader present' : 'no full-page reader') +
        ', HTML images: ' + imageTags +
        '). The issue may be missing images or using a different CDN layout.');
    }
    const expected = /Page\s+\d+\s*\/\s*(\d+)/i.exec(html)?.[1];
    if (expected && Number(expected) > pages.length) {
      throw new Error('Partial reader result: ' + pages.length + ' of ' + expected + ' pages for ' + chapterId);
    }
    return pages;
  },
};

harbor.register(plugin);
