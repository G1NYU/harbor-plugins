import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';
const BASE = 'https://batcave.biz';
const IMAGE = 'https://img.batcave.biz/img/4/3075/15983/51-0aca5a499d0e89c10257331c51ece7a0.jpg?s=a8hj2YvnZdaUJ9nWTCGW3w';
let report = '';
function rows(parts: string[]): MangaSummary[] {
  report = parts.join('\n');
  const out: MangaSummary[] = [];
  for (const part of parts) for (let i = 0; i < part.length; i += 34) out.push({ id: 'diag-' + out.length, title: part.slice(i, i + 34) });
  return out;
}
function contentType(headers: unknown): string {
  if (!headers || typeof headers !== 'object') return 'unknown';
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === 'content-type') return String(value);
  return 'unknown';
}
async function testImage(url: string): Promise<string[]> {
  const r = await harbor.http(url, { responseType: 'base64', timeoutMs: 8000, headers: { Accept: 'image/*,*/*' } });
  return ['IMAGE HTTP ' + r.status, 'TYPE ' + contentType(r.headers), 'BODY chars ' + String(r.body ?? '').length];
}
async function run(query: string): Promise<MangaSummary[]> {
  const q = query.trim().toLowerCase();
  try {
    if (q === 'image') return rows(['Browser page 51', ...await testImage(IMAGE)]);
    if (q === 'api') {
      const r = await harbor.http(BASE + '/engine/ajax/controller.php?mod=api&action=reader/getChapterData', { method: 'POST', responseType: 'text', timeoutMs: 8000, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ news_id: '3075', chapter_id: '15983' }) });
      const parts = ['API HTTP ' + r.status, 'TYPE ' + contentType(r.headers)];
      let data: any;
      try { data = JSON.parse(String(r.body ?? '')); } catch (_) { return rows([...parts, 'NOT JSON', String(r.body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 170)]); }
      const images: unknown[] = Array.isArray(data?.data?.images) ? data.data.images : [];
      parts.push('IMAGES ' + images.length);
      if (images.length && typeof images[0] === 'string') {
        const raw = images[0].trim();
        const url = raw.startsWith('//') ? 'https:' + raw : raw.startsWith('/') ? BASE + raw : raw;
        parts.push('FIRST ' + url);
        if (/^https?:\/\//i.test(url)) {
          try { parts.push(...await testImage(url)); } catch (e) { parts.push('IMAGE ERR ' + String(e)); }
        }
      }
      return rows(parts);
    }
    const r = await harbor.http(BASE + '/reader/3075/15983', { responseType: 'text', timeoutMs: 8000 });
    const body = String(r.body ?? '');
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body) || [])[1] || '(none)';
    return rows(['READER HTTP ' + r.status, 'TYPE ' + contentType(r.headers), 'HTML chars ' + body.length, 'TITLE ' + title, 'reader__item ' + /reader__item/.test(body), '__DATA__ ' + /__DATA__/.test(body), 'img host ' + /img\.batcave\.biz/.test(body)]);
  } catch (e) { return rows(['TEST ' + (q || 'chapter'), 'ERROR ' + String(e)]); }
}
const plugin: MangaProvider = {
  id: 'probe-batcave1', name: 'Probe BatCave v1',
  async popular(offset: number) { return offset > 0 ? [] : run('chapter'); },
  async search(query: string, offset: number) { return offset > 0 ? [] : run(query); },
  async detail(id: string) { return { id, title: 'BatCave diagnostic', description: report }; },
  async chapters(_id: string) { return []; },
  async pageUrls(_id: string) { return []; },
};
harbor.register(plugin);
