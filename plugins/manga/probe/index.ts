import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const API =
  'https://atsu.moe/api/home2/mostBookmarked?offset=0&limit=5&mediums=Comic&types=Manga,Manwha,Manhua,OEL&contentRatings=Safe,Suggestive,Erotica&timeframe=weekly';
const CDN = 'https://cdn.atsu.moe';

async function get(url: string, headers?: Record<string, string>): Promise<any> {
  const opts: any = { responseType: 'text', timeoutMs: 15000 };
  if (headers) opts.headers = headers;
  return harbor.http(url, opts);
}

function coverUrl(raw: any): string {
  const t = typeof raw === 'string' ? raw : raw?.posterMedium ?? raw?.posterSmall ?? raw?.poster;
  if (!t || typeof t !== 'string') return '';
  if (t.startsWith('http')) return t;
  return CDN + (t.startsWith('/') ? t : '/static/' + t);
}

function brief(r: any): string {
  const h = r?.headers ?? {};
  const ct = String(h['content-type'] ?? h['Content-Type'] ?? '?').slice(0, 20);
  return String(r?.status ?? '?') + ' ' + Math.round(String(r?.body ?? '').length / 1024) + 'KB ' + ct;
}

function errText(e: any): string {
  return String(e?.message ?? e).slice(0, 60);
}

async function lines(): Promise<string[]> {
  const out: string[] = [];
  let item: any = null;
  try {
    const r = await get(API);
    out.push('API: ' + brief(r));
    const j = JSON.parse(String(r?.body ?? '{}'));
    const items = Array.isArray(j?.items) ? j.items : [];
    out.push('items: ' + items.length);
    item = items[0] ?? null;
  } catch (e: any) {
    out.push('API ERR ' + errText(e));
  }
  if (!item) return out;

  out.push('keys: ' + Object.keys(item).join(','));
  const raw = item.mediumImage ?? item.smallImage ?? item.image;
  out.push('raw: ' + JSON.stringify(raw === undefined ? null : raw).slice(0, 80));
  const url = coverUrl(raw);
  out.push('url: ' + url);
  if (!url) return out;

  const tests: Array<[string, Record<string, string> | undefined]> = [
    ['default', undefined],
    ['referer', { Referer: 'https://atsu.moe/' }],
    ['ref+UA', { Referer: 'https://atsu.moe/', 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }],
  ];
  for (const [label, h] of tests) {
    try {
      const r = await get(url, h);
      out.push(label + ': ' + brief(r));
    } catch (e: any) {
      out.push(label + ' ERR ' + errText(e));
    }
  }
  return out;
}

function toRows(ls: string[]): MangaSummary[] {
  const out: MangaSummary[] = [];
  for (const l of ls) {
    for (let i = 0; i < l.length && out.length < 40; i += 34) {
      out.push({ id: 'r' + out.length, title: l.slice(i, i + 34) } as MangaSummary);
    }
  }
  return out;
}

async function rows(): Promise<MangaSummary[]> {
  return toRows(await lines());
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
