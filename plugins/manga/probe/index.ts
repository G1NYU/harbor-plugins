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

async function run(): Promise<MangaSummary[]> {
  const out: string[] = ['PROBE4 v0.0.1 legion'];
  const home = await step('HOME /', BASE + '/', out);
  const wp = await step('HOME /wp/', BASE + '/wp/', out);
  const html = home || wp;
  if (!html) return rows(out.concat('NO HOME PAGE, stop'));

  const sm = /href="(https?:\/\/legionscans\.com[^"]*\/series\/[^"#]+)"/i.exec(html);
  out.push('series link: ' + (sm ? 'yes' : 'NO'));
  const cm = /<img[^>]+src="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i.exec(html);
  if (cm) {
    out.push('cover host:');
    out.push(host(cm[1]));
    await step('COVER', cm[1], out);
  } else {
    out.push('cover: none found');
  }
  if (!sm) return rows(out);

  const sp = await step('SERIES pg', sm[1], out);
  if (!sp) return rows(out);
  const n = (sp.match(/eph-num/g) || []).length;
  out.push('chapter links: ' + n);
  const chm = /class="eph-num">\s*<a[^>]+href="([^"]+)"/i.exec(sp);
  if (!chm) return rows(out);

  const ch = await step('CHAPTER pg', chm[1], out);
  if (!ch) return rows(out);
  const im = /"sources":\s*\[[\s\S]*?"images":\s*\[\s*"([^"]+)"/.exec(ch.replace(/\\\//g, '/'));
  if (!im) return rows(out.concat('sources JSON: NOT FOUND'));
  out.push('page img host:');
  out.push(host(im[1]));
  await step('PAGE IMG', im[1], out);
  out.push('DONE');
  return rows(out);
}

const plugin: MangaProvider = {
  id: 'probe4',
  name: 'Probe4 Legion v0.0.1 (diag)',

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
