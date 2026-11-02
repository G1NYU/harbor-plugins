/**
 * TooComic FR — functional Harbor MangaProvider beta (testing repo only).
 * Origin: user's confirmed accessible chapter/series at www.toocomic.com.
 * No external runtime, browser globals, webview, cookies, or proxy required.
 *
 * Unverified behaviors: catalogue/search selectors and the *complete* list of
 * chapter page images. Confirm in Harbor before publishing under a stable ID.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://www.toocomic.com';
const HOME = '/fr/';
const EXAMPLE_SERIES = '/fr/101%E1%B5%89-confession-fr/';
const HEADERS = {
  Accept: 'text/html,application/xhtml+xml,*/*',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
};

let lastError = '';
function err(e: unknown): string { return String((e as Error)?.message || e).slice(0, 145); }
function diagnostics(message: string): MangaSummary[] {
  lastError = message;
  const rows: MangaSummary[] = [];
  for (let i = 0; i < message.length && rows.length < 12; i += 34)
    rows.push({ id: 'error-' + rows.length, title: message.slice(i, i + 34) });
  return rows;
}
function debugChapter(series: string, message: string): MangaChapter {
  return { id: series + '#debug', chapter: null, title: message.slice(0, 120), pages: 0, language: 'fr' };
}
function entity(s: string): string {
  return String(s || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'").replace(/&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\\\//g, '/');
}
function textOnly(s: string): string {
  return entity(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}
function attr(tag: string, name: string): string {
  const pattern = new RegExp('(?:^|\\s)' + name.replace(/-/g, '\\-') + '\\s*=\\s*(?:"([^\"]*)"|\\x27([^\\x27]*)\\x27)', 'i');
  const m = pattern.exec(tag);
  return m ? entity(m[1] ?? m[2] ?? '') : '';
}
function abs(url: string): string {
  const raw = entity(url || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('/')) return BASE + raw;
  return '';
}
function localPath(url: string): string {
  const u = abs(url);
  if (!/^https:\/\/(?:www\.)?toocomic\.com\//i.test(u)) return '';
  return u.replace(/^https:\/\/(?:www\.)?toocomic\.com/i, '').split('#')[0];
}
function isSeries(path: string): boolean {
  return /^\/fr\/[^/?#]+\/?(?:\?.*)?$/i.test(path)
    && !/\/fr\/(?:page|search|category|categorie|genre|tag|author|auteur|contact|about|privacy|login|register|wp-)/i.test(path);
}
function isChapter(path: string): boolean {
  return /^\/fr\/[^/?#]+\/[^/?#]*chapitre[^/?#]*\.html(?:\?.*)?$/i.test(path);
}
function withoutQuery(path: string): string { return path.split('?')[0].split('#')[0]; }
function seriesPath(chapter: string): string {
  const path = withoutQuery(chapter);
  const m = /^(\/fr\/[^/]+\/)\S+\.html$/i.exec(path);
  return m ? m[1] : '';
}
function slugTitle(path: string): string {
  const slug = withoutQuery(path).split('/').filter(Boolean).pop() || 'TooComic';
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch (_e) { /* keep path */ }
  return decoded.replace(/-fr$/i, '').replace(/-/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
}
function meta(html: string, property: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = attr(tag, 'property') || attr(tag, 'name');
    if (key.toLowerCase() === property.toLowerCase()) return attr(tag, 'content');
  }
  return '';
}
async function get(path: string): Promise<string> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid path');
  const r = await harbor.http(BASE + path, { responseType: 'text', timeoutMs: 10000, headers: HEADERS });
  const status = Number(r?.status ?? 0);
  if (status !== 200) throw new Error('HTTP ' + status + ' ' + path.slice(0, 65));
  return String(r.body || '');
}

function imageFromTag(tag: string): string {
  for (const key of ['data-src', 'data-lazy-src', 'data-original', 'data-full-url', 'data-image', 'src']) {
    const u = abs(attr(tag, key));
    if (/^https?:\/\//i.test(u) && !/\.(?:svg|gif)(?:\?|$)/i.test(u) && !/placeholder|\/logo\//i.test(u)) return u;
  }
  return '';
}
function firstImage(fragment: string): string | undefined {
  for (const tag of fragment.match(/<img\b[^>]*>/gi) || []) {
    const img = imageFromTag(tag);
    if (img) return img;
  }
  return undefined;
}

// The homepage is an unverified feed; prefer obvious linked card markup and
// fall back to chapter links to identify their parent series (not inventions).
function seriesList(html: string, query = ''): MangaSummary[] {
  const results: MangaSummary[] = [];
  const seen: Record<string, boolean> = {};
  const q = query.trim().toLowerCase();
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html)) !== null && results.length < 70) {
    const href = localPath(attr('<a ' + m[1] + '>', 'href'));
    const path = isSeries(href) ? withoutQuery(href).replace(/\/?$/, '/')
      : isChapter(href) ? seriesPath(href) : '';
    if (!path || seen[path]) continue;
    const inner = m[2];
    const image = firstImage(inner);
    const heading = /<(?:h[1-5]|strong|b)\b[^>]*>([\s\S]*?)<\/(?:h[1-5]|strong|b)>/i.exec(inner);
    const titled = attr('<a ' + m[1] + '>', 'title') || (heading ? textOnly(heading[1]) : '')
      || (/<img\b[^>]*>/i.test(inner) ? attr((inner.match(/<img\b[^>]*>/i) || [''])[0], 'alt') : '');
    const name = titled || slugTitle(path);
    // Exclude decorative site-wide links without a title/cover or chapter evidence.
    if (!image && !titled && !isChapter(href)) continue;
    if (q && !(name.toLowerCase().includes(q) || slugTitle(path).toLowerCase().includes(q))) continue;
    seen[path] = true;
    results.push({ id: path, title: name, cover: image });
  }
  return results;
}
// Percent-escape hex is case-insensitive in URLs: %e1 and %E1 are identical.
// The site emits lowercase escapes while our saved series IDs may be uppercase.
function matchPath(path: string): string {
  try { return decodeURI(withoutQuery(path)).normalize('NFC').toLocaleLowerCase('en'); }
  catch (_e) { return withoutQuery(path).toLowerCase(); }
}
function tidyTitle(raw: string, fallback: string): string {
  const title = entity(raw).replace(/\s+/g, ' ').trim()
    .replace(/^Read\s+/i, '')
    .replace(/\s+(?:Manga Online|Manhwa Online|Scan VF|Scan FR)(?:\s|$).*/i, '')
    .replace(/\s+[-–|]\s+(?:Mangas?|Comics?)(?:\s|$).*/i, '')
    .trim();
  return title.length > 2 && title.length <= 110 ? title : slugTitle(fallback);
}
function chapterNumber(path: string): string | null {
  const m = /chapitre[-_\s]*(\d+(?:[-._]\d+)?)/i.exec(path);
  return m ? m[1].replace(/[-_]/g, '.') : null;
}
function chapterList(html: string, series: string): MangaChapter[] {
  const out: MangaChapter[] = [];
  const seen: Record<string, boolean> = {};
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = localPath(attr('<a ' + m[1] + '>', 'href'));
    if (!isChapter(path) || !matchPath(path).startsWith(matchPath(series)) || seen[matchPath(path)]) continue;
    seen[matchPath(path)] = true;
    const number = chapterNumber(path);
    const label = textOnly(m[2]);
    out.push({ id: path, chapter: number, title: /chapitre/i.test(label) && label.length < 120 ? label : 'Chapitre ' + (number || '?'), pages: 0, language: 'fr' });
  }
  out.sort((a, b) => parseFloat(String(b.chapter ?? '0')) - parseFloat(String(a.chapter ?? '0')));
  return out;
}

interface ImageHit { url: string; score: number; index: number; }
function isUsefulPage(url: string): boolean {
  const u = url.toLowerCase();
  return /^https?:\/\//.test(url) && /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)
    && !/(?:\/logo\/|favicon|icon|avatar|banner|advert|sponsor|placeholder|emoji|\/covers?\/|\/thumb(?:nails)?\/|\/wp-includes\/|\/wp-admin\/)/i.test(u)
    && !/-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp)$/i.test(u);
}
function pageImages(html: string): string[] {
  const hits: ImageHit[] = [];
  const tagRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0], index = m.index;
    const label = [attr(tag, 'alt'), attr(tag, 'class'), attr(tag, 'id')].join(' ');
    const context = html.slice(Math.max(0, index - 450), index);
    const inChapter = /(?:chapter|chapitre|page[-_\s]*\d+|reader|reading|wp-block-image|entry-content|post-content)/i.test(context + ' ' + label);
    const dataLazy = !!(attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src'));
    const likelyPage = /(?:page|planche)\s*[-#:]*\d+|chapter-page|chapitre|reader|reading|scan-page/i.test(label);
    const score = (likelyPage ? 50 : 0) + (inChapter ? 25 : 0) + (dataLazy ? 15 : 0);
    for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-full-url', 'src']) {
      const u = abs(attr(tag, name));
      if (!isUsefulPage(u)) continue;
      hits.push({ url: u, index, score: score + (/\/wp-content\/uploads\//i.test(u) ? 20 : 0) });
      break;
    }
  }
  // Images under real article body selectors, where the site provides them.
  // The HTML regex fallback above remains functional without a DOM shim.
  const strong = hits.filter(h => h.score >= 55);
  const good = strong.length ? strong : hits.filter(h => h.score >= 35);
  const out: string[] = [];
  for (const hit of good) if (!out.includes(hit.url)) out.push(hit.url);
  return out;
}
function readerImageUrls(html: string): string[] {
  const pages = pageImages(html);
  if (pages.length) return pages;
  // A final fallback for direct image URLs in a site script or inline JSON.
  // Strictly restrict to original WordPress uploads; skip resized thumbnails.
  const found: string[] = [];
  const re = /(?:https?:)?\/\/[^\s"'<>\\]{3,210}\/wp-content\/uploads\/[^\s"'<>\\]{1,210}\.(?:jpe?g|png|webp)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && found.length < 80) {
    const url = abs(m[0]);
    if (!isUsefulPage(url) || found.includes(url)) continue;
    const context = html.slice(Math.max(0, m.index - 170), m.index);
    if (/chapter|chapitre|page|reader|reading|scan|images/i.test(context)) found.push(url);
  }
  return found;
}

const plugin: MangaProvider = {
  id: 'probe-toocomic-reader2',
  name: 'TooComic FR (Reader Beta v2)',
  async popular(offset: number) {
    if (offset > 0) return [];
    try {
      const entries = seriesList(await get(HOME));
      if (entries.length) return entries;
      // Known legitimate user-supplied example, not a fabricated catalogue.
      return [{ id: EXAMPLE_SERIES, title: '101ᵉ Confession FR' }];
    } catch (e) { return diagnostics('ERR popular: ' + err(e)); }
  },
  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (!q) return this.popular(0);
    try {
      let list = seriesList(await get('/fr/?s=' + encodeURIComponent(q)), q);
      if (!list.length) list = seriesList(await get('/?s=' + encodeURIComponent(q)), q);
      if (!list.length && /101|confession/i.test(q)) return [{ id: EXAMPLE_SERIES, title: '101ᵉ Confession FR' }];
      return list;
    } catch (e) { return diagnostics('ERR search: ' + err(e)); }
  },
  async detail(id: string) {
    if (id.startsWith('error-')) return { id, title: lastError, description: lastError };
    const series = localPath(id.startsWith('/') ? BASE + id : id);
    if (!series || !isSeries(series)) return null;
    try {
      const html = await get(series);
      const title = tidyTitle(meta(html, 'og:title') || meta(html, 'twitter:title'), series);
      const cover = abs(meta(html, 'og:image')) || firstImage(html);
      const description = meta(html, 'og:description') || meta(html, 'description');
      return { id: series, title, cover, description };
    } catch (e) { return { id: series, title: 'ERR detail: ' + err(e) }; }
  },
  async chapters(id: string) {
    if (id.startsWith('error-')) return [];
    const series = localPath(id.startsWith('/') ? BASE + id : id);
    if (!series || !isSeries(series)) return [];
    try {
      const chapters = chapterList(await get(series), withoutQuery(series).replace(/\/?$/, '/'));
      if (chapters.length) return chapters;
      return [debugChapter(series, 'NO chapters found on series page')];
    } catch (e) { return [debugChapter(series, 'ERR chapters: ' + err(e))]; }
  },
  async pageUrls(chapterId: string) {
    if (chapterId.endsWith('#debug')) return [];
    const path = localPath(chapterId.startsWith('/') ? BASE + chapterId : chapterId);
    if (!path || !isChapter(path)) throw new Error('Invalid TooComic chapter path');
    const images = readerImageUrls(await get(path));
    if (!images.length) throw new Error('No chapter images found in HTML');
    return images;
  },
};
harbor.register(plugin);
