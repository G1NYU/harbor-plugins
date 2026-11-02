/**
 * TooComic FR — functional Harbor MangaProvider beta (testing repo only).
 * Origin: user's confirmed accessible chapter/series at www.toocomic.com.
 * No external runtime, browser globals, webview, cookies, or proxy required.
 *
 * Beta v4: long-series chapter discovery (1000+ supported).
 * Existing reader image code is preserved. Real-site coverage is unverified.
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

// v4: no assumption that an archive ends near chapter 400 or has only 15 pages.
// The base page may contain only the ten newest chapter links.
// Preserve actual site links; infer numbered URLs only after representative
// chapter pages have been verified with real reader images.
function mergeChapters(into: MangaChapter[], additional: MangaChapter[]): number {
  const seen = new Set(into.map(x => matchPath(x.id)));
  let inserted = 0;
  for (const chapter of additional) {
    const key = matchPath(chapter.id);
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(chapter);
    inserted++;
  }
  return inserted;
}
function chapterSort(chapters: MangaChapter[]): MangaChapter[] {
  return chapters.sort((a, b) => parseFloat(String(b.chapter ?? '0')) - parseFloat(String(a.chapter ?? '0')));
}

// The site could expose pagination in either an archive path or query string.
// Only follow links that keep the same manga series path.
type Pager = { path: (page: number) => string; last: number | null };
function discoverPager(html: string, series: string): Pager | null {
  const links = html.match(/<a\b[^>]*>/gi) || [];
  const candidates: { page: number; type: string; path: string }[] = [];
  const seriesKey = matchPath(series);
  for (const link of links) {
    const path = localPath(attr(link, 'href'));
    if (!path || !matchPath(path).startsWith(seriesKey)) continue;
    let m: RegExpExecArray | null;
    if ((m = /\/page\/(\d+)\/?(?:[?#]|$)/i.exec(path))) {
      candidates.push({ page: Number(m[1]), type: 'pretty', path });
    } else if ((m = /[?&](page|paged|chapter_page|chapters_page)=(\d+)/i.exec(path))) {
      candidates.push({ page: Number(m[2]), type: m[1].toLowerCase(), path });
    }
  }
  const valid = candidates.filter(c => c.page >= 2 && c.page <= 1000);
  if (!valid.length) return null;
  const chosen = valid.find(c => c.page === 2) || valid[0];
  const last = Math.max(...valid.filter(c => c.type === chosen.type).map(c => c.page));
  if (chosen.type === 'pretty') return {
    path: p => series + 'page/' + p + '/', last: last > 2 ? last : null,
  };
  return {
    path: p => series + '?' + chosen.type + '=' + p, last: last > 2 ? last : null,
  };
}
async function paginatedChapters(series: string, initialHtml: string, initial: MangaChapter[]): Promise<MangaChapter[]> {
  const out = initial.slice();
  const candidates: Pager[] = [];
  const discover = discoverPager(initialHtml, series);
  if (discover) candidates.push(discover);
  // Sites may not show page 2 in the initial HTML, so probe the standard forms.
  candidates.push({ path: p => series + 'page/' + p + '/', last: null });
  candidates.push({ path: p => series + '?paged=' + p, last: null });
  candidates.push({ path: p => series + '?page=' + p, last: null });
  const attempted = new Set<string>();
  for (const pager of candidates) {
    let page2 = '';
    const url = pager.path(2);
    if (attempted.has(url)) continue;
    attempted.add(url);
    try { page2 = await get(url); } catch (_e) { continue; }
    if (!mergeChapters(out, chapterList(page2, series))) continue;
    const onSecond = discoverPager(page2, series);
    const last = Math.max(pager.last || 0, onSecond?.last || 0);
    // Jump to the last linked archive when possible. This is much cheaper
    // than fetching 100+ lists just to discover the earliest chapter.
    if (last > 3) {
      try { mergeChapters(out, chapterList(await get(pager.path(last)), series)); }
      catch (_e) { /* Pagination may have changed. */ }
    }
    // Collect a bounded sample of real archive pages; numbered discovery
    // below handles large, regular ranges without one request per 10 links.
    const maxPages = last > 0 ? Math.min(last, 12) : 12;
    for (let page = 3; page <= maxPages; page++) {
      try { if (!mergeChapters(out, chapterList(await get(pager.path(page)), series))) break; }
      catch (_e) { break; }
    }
    break;
  }
  return chapterSort(out);
}

interface NumberedPattern { prefix: string; suffix: string; min: number; max: number; present: number[]; }
function numberedPattern(chapters: MangaChapter[]): NumberedPattern | null {
  // The latest ten can include a special chapter or renamed URL. Use the
  // dominant common pattern instead of requiring every single row to match.
  const groups: Record<string, { prefix: string; suffix: string; nums: number[] }> = {};
  for (const ch of chapters) {
    const m = /^(.*?chapitre[-_])(\d+)([^/?#]*\.html)$/i.exec(withoutQuery(ch.id));
    if (!m) continue;
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n < 1 || n > 10000) continue;
    const key = matchPath(m[1]) + m[3].toLowerCase();
    if (!groups[key]) groups[key] = { prefix: m[1], suffix: m[3], nums: [] };
    groups[key].nums.push(n);
  }
  const ranked = Object.values(groups).sort((a, b) => b.nums.length - a.nums.length);
  if (!ranked.length) return null;
  const g = ranked[0];
  const nums = Array.from(new Set(g.nums)).sort((a, b) => a - b);
  if (nums.length < 3) return null;
  const joined = nums.filter((n, i) => i && n === nums[i - 1] + 1).length;
  if (joined < 2 || nums.length < Math.min(chapters.length, 4) * 0.6) return null;
  return { prefix: g.prefix, suffix: g.suffix, min: nums[0], max: nums[nums.length - 1], present: nums };
}
async function verifyChapter(path: string, number: number): Promise<boolean> {
  try {
    const html = await get(path);
    const title = meta(html, 'og:title') ||
      textOnly((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html) || ['', ''])[1]);
    const canonical = meta(html, 'og:url') ||
      attr((html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [''])[0], 'href');
    const chapterTitleMatches = new RegExp('chapitre[-_\\s]*0*' + number + '(?!\\d)', 'i').test(title);
    const canonicalMatches = !!canonical && matchPath(localPath(canonical)) === matchPath(path);
    if (!chapterTitleMatches && !canonicalMatches) return false;
    return readerImageUrls(html).length > 0;
  } catch (_e) { return false; }
}
async function expandNumberedChapters(chapters: MangaChapter[]): Promise<MangaChapter[]> {
  const pattern = numberedPattern(chapters);
  if (!pattern) return chapters;
  const make = (n: number) => pattern.prefix + n + pattern.suffix;
  let earliest = pattern.min;
  if (pattern.min > 1) {
    const preceding = pattern.min - 1;
    // We only extrapolate below the oldest known URL if its immediate
    // predecessor is an actual chapter page with reader images.
    if (await verifyChapter(make(preceding), preceding)) {
      earliest = preceding;
      if (await verifyChapter(make(1), 1)) earliest = 1;
      else {
        // Some series do not begin at chapter 1. Locate their accessible
        // lower boundary with O(log N) probes, rather than making up links.
        let notFound = 1, found = preceding;
        while (found - notFound > 1) {
          const mid = Math.floor((found + notFound) / 2);
          if (await verifyChapter(make(mid), mid)) found = mid;
          else notFound = mid;
        }
        earliest = found;
      }
    }
  }

  // When pagination jumps straight to the last page, the index contains
  // 1..10 and 991..1000 but not the middle. Find and verify *every gap* in
  // the observed numeric sequence rather than stopping just because 1 exists.
  const present = new Set(pattern.present);
  const runs: Array<{ first: number; last: number }> = [];
  for (let n = earliest; n <= pattern.max;) {
    if (present.has(n)) { n++; continue; }
    const first = n;
    while (n <= pattern.max && !present.has(n)) n++;
    runs.push({ first, last: n - 1 });
  }
  // A small request budget protects Harbor against malformed archives.
  let budget = 30;
  const inferred: MangaChapter[] = [];
  for (const run of runs) {
    const length = run.last - run.first + 1;
    const picks = length <= 6
      ? Array.from({ length }, (_, i) => run.first + i)
      : [run.first, run.last,
          run.first + Math.floor(length * 0.25),
          run.first + Math.floor(length * 0.50),
          run.first + Math.floor(length * 0.75)];
    const sample = Array.from(new Set(picks));
    if (sample.length > budget) break;
    budget -= sample.length;
    const results = await Promise.all(sample.map(n => verifyChapter(make(n), n)));
    if (results.some(ok => !ok)) continue;
    for (let n = run.first; n <= run.last; n++) {
      inferred.push({ id: make(n), chapter: String(n), title: 'Chapitre ' + n, pages: 0, language: 'fr' });
    }
  }
  mergeChapters(chapters, inferred);
  return chapterSort(chapters);
}
async function allChapters(series: string): Promise<MangaChapter[]> {
  const html = await get(series);
  const visible = chapterList(html, series);
  if (!visible.length) return [];
  const paginated = await paginatedChapters(series, html, visible);
  // A page containing chapter 1 is not necessarily the *full* index; the
  // site might have jumped from the newest ten directly to the first ten.
  return await expandNumberedChapters(paginated);
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
  id: 'probe-toocomic-reader4',
  name: 'TooComic FR (Reader Beta v4)',
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
      const chapters = await allChapters(withoutQuery(series).replace(/\/?$/, '/'));
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
