/** BatCave reader diagnostics v2: dynamically discover a chapter's actual URLs. */
import type { MangaChapter, MangaProvider, MangaSummary } from '@shared/types/manga.js';
const BASE = 'https://batcave.biz';
const READER = '/reader/3075/15983';
const ENDPOINT = '/engine/ajax/controller.php?mod=api&action=reader/getChapterData';
function rows(lines: string[]): MangaSummary[] {
  const out: MangaSummary[] = [];
  for (const line of lines) for (let i = 0; i < line.length; i += 34)
    out.push({ id: 'diag-' + out.length, title: line.slice(i, i + 34) });
  return out;
}
function ctype(headers: any): string {
  const key = Object.keys(headers || {}).find(key => key.toLowerCase() === 'content-type');
  return key ? String(headers[key]) : '(unknown)';
}
async function getReader(): Promise<any> {
  return harbor.http(BASE + READER, { responseType: 'text', timeoutMs: 8000 });
}
async function api(): Promise<any> {
  return harbor.http(BASE + ENDPOINT, {
    method: 'POST', responseType: 'text', timeoutMs: 8000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ news_id: '3075', chapter_id: '15983' }),
  });
}
function images(body: string): string[] {
  let json: any;
  try { json = JSON.parse(body); } catch { return []; }
  const data = json?.data?.images;
  if (!Array.isArray(data)) return [];
  return data.map((item: any) => typeof item === 'string' ? item : item?.url ?? item?.src ?? '')
    .map((url: string) => url.startsWith('//') ? 'https:' + url : url.startsWith('/') ? BASE + url : url)
    .filter((url: string) => /^https:\/\/(?:img\.)?batcave\.biz\//i.test(url));
}
async function diagnostics(command: string): Promise<MangaSummary[]> {
  try {
    if (command === 'reader' || command === '') {
      const res = await getReader();
      const body = String(res.body ?? '');
      return rows(['READER HTTP ' + res.status, 'TYPE ' + ctype(res.headers), 'HTML CHARS ' + body.length,
        'CLOUDFLARE ' + /cloudflare|just a moment|sorry, you have been blocked/i.test(body),
        'READER MARKUP ' + /reader__item|__DATA__/i.test(body),
        'BODY ' + body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100)]);
    }
    const res = await api();
    const body = String(res.body ?? '');
    const urls = images(body);
    const out = ['API HTTP ' + res.status, 'TYPE ' + ctype(res.headers),
      'IMAGE URLS ' + urls.length, 'FIRST ' + (urls[0] || '(none)')];
    if (command === 'image' && urls.length) {
      try {
        const img = await harbor.http(urls[0], { responseType: 'base64', timeoutMs: 8000, headers: { Accept: 'image/*,*/*' } });
        out.push('IMAGE HTTP ' + img.status, 'IMAGE TYPE ' + ctype(img.headers),
          'BASE64 CHARS ' + String(img.body ?? '').length);
      } catch (e) { out.push('IMAGE ERR ' + String(e).slice(0, 120)); }
    }
    if (!urls.length) out.push('BODY ' + body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100));
    return rows(out);
  } catch (e) { return rows(['ERR ' + String(e).slice(0, 160)]); }
}
const plugin: MangaProvider = {
  id: 'probe-batcave2', name: 'Probe BatCave v2',
  async popular(offset: number) { return offset ? [] : [{ id: 'sample', title: 'TEST BatCave sample' }, ...(await diagnostics('reader'))]; },
  async search(query: string, offset: number) { return offset ? [] : diagnostics(query.trim().toLowerCase()); },
  async detail(id: string) { return { id, title: 'BatCave reader test', description: 'Search reader, api, or image for diagnostics.' }; },
  async chapters(id: string): Promise<MangaChapter[]> {
    return id === 'sample' ? [{ id: READER, chapter: null, title: 'Test sample reader', pages: 0, language: 'en' }] : [];
  },
  async pageUrls(id: string) {
    if (id !== READER) return [];
    const res = await api();
    if (Number(res.status) !== 200) throw new Error('BatCave API HTTP ' + res.status);
    const urls = images(String(res.body ?? ''));
    if (!urls.length) throw new Error('No BatCave page URLs in API');
    return urls;
  },
};
harbor.register(plugin);
