import type { MangaProvider, MangaSummary } from '@shared/types/manga.js';

const BASE = 'https://batcave.biz';
const ECHO = 'https://httpbin.org/headers';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

interface Res {
  status: string;
  body: string;
  err?: string;
}

async function call(url: string, opts: Record<string, any>): Promise<Res> {
  try {
    const r: any = await harbor.http(url, { responseType: 'text', timeoutMs: 20000, ...opts } as any);
    return { status: String(r?.status ?? '?'), body: String(r?.body ?? '') };
  } catch (e: any) {
    return { status: 'ERR', body: '', err: String((e && e.message) || e).slice(0, 60) };
  }
}

function hasPow(b: string): boolean {
  return (
    /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']/.test(b) || (b.includes('pow_nonce') && b.includes('pow_hash'))
  );
}

function show(label: string, r: Res, extra: string): string {
  if (r.status === 'ERR') return label + ': ERR ' + (r.err || '');
  const kb = Math.round(r.body.length / 1024);
  return label + ': ' + r.status + ' ' + kb + 'KB pow:' + (hasPow(r.body) ? 'Y' : 'N') + (extra ? ' ' + extra : '');
}

function listFlag(b: string): string {
  return 'list:' + (b.includes('poster__title') || b.includes('readed') ? 'Y' : 'N');
}

function sent(r: Res, needle: string): string {
  if (r.status === 'ERR') return 'ERR ' + (r.err || '');
  return r.status + ' sent:' + (r.body.includes(needle) ? 'Y' : 'N');
}

async function lines(): Promise<string[]> {
  const out: string[] = ['pow:Y = bot check page'];

  const home = await call(BASE + '/', {});
  out.push(show('home default', home, listFlag(home.body)));
  const homeUa = await call(BASE + '/', { headers: { 'User-Agent': BROWSER_UA } });
  out.push(show('home browser UA', homeUa, listFlag(homeUa.body)));

  const good = !hasPow(homeUa.body) && homeUa.body ? homeUa.body : !hasPow(home.body) ? home.body : '';
  const powBody = hasPow(home.body) ? home.body : hasPow(homeUa.body) ? homeUa.body : '';
  if (powBody) {
    const i = Math.max(powBody.indexOf('pow_nonce'), powBody.indexOf('/_v'));
    const from = Math.max(0, i - 100);
    out.push('POW> ' + powBody.slice(from, from + 330).replace(/\s+/g, ' '));
  }

  const link = /href="((?:https:\/\/batcave\.biz)?\/(\d+)-[^"]+\.html)"/.exec(good);
  if (!link) {
    out.push('no series link found');
  } else {
    const url = link[1].startsWith('http') ? link[1] : BASE + link[1];
    const page = await call(url, { headers: { 'User-Agent': BROWSER_UA } });
    out.push(show('series', page, 'data:' + (page.body.includes('__DATA__') ? 'Y' : 'N')));
    const m = /window\.__DATA__\s*=\s*({[\s\S]*?});/.exec(page.body);
    let chapId = '';
    try {
      if (m) chapId = String(JSON.parse(m[1]).chapters[0].id);
    } catch (_) {}
    if (chapId) {
      const ajax = await call(BASE + '/engine/ajax/controller.php?mod=api&action=reader/getChapterData', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
        body: 'news_id=' + link[2] + '&chapter_id=' + chapId,
      });
      let imgs = '?';
      try {
        const j = JSON.parse(ajax.body);
        imgs = String((j?.data?.images || []).length);
      } catch (_) {}
      out.push(show('chapter data', ajax, 'images:' + imgs));
    } else {
      out.push('no chapter id found');
    }
  }

  const ck0 = await call(ECHO, { headers: { Cookie: 'probe=1' } });
  out.push('cookie plain: ' + sent(ck0, 'probe=1'));
  const ck1 = await call(ECHO, { headers: { Cookie: 'probe=1' }, allowCookie: 'probe=1' });
  out.push('cookie allow=value: ' + sent(ck1, 'probe=1'));
  const ck2 = await call(ECHO, { headers: { Cookie: 'probe=1' }, allowCookie: 'httpbin.org' });
  out.push('cookie allow=host: ' + sent(ck2, 'probe=1'));
  const rf0 = await call(ECHO, { headers: { Referer: 'https://example.org/probe' } });
  out.push('referer plain: ' + sent(rf0, 'example.org/probe'));
  const rf1 = await call(ECHO, { headers: { Referer: 'https://example.org/probe' }, allowReferer: 'https://example.org/probe' });
  out.push('referer allow=value: ' + sent(rf1, 'example.org/probe'));
  const rf2 = await call(ECHO, { headers: { Referer: 'https://example.org/probe' }, allowReferer: 'httpbin.org' });
  out.push('referer allow=host: ' + sent(rf2, 'example.org/probe'));
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
  id: 'probe',
  name: 'Probe 0.0.7 (diagnostic)',
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
