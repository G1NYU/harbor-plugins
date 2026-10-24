/**
 * Legion Scans / Cerberus Series (Spanish) for Harbor.
 *
 * Written for Harbor from the site's own markup, with the Cerberus Series
 * provider for Seanime by branrgx as a reference (used with the author's
 * permission): https://github.com/branrgx/seanime-extensions
 *
 * Harbor changes: native MangaProvider, browse from /wp/manga/ (first page
 * only), series details from og: tags, chapters from the series page list,
 * pages from the reader's ts_reader image list, errors shown as short rows.
 */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://legionscans.com';
const WP = BASE + '/wp';
const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
  Accept: '*/*',
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
  const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 15000, headers: HEADERS } as any);
  const status = Number(r?.status ?? 0);
  if (status !== 200) throw new Error('HTTP ' + status + ' ' + url.replace(BASE, ''));
  return String(r?.body ?? '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function absUrl(u: any): string | undefined {
  if (typeof u !== 'string' || !u) return undefined;
  if (u.indexOf('data:') === 0) return undefined;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return BASE + u;
  return /^https?:\/\//i.test(u) ? u : undefined;
}

function pathOf(u: string): string {
  return u.replace(BASE, '');
}

function humanize(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// First usable image of an HTML fragment (lazy-load attributes first, skip placeholders).
function firstImage(fragment: string): string | undefined {
  const tags = fragment.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'src']) {
      const m = new RegExp('\\s' + attr + '="([^"]+)"', 'i').exec(tag);
      if (!m) continue;
      const u = absUrl(decodeEntities(m[1]));
      if (u && u.indexOf('shortpixel.ai') < 0) return u;
    }
  }
  return undefined;
}

function parseList(html: string): MangaSummary[] {
  const re = /<a\b([^>]*?)href="((?:https?:\/\/legionscans\.com)?\/wp\/manga\/([^\/"?#]+)\/)"([^>]*)>([\s\S]*?)<\/a>/gi;
  const order: string[] = [];
  const map: Record<string, { path: string; title: string; cover?: string }> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = m[3];
    const attrs = m[1] + ' ' + m[4];
    const inner = m[5];
    if (!map[slug]) {
      map[slug] = { path: pathOf(m[2].indexOf('http') === 0 ? m[2] : BASE + m[2]), title: '' };
      order.push(slug);
    }
    const e = map[slug];
    if (!e.title) {
      const t1 = /\btitle="([^"]+)"/i.exec(attrs);
      const t2 = /class="tt"[^>]*>\s*([^<]+)/i.exec(inner);
      const t3 = /\balt="([^"]+)"/i.exec(inner);
      const t = (t1 && t1[1]) || (t2 && t2[1]) || (t3 && t3[1]) || '';
      e.title = decodeEntities(t).trim();
    }
    if (!e.cover) e.cover = firstImage(inner);
  }
  return order.map((slug) => {
    const e = map[slug];
    return { id: e.path, title: e.title || humanize(slug), cover: e.cover } as MangaSummary;
  });
}

async function list(url: string, label: string): Promise<MangaSummary[]> {
  try {
    const html = await getHtml(url);
    const series = parseList(html);
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
  return { id: id + '::debug', chapter: null, title: msg.slice(0, 120), pages: 0, language: 'es' };
}

const plugin: MangaProvider = {
  id: 'legion-scans',
  name: 'Legion Scans',

  async popular(offset: number) {
    if (offset > 0) return [];
    return list(WP + '/manga/', 'popular');
  },

  async search(query: string, offset: number) {
    if (offset > 0) return [];
    const q = String(query || '').trim();
    if (!q) return list(WP + '/manga/', 'popular');
    return list(WP + '/?s=' + encodeURIComponent(q), 'search');
  },

  async detail(id: string) {
    if (id.indexOf('err-') === 0) return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
    try {
      const html = await getHtml(BASE + id);
      const slug = id.split('/').filter(Boolean).pop() || id;
      const title = meta(html, 'og:title').replace(/\s*[-\u2013|]\s*Cerberus Series\s*$/i, '');
      return {
        id,
        title: title || humanize(slug),
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
      const html = await getHtml(BASE + id);
      const seen: Record<string, boolean> = {};
      const out: MangaChapter[] = [];
      const liRe = /<li\b[^>]*data-num="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
      let m: RegExpExecArray | null;
      while ((m = liRe.exec(html)) !== null) {
        const num = decodeEntities(m[1]).trim();
        const href = /href="([^"]+)"/i.exec(m[2]);
        if (!href) continue;
        const cid = pathOf(href[1].indexOf('http') === 0 ? href[1] : BASE + href[1]);
        if (seen[cid]) continue;
        seen[cid] = true;
        const label = /class="chapternum"[^>]*>\s*([^<]+)/i.exec(m[2]);
        out.push({
          id: cid,
          chapter: num,
          title: label ? decodeEntities(label[1]).trim() : 'Cap\u00edtulo ' + num,
          pages: 0,
          language: 'es',
        });
      }
      if (out.length === 0) {
        const dRe = /href="((?:https?:\/\/legionscans\.com)?\/wp\/\d{4}\/\d{2}\/\d{2}\/([^"\/]+)\/)"/gi;
        while ((m = dRe.exec(html)) !== null) {
          const cid = pathOf(m[1].indexOf('http') === 0 ? m[1] : BASE + m[1]);
          if (seen[cid]) continue;
          seen[cid] = true;
          const n = /^(\d+(?:\.\d+)?)/.exec(m[2]);
          const num = n ? n[1] : String(out.length + 1);
          out.push({ id: cid, chapter: num, title: 'Cap\u00edtulo ' + num, pages: 0, language: 'es' });
        }
      }
      if (out.length === 0) return [debugChapter(id, 'EMPTY chapters (0 rows found)')];
      out.sort((a, b) => parseFloat(String(a.chapter)) - parseFloat(String(b.chapter)));
      return out;
    } catch (e) {
      return [debugChapter(id, 'ERR chapters: ' + errText(e))];
    }
  },

  async pageUrls(chapterId: string) {
    if (chapterId.indexOf('::debug') >= 0) return [];
    const url = /^https?:\/\//i.test(chapterId) ? chapterId : BASE + chapterId;
    const html = await getHtml(url);
    const flat = html.replace(/\\\//g, '/');
    const out: string[] = [];
    const arr = /"images":\s*\[([^\]]*)\]/.exec(flat);
    if (arr) {
      const re = /"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(arr[1])) !== null) {
        let u = m[1];
        try {
          u = JSON.parse('"' + u + '"');
        } catch (_) {}
        const a = absUrl(u);
        if (a) out.push(a);
      }
    }
    if (out.length === 0) {
      const area = /id="readerarea"([\s\S]*?)<\/div>/i.exec(flat);
      const tags = ((area && area[1]) || '').match(/<img\b[^>]*>/gi) || [];
      for (const tag of tags) {
        const s = /\s(?:data-src|src)="(https?:[^"]+)"/i.exec(tag);
        if (s) out.push(s[1]);
      }
    }
    if (out.length === 0) throw new Error('0 page images found');
    return out;
  },
};

harbor.register(plugin);
