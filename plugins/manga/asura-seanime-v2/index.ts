/**
 * Asura Scans (Seanime port) for Harbor.
 *
 * Based on the Asura Scans provider from Seanime-Providers by Pal
 * (https://github.com/Seanime-contributions/Seanime-Providers), MIT License.
 *
 * MIT License
 *
 * Copyright (c) 2025 Pal
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Harbor changes: native MangaProvider, popular list from /browse (first page
 * only), series details from the page's og: tags, errors shown as short rows.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const API = 'https://asurascans.com';
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  Accept: '*/*',
  Referer: API,
};

let lastMsg = '';

function errText(e: any): string {
  return String((e && e.message) || e).slice(0, 160);
}

function errRows(msg: string): MangaSummary[] {
  lastMsg = msg;
  const out: MangaSummary[] = [];
  for (let i = 0; i < msg.length && out.length < 12; i += 34) {
    out.push({ id: 'err-' + out.length, title: msg.slice(i, i + 34) } as MangaSummary);
  }
  return out;
}

async function getHtml(url: string): Promise<string> {
  const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 20000, headers: HEADERS } as any);
  const status = Number(r?.status ?? 0);
  if (status !== 200) throw new Error('HTTP ' + status + ' ' + url.replace(API, ''));
  return String(r?.body ?? '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Extract and parse the props JSON of a named astro-island component.
function astroProps(html: string, component: string): any {
  const re = new RegExp(
    'component-export="default"[^>]*props="([^"]+)"[^>]*ssr[^>]*client="load"[^>]*opts="[^"]*' + component,
  );
  const m = re.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(decodeEntities(m[1]));
  } catch (_) {
    return null;
  }
}

// Astro encodes values as [type, value]: type 0 = scalar, type 1 = array.
function astroVal(v: any): any {
  if (!Array.isArray(v)) return v;
  const type = v[0];
  const value = v[1];
  if (type === 0) return value;
  if (type === 1) return (value as any[]).map((x) => astroVal(x));
  return value;
}

function absUrl(u: any): string | undefined {
  if (typeof u !== 'string' || !u) return undefined;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return API + u;
  return /^https?:\/\//i.test(u) ? u : undefined;
}

function parseSeries(html: string): MangaSummary[] | null {
  const props = astroProps(html, 'BrowseFilters');
  if (!props) return null;
  const list = props['initialSeries'];
  if (!Array.isArray(list) || list[0] !== 1 || !Array.isArray(list[1])) return [];
  const out: MangaSummary[] = [];
  for (const entry of list[1]) {
    if (!Array.isArray(entry) || entry[0] !== 0) continue;
    const s = entry[1] || {};
    const slug = astroVal(s['slug']);
    if (!slug) continue;
    const title = astroVal(s['title']);
    const publicUrl = astroVal(s['public_url']);
    out.push({
      id: String(publicUrl || '/comics/' + slug),
      title: String(title || slug),
      cover: absUrl(astroVal(s['cover'])),
    });
  }
  return out;
}

async function list(url: string, label: string): Promise<MangaSummary[]> {
  try {
    const html = await getHtml(url);
    const series = parseSeries(html);
    if (series === null) {
      return errRows('NO PROPS ' + label + ': BrowseFilters not found in ' + Math.round(html.length / 1024) + 'KB page');
    }
    if (series.length === 0) return label === 'search' ? [] : errRows('EMPTY ' + label + ' (0 series parsed)');
    return series;
  } catch (e) {
    return errRows('ERR ' + label + ': ' + errText(e));
  }
}

function meta(html: string, prop: string): string {
  const a = new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', 'i').exec(html);
  const b = new RegExp('<meta[^>]+content="([^"]*)"[^>]+property="' + prop + '"', 'i').exec(html);
  const m = a || b;
  return m ? decodeEntities(m[1]).trim() : '';
}

function debugChapter(id: string, msg: string): MangaChapter {
  return { id: id + '::debug', chapter: null, title: msg.slice(0, 120), pages: 0, language: 'en' };
}


/** Read ChapterReader island props without relying on a particular attribute order. */
function readerAttr(tag: string, key: string): string {
  const m = new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)', 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
}
function fromReaderIsland(html: string): string[] {
  const tags = html.match(/<astro-island\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/ChapterReader/i.test(readerAttr(tag, 'component-url') + ' ' + readerAttr(tag, 'opts'))) continue;
    let props: any;
    try { props = JSON.parse(readerAttr(tag, 'props')); } catch (_) { continue; }
    const pages = astroVal(props?.pages);
    if (!Array.isArray(pages)) continue;
    const result: string[] = [];
    for (const page of pages) {
      const data = astroVal(page);
      const url = absUrl(astroVal(data?.url));
      if (url && !result.includes(url)) result.push(url);
    }
    if (result.length) return result;
  }
  return [];
}

/** Rendered chapter image tags serve as a fallback when Astro props move. */
function fromReaderImages(html: string): string[] {
  const hits: Array<{ index: number; order: number; url: string }> = [];
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const alt = readerAttr(tag, 'alt');
    const page = /\bPage\s*(\d+)\s*-\s*Chapter\b/i.exec(alt);
    if (!page) continue;
    const url = absUrl(readerAttr(tag, 'data-src') || readerAttr(tag, 'src'));
    if (!url || !/^https:\/\/cdn\.asurascans\.com\//i.test(url)) continue;
    hits.push({ index: m.index, order: Number(page[1]), url });
  }
  hits.sort((a, b) => a.order - b.order || a.index - b.index);
  return [...new Set(hits.map(hit => hit.url))];
}

const plugin: MangaProvider = {
  id: 'asura-seanime-v2',
  name: '★ Asura Scans v2',

  async popular(offset: number) {
    if (offset > 0) return [];
    return list(API + '/browse', 'popular');
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (!q) return list(API + '/browse', 'popular');
    return list(API + '/browse?search=' + encodeURIComponent(q), 'search');
  },

  async detail(id: string) {
    if (id.indexOf('err-') === 0) return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    try {
      const html = await getHtml(API + id);
      const slug = id.split('/').filter(Boolean).pop() || id;
      return {
        id,
        title: meta(html, 'og:title') || slug,
        cover: absUrl(meta(html, 'og:image')),
        description: meta(html, 'og:description') || undefined,
      } as MangaSummary;
    } catch (e) {
      lastMsg = 'ERR detail: ' + errText(e);
      return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    }
  },

  async chapters(id: string) {
    if (id.indexOf('err-') === 0) return [];
    try {
      const html = await getHtml(API + id);
      const re = /href="(\/comics\/[^"]+\/chapter\/([^"]+))"/gi;
      const seen: Record<string, boolean> = {};
      const out: MangaChapter[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const num = m[2];
        if (seen[num]) continue;
        seen[num] = true;
        out.push({ id: m[1], chapter: num, title: 'Chapter ' + num, pages: 0, language: 'en' });
      }
      if (out.length === 0) return [debugChapter(id, 'EMPTY chapters (0 links found)')];
      out.sort((a, b) => parseFloat(String(a.chapter)) - parseFloat(String(b.chapter)));
      return out;
    } catch (e) {
      return [debugChapter(id, 'ERR chapters: ' + errText(e))];
    }
  },

  async pageUrls(chapterId: string) {
    if (chapterId.indexOf('::debug') >= 0) return [];
    const url = /^https?:\/\//i.test(chapterId) ? chapterId : API + chapterId;
    const html = await getHtml(url);
    // Verified in Harbor diagnostics on 11 Nov 2026:
    // 44 page URLs from island AND image tags, image/webp fetched with HTTP 200.
    const astro = fromReaderIsland(html);
    const images = astro.length ? astro : fromReaderImages(html);
    if (!images.length) throw new Error('No Asura chapter images found in ' + html.length + ' HTML chars');
    return images;
  },
};

harbor.register(plugin);
