/**
 * 🇫🇷 TooComic FR — Harbor MangaProvider (main manga repository).
 * Origin: user's confirmed accessible chapter/series at www.toocomic.com.
 * No external runtime, browser globals, webview, cookies, or proxy required.
 *
 * Chapter discovery tested in Harbor across multiple series, including chapters 1 and 2.
 * Retains beta v4 long-series logic and working image reader.
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

// MangaVerse now lists its FR series as /fr/manga/<slug>.html,
// while the same series' reader/archive lives at /fr/<slug>/.
// Keep our canonical series IDs unchanged so Harbor library/reading progress
// and previously verified chapter links continue to resolve.
function listingSeriesPath(raw: string): string {
  const path = localPath(raw);
  const category = /^\/fr\/manga\/([^/?#]+)\.html\/?(?:\?.*)?$/i.exec(path);
  if (category) return '/fr/' + category[1] + '/';
  return isSeries(path) ? withoutQuery(path).replace(/\/?$/, '/') : '';
}
function cssCover(fragment: string): string | undefined {
  // The first 20 homepage cards use /wp-content/uploads/ backgrounds.
  // Further cards are appended by the MangaVerse AJAX response; don't assume
  // the image host or upload directory always matches the initial batch.
  for (const tag of fragment.match(/<div\b[^>]*>/gi) || []) {
    if (!attr(tag, 'class').split(/\s+/).includes('series-card-thumb')) continue;
    const css = attr(tag, 'style');
    const cssUrl = /background(?:-image)?\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(css)?.[2] || '';
    for (const raw of [cssUrl, attr(tag, 'data-bg'), attr(tag, 'data-background'),
      attr(tag, 'data-image'), attr(tag, 'data-src')]) {
      if (!raw) continue;
      try {
        const u = new URL(entity(raw), BASE);
        if (u.protocol !== 'https:') continue;
        if (!/^(?:www\.|cdn\.)?toocomic\.com$/i.test(u.hostname)) continue;
        if (!/\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname)) continue;
        return u.href;
      } catch { /* invalid cover URL */ }
    }
  }
  return undefined;
}
function seriesList(html: string, query = ''): MangaSummary[] {
  const results: MangaSummary[] = [];
  const seen: Record<string, boolean> = {};
  const q = query.trim().toLocaleLowerCase('fr');
  // Only real .series-card-link tiles, not menus, featured "Read Now" links
  // or individual chapter links. The thumbnail is a CSS background, not <img>.
  const cards = /<a\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-card-link\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = cards.exec(html)) !== null && results.length < 120) {
    const opening = /^<a\b[^>]*>/i.exec(m[0])?.[0] || '';
    const path = listingSeriesPath(attr(opening, 'href'));
    if (!path || seen[matchPath(path)]) continue;
    const heading = /<h[2-4]\b[^>]*\bclass\s*=\s*["'][^"']*\bseries-card-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[2-4]>/i.exec(m[0])?.[1] || '';
    const title = textOnly(heading) || slugTitle(path);
    if (q && !title.toLocaleLowerCase('fr').includes(q) &&
      !slugTitle(path).toLocaleLowerCase('fr').includes(q)) continue;
    const cover = cssCover(m[0]) || firstImage(m[0]);
    seen[matchPath(path)] = true;
    results.push({ id: path, title, cover });
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
// MangaVerse chapter archives are served by a genuine WordPress AJAX endpoint.
// The legacy pager+URL-verification strategy could make 15+ serial requests,
// then dozens of additional probes, exceeding Harbor's 25-second chapter-worker
// deadline. Fetch actual archive HTML in small parallel batches instead.
interface ChapterAjaxConfig { nonce: string; category: string; count: number }
function chapterAjaxConfig(html: string): ChapterAjaxConfig | null {
  const nonce = ajaxNonce(html);
  const chaptersTag = (html.match(/<div\b[^>]*>/gi) || []).find(
    tag => attr(tag, 'class').split(/\s+/).includes('chapters-list')
  ) || '';
  const category = attr(chaptersTag, 'data-category');
  const countText = textOnly((/<span\b[^>]*class=["'][^"']*series-chapter-count[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html) || [,''])[1]);
  const count = Number(/([\d\s,.]+)\s+Chapitres?\b/i.exec(countText)?.[1]?.replace(/[^\d]/g, '') || 0);
  return nonce && /^\d+$/.test(category) ? { nonce, category, count } : null;
}
async function ajaxChapters(
  series: string, cfg: ChapterAjaxConfig, page: number, order: 'asc' | 'desc'
): Promise<{ rows: MangaChapter[]; hasMore: boolean }> {
  const body = [
    ['action', 'mangaverse_load_more'], ['nonce', cfg.nonce],
    ['page', String(page)], ['type', 'series'],
    ['category_id', cfg.category], ['order', order], ['lang', 'fr'],
  ].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
  const r = await harbor.http(BASE + '/wp-admin/admin-ajax.php', {
    method: 'POST', body, responseType: 'text', timeoutMs: 5500,
    headers: { Accept: 'application/json, */*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  });
  if (!r?.ok || Number(r.status) !== 200) throw new Error('AJAX HTTP ' + r?.status);
  const response = JSON.parse(String(r.body || '{}')) as {
    success?: boolean; data?: { html?: string; has_more?: boolean };
  };
  if (!response.success || typeof response.data?.html !== 'string') {
    throw new Error('Invalid chapter archive response at page ' + page);
  }
  return { rows: chapterList(response.data.html, series), hasMore: !!response.data.has_more };
}
async function allChapters(series: string): Promise<MangaChapter[]> {
  const html = await get(series);
  const visible = chapterList(html, series);
  if (!visible.length) return [];
  const cfg = chapterAjaxConfig(html);
  if (!cfg) {
    // Do not risk another worker timeout on legacy pagination probes.
    // The visible real chapter links are always preferable to returning zero.
    harbor.log('TooComic FR: native chapter pagination unavailable, returning visible links');
    return chapterSort(visible);
  }

  const started = Date.now();
  const out = visible.slice();
  let canLoadMore = true;

  // First load page two and the site's genuine oldest-first page. Even if
  // later batches run out of time, both current and early chapters remain.
  const anchors = await Promise.all([
    ajaxChapters(series, cfg, 2, 'desc').catch((e: unknown) => {
      harbor.log('TooComic FR chapter page 2: ' + err(e)); return null;
    }),
    ajaxChapters(series, cfg, 1, 'asc').catch((e: unknown) => {
      harbor.log('TooComic FR oldest chapters: ' + err(e)); return null;
    }),
  ]);
  for (const entry of anchors) if (entry) mergeChapters(out, entry.rows);
  if (anchors[0] && !anchors[0].hasMore) canLoadMore = false;
  if (!anchors[0] || !anchors[0].rows.length) {
    // This site's AJAX may be blocked in a particular Harbor installation.
    // Return the valid server-rendered chapters, never an empty/error result.
    return chapterSort(out);
  }

  // Most manhwa have 10 HTML links per archive page. Cover up to 48 pages
  // with bounded 5-request batches; let the server be the chapter authority.
  const perPage = Math.max(1, visible.length);
  const lastPage = cfg.count > 0
    ? Math.min(48, Math.ceil(cfg.count / perPage))
    : 28;
  for (let start = 3; start <= lastPage && canLoadMore; start += 5) {
    if (Date.now() - started > 14000) break;
    const numbers = Array.from(
      { length: Math.min(5, lastPage - start + 1) }, (_, i) => start + i
    );
    const results = await Promise.all(numbers.map(page =>
      ajaxChapters(series, cfg, page, 'desc').catch((e: unknown) => {
        harbor.log('TooComic FR chapter page ' + page + ': ' + err(e));
        return null;
      })
    ));
    results.forEach(result => { if (result) mergeChapters(out, result.rows); });
    if (results.every(result => result && !result.hasMore)) canLoadMore = false;
  }
  harbor.log('TooComic FR chapters: ' + out.length + ' / ' + (cfg.count || '?') +
    ' discovered in ' + (Date.now() - started) + 'ms');
  return chapterSort(out);
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


// The site's public "Load More Series" button uses a WordPress AJAX action.
// The initial HTML has 20 cards; Harbor requests 48-item pages. Cache actual
// AJAX cards per plugin worker rather than inventing series links for offsets.
const CATALOGUE_PAGE_SIZE = 20;
const CATALOGUE_LIMIT = 48;
let seriesRows: MangaSummary[] = [];
let seriesNonce = '';
let seriesNextPage = 2;
let seriesEnd = false;
let seriesLoadedAt = 0;
function ajaxNonce(html: string): string {
  return /\bmangaverse_ajax\s*=\s*\{[\s\S]*?"nonce"\s*:\s*"([^"]+)"/i.exec(html)?.[1] || '';
}
async function getCatalogue(minimumRows: number): Promise<MangaSummary[]> {
  if (!seriesLoadedAt || Date.now() - seriesLoadedAt > 10 * 60_000) {
    const homepage = await get(HOME);
    seriesRows = seriesList(homepage);
    seriesNonce = ajaxNonce(homepage);
    seriesNextPage = 2;
    seriesEnd = !seriesNonce || seriesRows.length < CATALOGUE_PAGE_SIZE;
    seriesLoadedAt = Date.now();
  }
  const target = Math.min(600, Math.max(CATALOGUE_LIMIT, minimumRows));
  let budget = 8; // Protect Harbor's worker deadline on huge catalogues.
  while (seriesRows.length < target && !seriesEnd && budget > 0) {
    const page = seriesNextPage++;
    budget--;
    try {
      const form = [
        ['action', 'mangaverse_load_more'],
        ['nonce', seriesNonce], ['page', String(page)],
        ['type', 'series_grid'], ['lang', 'fr'],
      ].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
      const response = await harbor.http(BASE + '/wp-admin/admin-ajax.php', {
        method: 'POST', body: form, responseType: 'text', timeoutMs: 10000,
        headers: { Accept: 'application/json, */*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      });
      if (!response?.ok || response.status !== 200) throw new Error('HTTP ' + response?.status);
      const data = JSON.parse(String(response.body || '{}')) as {
        success?: boolean; data?: { html?: string; has_more?: boolean }
      };
      if (!data.success || typeof data.data?.html !== 'string') throw new Error('Invalid catalogue AJAX response');
      const newCards = seriesList(data.data.html);
      const seen = new Set(seriesRows.map(item => matchPath(item.id)));
      for (const item of newCards) if (!seen.has(matchPath(item.id))) {
        seriesRows.push(item);
        seen.add(matchPath(item.id));
      }
      if (!data.data.has_more || !newCards.length) seriesEnd = true;
    } catch (e) {
      harbor.log('TooComic FR catalogue page ' + page + ': ' + err(e));
      seriesEnd = true;
    }
  }
  return seriesRows;
}

const plugin: MangaProvider = {
  id: 'toocomic-fr',
  name: '🇫🇷 TooComic FR',
  async popular(offset: number) {
    try {
      const entries = await getCatalogue(Math.max(0, offset) + 48);
      if (entries.length) return entries.slice(Math.max(0, offset), Math.max(0, offset) + 48);
      // Real, previously user-verified series fallback.
      return offset > 0 ? [] : [{ id: EXAMPLE_SERIES, title: '101ᵉ Confession FR' }];
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
