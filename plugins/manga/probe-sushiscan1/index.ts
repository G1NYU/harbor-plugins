/**
 * SushiScan FR compatibility probe for Harbor.
 * Test-only source. Does not publish manga chapters to the main repository.
 *
 * Search terms inside Harbor:
 *   chapter   -> chapter page and embedded reader data
 *   series    -> series details and chapter-link detection
 *   catalogue -> catalogue listing and series-link detection
 *   image     -> retrieve the first reader image with plain harbor.http
 *   anything else -> WordPress search page
 *
 * A plain image request intentionally sends no Referer/Cookie. This tests
 * whether the page-host request works within Harbor's actual HTTP bridge.
 */
import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://sushiscan.net';
const CHAPTER = '/black-clover-chapitre-392/';
const SERIES = '/catalogue/black-clover/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*',
};
let lastRows: string[] = [];

function errorMessage(e: unknown): string {
  return String(e instanceof Error ? e.message : e).slice(0, 160);
}

function lines(parts: string[]): MangaSummary[] {
  const out: MangaSummary[] = [];
  lastRows = [];
  for (const part of parts) {
    for (let i = 0; i < part.length && out.length < 16; i += 34) {
      const line = part.slice(i, i + 34);
      lastRows.push(line);
      out.push({ id: 'diag-' + out.length, title: line });
    }
  }
  return out;
}

function absolute(url: string): string {
  const s = String(url || '').replace(/&amp;/g, '&').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.indexOf('//') === 0) return 'https:' + s;
  if (s.indexOf('/') === 0) return BASE + s;
  return '';
}

function hostOf(url: string): string {
  return url.split('/')[2] || '(unknown host)';
}

async function html(path: string): Promise<{ status: number; body: string }> {
  const r = await harbor.http(BASE + path, {
    responseType: 'text',
    timeoutMs: 8000,
    headers: HEADERS,
  });
  return { status: Number(r?.status ?? 0), body: String(r?.body ?? '') };
}

// Find the JSON object supplied to the reader script without assuming the
// JSON has no nested braces, parentheses, or escaped quotes.
function readerPages(source: string): string[] {
  const match = /ts_reader\.run\s*\(\s*/.exec(source);
  if (match) {
    const start = match.index + match[0].length;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < source.length && i < start + 2000000; i++) {
      const ch = source.charAt(i);
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else {
        if (ch === '"') quoted = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const data = JSON.parse(source.slice(start, i + 1));
              const sources = Array.isArray(data?.sources) ? data.sources : [];
              for (const item of sources) {
                if (!Array.isArray(item?.images)) continue;
                const arr = item.images.map((v: unknown) => absolute(String(v))).filter((v: string) => v && !/\.svg(?:\?|$)/i.test(v));
                if (arr.length) return arr;
              }
            } catch (_e) {
              // Inspect the HTML image fallback below instead.
            }
            break;
          }
        }
      }
    }
  }

  const reader = source.search(/id=["']readerarea["']/i);
  if (reader < 0) return [];
  const snippet = source.slice(reader, reader + 100000);
  const matches = snippet.match(/<img\b[^>]*>/gi) || [];
  const pages: string[] = [];
  for (const tag of matches) {
    const attr = /\b(?:data-src|data-lazy-src|data-original|src)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!attr) continue;
    const url = absolute(attr[1]);
    if (url && !/\.svg(?:\?|$)/i.test(url) && pages.indexOf(url) < 0) pages.push(url);
  }
  return pages;
}

async function checkChapter(testImage: boolean): Promise<MangaSummary[]> {
  const r = await html(CHAPTER);
  const parts = ['CHAPTER HTTP ' + r.status, 'HTML bytes ' + r.body.length];
  if (r.status !== 200) return lines([...parts, 'Blocked or unavailable', r.body.slice(0, 110).replace(/<[^>]*>/g, ' ')]);
  parts.push('readerarea ' + (/id=["']readerarea["']/i.test(r.body) ? 'yes' : 'no'));
  parts.push('ts_reader ' + (/ts_reader\.run\s*\(/.test(r.body) ? 'yes' : 'no'));
  const images = readerPages(r.body);
  parts.push('Reader images ' + images.length);
  if (images.length) {
    parts.push('Image host ' + hostOf(images[0]));
    parts.push('Image URL ' + images[0].slice(0, 90));
  }
  if (!testImage || !images.length) return lines(parts);
  try {
    const im = await harbor.http(images[0], { responseType: 'base64', timeoutMs: 8000, headers: { Accept: 'image/*,*/*' } });
    parts.push('IMAGE HTTP ' + Number(im?.status ?? 0));
    parts.push('Image body chars ' + String(im?.body ?? '').length);
  } catch (e) {
    parts.push('IMAGE ERR ' + errorMessage(e));
  }
  return lines(parts);
}

async function checkSeries(): Promise<MangaSummary[]> {
  const r = await html(SERIES);
  const paths = r.body.match(/href=["'][^"']*black-clover-chapitre-[^"']+["']/gi) || [];
  const chapterRows = (r.body.match(/\b(?:eph-num|chapternum|chapterdate)\b/gi) || []).length;
  return lines([
    'SERIES HTTP ' + r.status, 'HTML bytes ' + r.body.length,
    'chapter href matches ' + paths.length, 'chapter class matches ' + chapterRows,
    'first href ' + (paths[0] || '(none)').slice(0, 90),
  ]);
}

async function checkCatalogue(): Promise<MangaSummary[]> {
  const r = await html('/catalogue/');
  const itemCount = (r.body.match(/class=["'][^"']*\bbsx\b/gi) || []).length;
  const links = (r.body.match(/href=["'][^"']*\/catalogue\/[^"'?#]+\/?["']/gi) || []).length;
  return lines([
    'CATALOGUE HTTP ' + r.status, 'HTML bytes ' + r.body.length,
    'bsx items ' + itemCount, 'series links ' + links,
  ]);
}

async function checkSearch(q: string): Promise<MangaSummary[]> {
  const r = await html('/?s=' + encodeURIComponent(q));
  const itemCount = (r.body.match(/class=["'][^"']*\bbsx\b/gi) || []).length;
  const links = (r.body.match(/href=["'][^"']*\/catalogue\/[^"'?#]+\/?["']/gi) || []).length;
  return lines([
    'SEARCH HTTP ' + r.status, 'query ' + q, 'HTML bytes ' + r.body.length,
    'bsx items ' + itemCount, 'series links ' + links,
  ]);
}

const plugin: MangaProvider = {
  id: 'probe-sushiscan1',
  name: 'Probe SushiScan FR v1',
  async popular(_offset: number) {
    try { return await checkChapter(false); }
    catch (e) { return lines(['CHAPTER ERR ' + errorMessage(e)]); }
  },
  async search(query: string, _offset: number) {
    try {
      const q = String(query || '').trim().toLowerCase();
      if (!q || q === 'chapter') return await checkChapter(false);
      if (q === 'image') return await checkChapter(true);
      if (q === 'series') return await checkSeries();
      if (q === 'catalogue') return await checkCatalogue();
      return await checkSearch(query);
    } catch (e) { return lines(['SEARCH ERR ' + errorMessage(e)]); }
  },
  async detail(id: string) {
    return { id, title: lastRows.join(' | ').slice(0, 110) || 'SushiScan diagnostics', description: lastRows.join('\n') };
  },
  async chapters(_id: string) { return []; },
  async pageUrls(_chapterId: string) { return []; },
};

harbor.register(plugin);
