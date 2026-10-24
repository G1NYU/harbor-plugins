import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const SITES: Array<[string, string]> = [
  ['rco', 'https://readcomicsonline.ru/'],
  ['rac', 'https://readallcomics.com/'],
  ['zip', 'https://zipcomic.com/'],
];

interface Res {
  status: string;
  body: string;
  ct: string;
  err?: string;
}

async function call(url: string): Promise<Res> {
  try {
    const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 20000, headers: { 'User-Agent': UA } } as any);
    const h: any = r?.headers || {};
    return {
      status: String(r?.status ?? '?'),
      body: String(r?.body ?? ''),
      ct: String(h['content-type'] || h['Content-Type'] || '?').slice(0, 20),
    };
  } catch (e: any) {
    return { status: 'ERR', body: '', ct: '', err: String((e && e.message) || e).slice(0, 50) };
  }
}

function challenged(b: string): boolean {
  return b.includes('Just a moment') || b.includes('challenges.cloudflare.com') || b.includes('cf-turnstile');
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : '?';
}

async function lines(): Promise<string[]> {
  const out: string[] = ['cf:Y = Cloudflare check page'];
  for (const [tag, url] of SITES) {
    const home = await call(url);
    if (home.status === 'ERR') {
      out.push(tag + ' home: ERR ' + (home.err || ''));
      continue;
    }
    out.push(tag + ' home: ' + home.status + ' ' + Math.round(home.body.length / 1024) + 'KB cf:' + (challenged(home.body) ? 'Y' : 'N'));
    const m = /<img[^>]+?(?:data-src|src)="(https?:\/\/[^"]+?\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/i.exec(home.body);
    if (!m) {
      out.push(tag + ' no cover link found');
      continue;
    }
    const img = await call(m[1]);
    out.push(tag + ' img ' + hostOf(m[1]) + ': ' + img.status + ' ' + img.ct + ' ' + Math.round(img.body.length / 1024) + 'KB');
  }
  return out;
}

function toRows(ls: string[]): MangaSummary[] {
  const out: MangaSummary[] = [];
  for (const l of ls) {
    for (let i = 0; i < l.length && out.length < 60; i += 34) {
      out.push({ id: 'r' + out.length, title: l.slice(i, i + 34) } as MangaSummary);
    }
  }
  return out;
}

async function rows(): Promise<MangaSummary[]> {
  try {
    return toRows(await lines());
  } catch (e: any) {
    return toRows(['PROBE ERR: ' + String((e && e.message) || e)]);
  }
}

export const plugin: MangaProvider = {
  id: 'probe3',
  name: 'Probe3 western sites (diagnostic)',
  popular: () => rows(),
  search: () => rows(),
  async detail(id: string) {
    return { id, title: id } as any;
  },
  async chapters() {
    return [];
  },
  async pageUrls() {
    return [];
  },
};

harbor.register(plugin);
