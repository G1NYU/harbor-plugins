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
  const out: string[] = ['PROBE5 v0.0.2 legion'];
  const home = await step('HOME /', BASE + '/', out);
  if (!home) return rows(out.concat('NO HOME PAGE, stop'));

  const links = internalLinks(home);
  out.push('internal links: ' + links.length);
  for (let i = 0; i < links.length && i < 4; i++) out.push('L' + (i + 1) + ' ' + pathOf(links[i]));

  const imgs = imageUrls(home);
  out.push('images: ' + imgs.length);
  for (let i = 0; i < imgs.length && i < 3; i++) {
    out.push('I' + (i + 1) + ' ' + host(imgs[i]));
    await step('IMG' + (i + 1), imgs[i], out);
  }

  const cands = links.filter((u) => {
    const p = pathOf(u);
    return p.split('/').filter(Boolean).length >= 2 && !/\/(page|category|tag|author|genre|genres)\//i.test(p);
  });
  if (cands.length === 0) return rows(out.concat('no series candidate'));
  out.push('series cand:');
  out.push(pathOf(cands[0]));

  const sp = await step('SERIES pg', cands[0], out);
  if (!sp) return rows(out);
  out.push('eph-num: ' + (sp.match(/eph-num/g) || []).length);
  out.push('data-num: ' + (sp.match(/data-num=/g) || []).length);
  let chUrl = '';
  const c1 = /class="eph-num">\s*<a[^>]+href="([^"]+)"/i.exec(sp);
  const c2 = /href="([^"]*(?:chapter|capitulo)[^"]*)"/i.exec(sp);
  if (c1) chUrl = toAbs(c1[1]);
  else if (c2) chUrl = toAbs(c2[1]);
  if (!chUrl) return rows(out.concat('no chapter link'));
  out.push('chapter:');
  out.push(pathOf(chUrl));

  const ch = await step('CHAPTER pg', chUrl, out);
  if (!ch) return rows(out);
  const flat = ch.replace(/\\\//g, '/');
  out.push('readerarea: ' + (flat.indexOf('readerarea') >= 0 ? 'yes' : 'NO'));
  let pageImg = '';
  const s1 = /"sources":\s*\[[\s\S]*?"images":\s*\[\s*"([^"]+)"/.exec(flat);
  const s2 = /id="readerarea"[\s\S]*?<img[^>]+?(?:data-src|src)="(https?:[^"]+)"/i.exec(flat);
  out.push('sources json: ' + (s1 ? 'yes' : 'NO'));
  if (s1) pageImg = s1[1];
  else if (s2) pageImg = s2[1];
  if (!pageImg) return rows(out.concat('no page image found'));
  out.push('page img host:');
  out.push(host(pageImg));
  await step('PAGE IMG', pageImg, out);
  out.push('DONE');
  return rows(out);
}

const plugin: MangaProvider = {
  id: 'probe5',
  name: 'Probe5 Legion v0.0.2 (diag)',

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
