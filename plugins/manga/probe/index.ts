import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const TARGETS: Array<[string, string]> = [
  ['mangakatana', 'https://mangakatana.com/'],
  ['thunderscans', 'https://en-thunderscans.com/'],
  ['atsumaru', 'https://atsu.moe/'],
  ['vortexscans', 'https://vortexscans.org/'],
  ['hijala', 'https://en-hijala.com/'],
  ['weebcentral', 'https://weebcentral.com/'],
  ['mangapill', 'https://mangapill.com/'],
];

async function hit(url: string, withHeaders: boolean): Promise<string> {
  const t0 = Date.now();
  try {
    const opts: any = { responseType: 'text', timeoutMs: 15000 };
    if (withHeaders) {
      opts.headers = {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      };
    }
    const r: any = await harbor.http(url, opts);
    const body = String(r?.body ?? '');
    const cf = body.includes('Just a moment...') || body.includes('cf-turnstile') || body.includes('challenge-platform');
    return String(r?.status ?? '?') + (cf ? ' CF' : '') + ' ' + Math.round(body.length / 1024) + 'KB ' + (Date.now() - t0) + 'ms';
  } catch (e: any) {
    return 'ERR ' + String(e?.message ?? e).slice(0, 40);
  }
}

async function echo(): Promise<string> {
  try {
    const r: any = await harbor.http('https://httpbin.org/headers', { responseType: 'text', timeoutMs: 15000 });
    const j = JSON.parse(String(r?.body ?? '{}'));
    const h = j.headers ?? {};
    return 'UA=' + String(h['User-Agent'] ?? 'none').slice(0, 70) + ' | headers=' + Object.keys(h).join(',');
  } catch (e: any) {
    return 'ERR ' + String(e?.message ?? e).slice(0, 40);
  }
}

async function rows(): Promise<MangaSummary[]> {
  const out: MangaSummary[] = await Promise.all(
    TARGETS.map(async ([name, url]) => {
      const [plain, browser] = await Promise.all([hit(url, false), hit(url, true)]);
      return { id: name, title: name + ' | default: ' + plain + ' | browser headers: ' + browser } as MangaSummary;
    })
  );
  const e = await echo();
  out.push({ id: 'echo', title: 'Harbor sends: ' + e } as MangaSummary);
  return out;
}

export const plugin: MangaProvider = {
  id: 'probe',
  name: 'Probe (diagnostic)',
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
