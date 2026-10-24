import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const API =
  'https://atsu.moe/api/home2/mostBookmarked?offset=0&limit=5&mediums=Comic&types=Manga,Manwha,Manhua,OEL&contentRatings=Safe,Suggestive,Erotica&timeframe=weekly';
const CDN = 'https://cdn.atsu.moe';
const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/320px-Fronalpstock_big.jpg';

async function get(url: string): Promise<any> {
  return harbor.http(url, { responseType: 'text', timeoutMs: 15000 } as any);
}

function atsuCover(raw: any): string {
  const t = typeof raw === 'string' ? raw : raw?.posterMedium ?? raw?.posterSmall ?? raw?.poster;
  if (!t || typeof t !== 'string') return '';
  if (t.startsWith('http')) return t;
  return CDN + (t.startsWith('/') ? t : '/static/' + t);
}

function px(u: string): string {
  return 'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=300&output=jpg';
}

function findUploadUrl(body: string): string {
  const i = body.indexOf('/wp-content/uploads/');
  if (i < 0) return '';
  const start = body.lastIndexOf('http', i);
  if (start < 0) return '';
  const ends = ['"', "'", ' ', ')'].map((ch) => body.indexOf(ch, i)).filter((x) => x > 0);
  if (ends.length === 0) return '';
  const url = body.slice(start, Math.min(...ends));
  const lower = url.toLowerCase();
  const ok = lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp');
  return ok ? url : '';
}

async function touch(urls: Array<string | undefined>): Promise<void> {
  const jobs: Array<Promise<any>> = [];
  for (const u of urls) {
    if (!u) continue;
    jobs.push(get(u).catch(() => null));
  }
  await Promise.all(jobs);
}

async function rows(): Promise<MangaSummary[]> {
  const out: MangaSummary[] = [];
  out.push({ id: 'a', title: 'A wikimedia direct +T', cover: WIKI } as MangaSummary);
  out.push({ id: 'b', title: 'B wikimedia via proxy +T', cover: px(WIKI) } as MangaSummary);

  let atsu = '';
  try {
    const r = await get(API);
    const j = JSON.parse(String(r?.body ?? '{}'));
    const it = Array.isArray(j?.items) ? j.items[0] : null;
    atsu = atsuCover(it?.image);
  } catch (_) {}
  if (atsu) {
    out.push({ id: 'c', title: 'C atsumaru direct +T', cover: atsu } as MangaSummary);
    out.push({ id: 'd', title: 'D atsumaru via proxy +T', cover: px(atsu) } as MangaSummary);
  } else {
    out.push({ id: 'c', title: 'C atsumaru API failed' } as MangaSummary);
  }

  let thunder = '';
  try {
    const r = await get('https://en-thunderscans.com/');
    thunder = findUploadUrl(String(r?.body ?? ''));
  } catch (_) {}
  out.push({
    id: 'e',
    title: thunder ? 'E thunderscans direct +T' : 'E thunderscans none found',
    cover: thunder || undefined,
  } as MangaSummary);

  await touch(out.map((o) => o.cover));
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
