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

const plugin: MangaProvider = {
  id: 'asura-seanime',
  name: '★ Asura Scans',

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
    const props = astroProps(html, 'ChapterReader');
    if (!props) throw new Error('ChapterReader props not found');
    const pages = props['pages'];
    if (!Array.isArray(pages) || pages[0] !== 1 || !Array.isArray(pages[1])) throw new Error('No pages data in props');
    const out: string[] = [];
    for (const entry of pages[1]) {
      if (!Array.isArray(entry) || entry[0] !== 0) continue;
      const u = absUrl(astroVal((entry[1] || {})['url']));
      if (u) out.push(u);
    }
    if (out.length === 0) throw new Error('0 page images found');
    return out;
  },
};

harbor.register(plugin);
