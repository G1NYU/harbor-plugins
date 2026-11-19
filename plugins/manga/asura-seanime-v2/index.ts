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
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  Referer: API + '/',
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
  // Astro does not guarantee attribute order, SSR flags, or a fixed client directive.
  for (const tag of html.match(/<astro-island\b[^>]*>/gi) || []) {
    const identity = readerAttr(tag, 'component-url') + ' ' + readerAttr(tag, 'opts');
    if (!identity.includes(component)) continue;
    try {
      return JSON.parse(readerAttr(tag, 'props'));
    } catch (_) { /* Try the next island. */ }
  }
  return null;
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

// Seanime 1.1.3 accepts absolute and root-relative series IDs. Avoid a double host.
function siteUrl(id: string): string {
  const value = String(id || '').trim();
  if (/^https?:\/\//i.test(value)) {
    if (!/^https:\/\/(?:www\.)?asurascans\.com\/comics\//i.test(value)) {
      throw new Error('Invalid Asura series URL');
    }
    return value;
  }
  if (!/^\/?comics\//i.test(value)) throw new Error('Invalid Asura series path');
  return API + (value.startsWith('/') ? '' : '/') + value;
}

// Some Asura builds server-render their catalogue without initialSeries props.
// Read only series links, not the site's unrelated navigation and recommendations.
function seriesFromLinks(html: string): MangaSummary[] {
  const out = new Map<string, MangaSummary>();
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const open = /^<a\b[^>]*>/i.exec(match[0])?.[0] || '';
    const rawHref = readerAttr(open, 'href');
    const id = rawHref.replace(/^https?:\/\/(?:www\.)?asurascans\.com/i, '').split(/[?#]/)[0];
    if (!/^\/comics\/[^/]+\/?$/.test(id)) continue;
    const img = /<img\b[^>]*>/i.exec(match[0])?.[0] || '';
    const heading = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i.exec(match[0]);
    const title = decodeEntities((heading?.[1] || readerAttr(img, 'alt') || '')
      .replace(/<[^>]*>/g, '').trim()) || id.split('/').filter(Boolean).pop() || id;
    const srcset = readerAttr(img, 'srcset').split(',')[0].trim().split(/\s+/)[0];
    const cover = [readerAttr(img, 'data-src'), readerAttr(img, 'src'), srcset]
      .map(absUrl).find(Boolean);
    const existing = out.get(id);
    if (!existing) out.set(id, { id, title, cover });
    else out.set(id, { id, title: existing.title || title, cover: existing.cover || cover });
  }
  return [...out.values()];
}

function parseSeries(html: string): MangaSummary[] | null {
  const props = astroProps(html, 'BrowseFilters');
  const list = astroVal(props?.['initialSeries']);
  const out: MangaSummary[] = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      const s = astroVal(entry);
      if (!s || typeof s !== 'object') continue;
      const slug = astroVal(s['slug']);
      if (!slug) continue;
      const title = astroVal(s['title']);
      const publicUrl = astroVal(s['public_url']);
      const rawId = String(publicUrl || '/comics/' + slug);
      const id = rawId.replace(/^https?:\/\/(?:www\.)?asurascans\.com/i, '');
      out.push({ id, title: String(title || slug), cover: absUrl(astroVal(s['cover'])) });
    }
  }
  if (out.length) return out;
  const linked = seriesFromLinks(html);
  return linked.length || props ? linked : null;
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
      const html = await getHtml(siteUrl(id));
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
      const html = await getHtml(siteUrl(id));
      // Accept HTML entities and escaped attributes as in upstream Seanime 1.1.3.
      const normalizedHtml = html.replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'")
        .replace(/&amp;/gi, '&').replace(/\\(["'])/g, '$1');
      const re = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1/gi;
      const seen: Record<string, boolean> = {};
      const out: MangaChapter[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(normalizedHtml)) !== null) {
        const href = decodeEntities(m[2]).replace(/^https?:\/\/(?:www\.)?asurascans\.com/i, '').split(/[?#]/)[0];
        const found = /^\/comics\/[^/]+\/chapter\/([^/]+)\/?$/.exec(href);
        if (!found) continue;
        const num = found[1];
        if (seen[num]) continue;
        seen[num] = true;
        out.push({ id: href, chapter: num, title: 'Chapter ' + num, pages: 0, language: 'en' });
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
    const url = siteUrl(chapterId);
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
