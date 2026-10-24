import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const API =
  'https://atsu.moe/api/home2/mostBookmarked?offset=0&limit=5&mediums=Comic&types=Manga,Manwha,Manhua,OEL&contentRatings=Safe,Suggestive,Erotica&timeframe=weekly';
const CDN = 'https://cdn.atsu.moe';
const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/320px-Fronalpstock_big.jpg';

const VARIANTS: Array<[string, Record<string, string>]> = [
  ['default', {}],
  ['ref http', { Referer: 'http://tauri.localhost/' }],
  ['ref https', { Referer: 'https://tauri.localhost/' }],
  ['ref+origin', { Referer: 'http://tauri.localhost/', Origin: 'http://tauri.localhost' }],
  ['empty UA', { 'User-Agent': '' }],
  ['reqwest UA', { 'User-Agent': 'reqwest/0.12.5' }],
  ['accept img', { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }],
  ['accept all', { Accept: '*/*' }],
  ['empty ref', { Referer: '' }],
  ['site ref', { Referer: 'https://atsu.moe/' }],
];

async function getJson(url: string): Promise<any> {
  const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 15000 } as any);
  return JSON.parse(String(r?.body ?? '{}'));
}

async function code(url: string, headers: Record<string, string>): Promise<string> {
  try {
    const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 15000, headers } as any);
    return String(r?.status ?? '?');
  } catch (_) {
    return 'ERR';
  }
}

function atsuCover(raw: any): string {
  const t = typeof raw === 'string' ? raw : raw?.posterMedium ?? raw?.posterSmall ?? raw?.poster;
  if (!t || typeof t !== 'string') return '';
  if (t.startsWith('http')) return t;
  return CDN + (t.startsWith('/') ? t : '/static/' + t);
}

async function lines(): Promise<string[]> {
  const out: string[] = ['A=atsumaru cover W=wikimedia image'];
  let atsu = '';
  try {
    const j = await getJson(API);
    const it = Array.isArray(j?.items) ? j.items[0] : null;
    atsu = atsuCover(it?.image);
  } catch (_) {}
  if (!atsu) {
    out.push('Atsumaru API failed');
    return out;
  }
  for (const [label, headers] of VARIANTS) {
    const [a, w] = await Promise.all([code(atsu, headers), code(WIKI, headers)]);
    out.push(label + ': A' + a + ' W' + w);
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
