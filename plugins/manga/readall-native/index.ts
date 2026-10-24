/**
 * ReadAllComics (native) for Harbor.
 *
 * Written for Harbor from scratch. The page layout (CSS classes, URL shapes, chapter title
 * rules) was learned from the ReadAllComics extension in karrot0/KakarotExtension, which is
 * MIT licensed:
 *
 * Copyright 2024 Paperback Community
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * The page parsing here is regex based because the exact HTML was not inspected; expect small
 * mismatches. Search for 'diag' to time the site and test the image hosts.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const SITE = 'https://readallcomics.com';
const BLOGSPOT = 'https://2.bp.blogspot.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

let lastMsg = '';

function errText(e: any): string {
  return String((e && e.message) || e).slice(0, 380);
}

function toRows(prefix: string, msg: string, max: number): MangaSummary[] {
  const out: MangaSummary[] = [];
  for (let i = 0; i < msg.length && out.length < max; i += 34) {
    out.push({ id: prefix + out.length, title: msg.slice(i, i + 34) } as MangaSummary);
  }
  return out;
}

function errRows(msg: string): MangaSummary[] {
  lastMsg = msg;
  return toRows('err-', msg, 12);
}

function isRow(id: string): boolean {
  return id.indexOf('err-') === 0 || id.indexOf('diag-') === 0;
}

// Make sure a request that hangs ends in an error row instead of Harbor's own "source did not respond"
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (typeof setTimeout !== 'function') return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('TIMEOUT ' + Math.round(ms / 1000) + 's ' + label)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function getHtml(url: string): Promise<string> {
  const label = url.replace(SITE, '') || '/';
  const r: any = await withTimeout(
    harbor.http(url, { responseType: 'text', timeoutMs: 8000, headers: { 'User-Agent': UA } } as any),
    10000,
    label,
  );
  const status = Number(r?.status ?? 0);
  if (status !== 200) {
    const snippet = String(r?.body ?? '').replace(/\s+/g, ' ').slice(0, 90);
    throw new Error('HTTP ' + status + ' ' + label + (snippet ? ' | ' + snippet : ''));
  }
  return String(r?.body ?? '');
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function strip(s: string): string {
  return decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(tag: string, name: string): string {
  const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'i').exec(tag);
  return m ? decode(m[1]) : '';
}

function fixUrl(u: string): string | undefined {
  const t = (u || '').trim();
  if (!t) return undefined;
  if (t.startsWith('//')) return 'https:' + t;
  if (t.startsWith('/')) return BLOGSPOT + t;
  return /^https?:\/\//i.test(t) ? t : undefined;
}

function parseList(html: string): MangaSummary[] {
  const out: MangaSummary[] = [];
  const seen: Record<string, boolean> = {};
  const blocks = html.split(/<li[\s>]/i).slice(1);
  for (const b of blocks) {
    if (b.indexOf('cat-title') < 0) continue;
    const link = /href="[^"]*?\/category\/([^/"?#]+)\/?[^"]*"/i.exec(b);
    if (!link) continue;
    const id = link[1];
    if (seen[id]) continue;
    const t = /<a[^>]*cat-title[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    const title = t ? strip(t[1]) : '';
    if (!title) continue;
    const imgTag = /<img[^>]*book-cover[^>]*>/i.exec(b);
    const raw = imgTag ? attr(imgTag[0], 'data-src') || attr(imgTag[0], 'src') : '';
    const date = /latest-date[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i.exec(b);
    seen[id] = true;
    out.push({
      id,
      title,
      cover: fixUrl(raw),
      lastChapter: date ? strip(date[1]).replace('Updated:', '').trim() || undefined : undefined,
    });
  }
  return out;
}

async function list(url: string, label: string): Promise<MangaSummary[]> {
  try {
    const html = await getHtml(url);
    const items = parseList(html);
    if (items.length === 0) {
      return label === 'search' ? [] : errRows('EMPTY ' + label + ' (0 series parsed from ' + Math.round(html.length / 1024) + 'KB page)');
    }
    return items;
  } catch (e) {
    return errRows('ERR ' + label + ': ' + errText(e));
  }
}

function chapterNumber(title: string): string | null {
  const m = /(?:v\d+\s)?(\d+)/.exec(title);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 2000 ? null : String(n);
}

function lastSegment(href: string): string {
  const parts = href.split('?')[0].split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function debugChapter(id: string, msg: string): MangaChapter {
  return { id: id + '::debug', chapter: null, title: msg.slice(0, 120), pages: 0, language: 'en' };
}

function cfPage(b: string): boolean {
  return b.includes('Just a moment') || b.includes('challenges.cloudflare.com') || b.includes('cf-turnstile');
}

// Times one request and describes the answer in a few characters; never throws
async function timed(label: string, url: string, ms: number): Promise<string> {
  const t0 = Date.now();
  try {
    const r: any = await withTimeout(
      harbor.http(url, { responseType: 'text', timeoutMs: ms, headers: { 'User-Agent': UA } } as any),
      ms + 1500,
      label,
    );
    const h: any = r?.headers || {};
    const ct = String(h['content-type'] || h['Content-Type'] || '?').slice(0, 16);
    const body = String(r?.body || '');
    return label + ': ' + r?.status + ' ' + ct + ' ' + Math.round(body.length / 1024) + 'KB ' + (Date.now() - t0) + 'ms cf:' + (cfPage(body) ? 'Y' : 'N');
  } catch (e) {
    return label + ': ' + errText(e).slice(0, 40) + ' ' + (Date.now() - t0) + 'ms';
  }
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : '?';
}

// Search for 'diag': times readallcomics.com against a control site, then tests the image hosts
async function diagnostics(): Promise<MangaSummary[]> {
  const lines: string[] = [];
  lines.push(await timed('rac', SITE + '/', 6000));
  lines.push(await timed('rac www', 'https://www.readallcomics.com/', 6000));
  lines.push(await timed('control asura', 'https://asurascans.com/', 6000));
  if (lines[0].indexOf(': 200 ') > 0) {
    try {
      const html = await getHtml(SITE + '/');
      const items = parseList(html);
      lines.push('series parsed: ' + items.length);
      const first = items[0];
      if (first) {
        lines.push('first: ' + first.title.slice(0, 40));
        if (first.cover) {
          lines.push('cover host: ' + hostOf(first.cover));
          lines.push(await timed('cover', first.cover, 6000));
        }
        const chs = await plugin.chapters(first.id);
        lines.push('chapters parsed: ' + chs.length);
        const ch = chs.find((c) => c.id.indexOf('::debug') < 0);
        if (ch) {
          const pages = await plugin.pageUrls(ch.id);
          lines.push('pages parsed: ' + pages.length);
          if (pages[0]) {
            lines.push('page host: ' + hostOf(pages[0]));
            lines.push(await timed('page', pages[0], 6000));
          }
        }
      }
    } catch (e) {
      lines.push('diag chain ERR ' + errText(e).slice(0, 80));
    }
  }
  const out: MangaSummary[] = [];
  for (const l of lines) {
    for (const row of toRows('diag-', l, 4)) {
      out.push({ id: 'diag-' + out.length, title: row.title } as MangaSummary);
    }
  }
  return out;
}

const plugin: MangaProvider = {
  id: 'readall-native2',
  name: 'ReadAllComics (native) 0.0.2',

  async popular(offset: number) {
    if (offset > 0) return [];
    return list(SITE + '/', 'popular');
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (q.toLowerCase() === 'diag') return diagnostics();
    if (!q) return list(SITE + '/', 'popular');
    return list(SITE + '/?story=' + encodeURIComponent(q) + '&s=&type=comic', 'search');
  },

  async detail(id: string) {
    if (isRow(id)) return { id, title: lastMsg.slice(0, 120) || id, description: lastMsg } as MangaSummary;
    try {
      const html = await getHtml(SITE + '/category/' + id);
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
      const block = html.indexOf('description-archive') >= 0 ? html.slice(html.indexOf('description-archive')) : '';
      const imgTag = /<img[^>]*>/i.exec(block);
      const text = block ? strip(block.slice(0, 4000)).slice(0, 600) : '';
      return {
        id,
        title: h1 ? strip(h1[1]) : id,
        cover: imgTag ? fixUrl(attr(imgTag[0], 'src')) : undefined,
        description: text || undefined,
      } as MangaSummary;
    } catch (e) {
      lastMsg = 'ERR detail: ' + errText(e);
      return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    }
  },

  async chapters(id: string) {
    if (isRow(id)) return [];
    try {
      const html = await getHtml(SITE + '/category/' + id);
      const at = html.indexOf('list-story');
      const part = at >= 0 ? html.slice(at) : html;
      const re = /<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const seen: Record<string, boolean> = {};
      const out: MangaChapter[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(part)) !== null) {
        const cid = lastSegment(m[1]);
        if (!cid || seen[cid]) continue;
        seen[cid] = true;
        const title = strip(m[2]);
        out.push({ id: cid, chapter: chapterNumber(title), title, pages: 0, language: 'en' });
      }
      if (out.length === 0) return [debugChapter(id, 'EMPTY chapters (0 links parsed)')];
      return out.reverse();
    } catch (e) {
      return [debugChapter(id, 'ERR chapters: ' + errText(e))];
    }
  },

  async pageUrls(chapterId: string) {
    if (chapterId.indexOf('::debug') >= 0) return [];
    const html = await getHtml(SITE + '/' + chapterId);
    const out: string[] = [];
    const tags = html.match(/<img[^>]*>/gi) || [];
    for (const tag of tags) {
      if (tag.indexOf('decoding="async"') < 0) continue;
      const src = attr(tag, 'src') || attr(tag, 'data-src');
      if (!src || src.indexOf('preloader.gif') >= 0) continue;
      const u = fixUrl(src);
      if (u) out.push(u);
    }
    if (out.length === 0) throw new Error('0 page images parsed from ' + Math.round(html.length / 1024) + 'KB page');
    return out;
  },
};

harbor.register(plugin);
