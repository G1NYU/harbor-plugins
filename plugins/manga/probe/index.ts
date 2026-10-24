import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://legionscans.com';
const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

let lastMsg = '';

function rows(msgs: string[]): MangaSummary[] {
  lastMsg = msgs.join(' | ');
  const out: MangaSummary[] = [];
  for (const m of msgs) {
    for (let i = 0; i < m.length && out.length < 40; i += 34) {
      out.push({ id: 'err-' + out.length, title: m.slice(i, i + 34) } as MangaSummary);
    }
  }
  return out;
}

function guard<T>(p: Promise<T>, ms: number): Promise<T> {
  if (typeof setTimeout !== 'function') return p;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('guard ' + ms)), ms)),
  ]);
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const r: any = await guard(
    harbor.http(url, { responseType: 'text', timeoutMs: 8000, headers: { 'User-Agent': UA, Accept: '*/*' } } as any),
    9000,
  );
  return { status: Number(r?.status ?? 0), body: String(r?.body ?? '') };
}

async function step(label: string, url: string, out: string[]): Promise<string> {
  try {
    const r = await get(url);
    out.push(label + ' ' + r.status + ' ' + Math.round(r.body.length / 1024) + 'KB');
    return r.status === 200 ? r.body : '';
  } catch (e: any) {
    out.push('ERR ' + label + ': ' + String((e && e.message) || e).slice(0, 60));
    return '';
  }
}

function host(u: string): string {
  const m = /^https?:\/\/([^\/]+)/i.exec(u);
  return m ? m[1] : '?';
}

function toAbs(u: string): string {
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return BASE + u;
  return u;
}

function pathOf(u: string): string {
  return u.replace(BASE, '') || '/';
}

function internalLinks(html: string): string[] {
  const re = /href="([^"#]+)"/gi;
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = toAbs(m[1].replace(/&amp;/g, '&'));
    if (u.indexOf(BASE) !== 0) continue;
    const p = pathOf(u);
    if (p === '/' || p === '') continue;
    if (/\.(css|js|png|jpe?g|webp|svg|ico|xml|json|gif)(\?|$)/i.test(p)) continue;
    if (/wp-(content|json|admin|includes)|\/feed|xmlrpc/i.test(p)) continue;
    if (seen[u]) continue;
    seen[u] = true;
    out.push(u);
  }
  return out;
}

function imageUrls(html: string): string[] {
  const re = /<img[^>]+?(?:data-src|src)="(https?:\/\/[^"]+)"/gi;
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[1]]) continue;
    seen[m[1]] = true;
    out.push(m[1]);
  }
  return out;
}

async function run(): Promise<MangaSummary[]> {
  const out: string[] = ['PROBE7 v0.0.4 legion'];
  const lst = await step('LIST /wp/manga/', BASE + '/wp/manga/', out);
  if (!lst) return rows(out.concat('NO LIST PAGE, stop'));

  const series = internalLinks(lst).filter((u) => /^\/wp\/manga\/[^\/?]+\/$/.test(pathOf(u)));
  out.push('series links: ' + series.length);
  for (let i = 0; i < series.length && i < 3; i++) out.push('S' + (i + 1) + ' ' + pathOf(series[i]));
  if (series.length === 0) return rows(out);

  const sp = await step('SERIES pg', series[0], out);
  if (!sp) return rows(out);
  out.push('eph-num: ' + (sp.match(/eph-num/g) || []).length);
  out.push('clstyle: ' + (sp.match(/clstyle/g) || []).length);
  out.push('data-num: ' + (sp.match(/data-num=/g) || []).length);

  const chs = internalLinks(sp).filter((u) => /^\/wp\/\d{4}\/\d{2}\/\d{2}\//.test(pathOf(u)));
  out.push('dated links: ' + chs.length);
  let chUrl = '';
  const c1 = /class="eph-num">\s*<a[^>]+href="([^"]+)"/i.exec(sp);
  if (chs.length) chUrl = chs[0];
  else if (c1) chUrl = toAbs(c1[1]);
  if (!chUrl) return rows(out.concat('no chapter link'));
  out.push('chapter:');
  out.push(pathOf(chUrl));

  const ch = await step('CHAPTER pg', chUrl, out);
  if (!ch) return rows(out);
  const flat = ch.replace(/\\\//g, '/');
  out.push('readerarea: ' + (flat.indexOf('readerarea') >= 0 ? 'yes' : 'NO'));
  out.push('ts_reader: ' + (flat.indexOf('ts_reader') >= 0 ? 'yes' : 'NO'));
  out.push('img tags: ' + (flat.match(/<img/g) || []).length);
  let pageImg = '';
  const s1 = /"sources":\s*\[[\s\S]*?"images":\s*\[\s*"([^"]+)"/.exec(flat);
  const s2 = /id="readerarea"[\s\S]*?<img[^>]+?(?:data-src|src)="(https?:[^"]+)"/i.exec(flat);
  const s3 = /"images":\s*\[\s*"([^"]+)"/.exec(flat);
  out.push('sources json: ' + (s1 ? 'yes' : 'NO'));
  if (s1) pageImg = s1[1];
  else if (s2) pageImg = s2[1];
  else if (s3) pageImg = s3[1];
  if (!pageImg) {
    const im = imageUrls(flat);
    out.push('no page image found');
    for (let i = 0; i < im.length && i < 3; i++) out.push('CI' + (i + 1) + ' ' + host(im[i]));
    return rows(out);
  }
  out.push('page img host:');
  out.push(host(pageImg));
  await step('PAGE IMG', pageImg, out);
  out.push('DONE');
  return rows(out);
}

const plugin: MangaProvider = {
  id: 'probe7',
  name: 'Probe7 Legion v0.0.4 (diag)',

  async popular(offset: number) {
    if (offset > 0) return [];
    try {
      return await run();
    } catch (e: any) {
      return rows(['FATAL ' + String((e && e.message) || e).slice(0, 100)]);
    }
  },

  async search(_q: string, offset: number) {
    if (offset > 0) return [];
    return run();
  },

  async detail(id: string) {
    return { id, title: lastMsg.slice(0, 120), description: lastMsg } as MangaSummary;
  },

  async chapters(_id: string) {
    return [];
  },

  async pageUrls(_id: string) {
    return [];
  },
};

harbor.register(plugin);
