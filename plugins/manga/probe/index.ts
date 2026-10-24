import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const API =
  'https://atsu.moe/api/home2/mostBookmarked?offset=0&limit=5&mediums=Comic&types=Manga,Manwha,Manhua,OEL&contentRatings=Safe,Suggestive,Erotica&timeframe=weekly';
const CDN = 'https://cdn.atsu.moe';

const FIELDS: Array<[string, string]> = [
  ['img', 'image'],
  ['sm', 'smallImage'],
  ['med', 'mediumImage'],
  ['lg', 'largeImage'],
];

async function get(url: string): Promise<any> {
  return harbor.http(url, { responseType: 'text', timeoutMs: 15000 } as any);
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
  let items: any[] = [];
  try {
    const r = await get(API);
    out.push('API: ' + brief(r));
    const j = JSON.parse(String(r?.body ?? '{}'));
    items = Array.isArray(j?.items) ? j.items : [];
    out.push('items: ' + items.length);
  } catch (e: any) {
    out.push('API ERR ' + errText(e));
  }

  for (let n = 0; n < Math.min(items.length, 2); n++) {
    const item = items[n];
    out.push('--- series ' + (n + 1));
    for (const [label, field] of FIELDS) {
      const url = coverUrl(item[field]);
      if (!url) {
        out.push(label + ': none');
        continue;
      }
      const ext = url.split('?')[0].split('.').pop() ?? '?';
      try {
        const r = await get(url);
        out.push(label + ' .' + ext + ' ' + brief(r));
      } catch (e: any) {
        out.push(label + ' .' + ext + ' ERR ' + errText(e));
      }
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
