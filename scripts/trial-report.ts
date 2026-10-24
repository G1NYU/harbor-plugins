import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist', 'manga');
const STEP_TIMEOUT_MS = 20000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

interface Trace {
  url: string;
  status: number;
  cf: boolean;
  error?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function short(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname.slice(0, 40);
  } catch (_) {
    return url.slice(0, 60);
  }
}

function makeHarbor(traces: Trace[]) {
  const h: any = {
    async http(url: string, opts: any = {}) {
      const headers: Record<string, string> = {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        ...(opts.headers ?? {}),
      };
      try {
        const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          resHeaders[k.toLowerCase()] = v;
        });
        const mitigated = resHeaders['cf-mitigated'] === 'challenge';
        if (opts.responseType === 'json') {
          traces.push({ url, status: res.status, cf: mitigated });
          return await res.json().catch(() => null);
        }
        const body = await res.text().catch(() => '');
        const isChallenge =
          mitigated ||
          ((res.status === 403 || res.status === 503) &&
            (body.includes('Just a moment...') ||
              body.includes('challenge-platform') ||
              body.includes('Attention Required! | Cloudflare') ||
              body.includes('cf-turnstile')));
        traces.push({ url, status: res.status, cf: isChallenge });
        return { status: res.status, ok: res.ok && !isChallenge, headers: resHeaders, body };
      } catch (e: any) {
        traces.push({ url, status: 0, cf: false, error: String(e?.cause?.code ?? e?.message ?? e).slice(0, 60) });
        return { status: 0, ok: false, headers: {}, body: '' };
      }
    },
    parseHtml: async () => ({ querySelector: () => null, querySelectorAll: () => [] }),
    register: (_p: any) => {},
    log: () => {},
    getPreference: (_k: string, d: any) => d,
  };
  return h;
}

function firstWords(title: string): string {
  const words = String(title)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 2);
  return words.slice(0, 2).join(' ') || 'Solo';
}

interface Outcome {
  steps: Record<string, string>;
  notes: string[];
}

async function runPlugin(code: string): Promise<Outcome> {
  const traces: Trace[] = [];
  const harbor = makeHarbor(traces);
  let plugin: any = null;
  harbor.register = (p: any) => {
    plugin = p;
  };
  const steps: Record<string, string> = {};
  const notes: string[] = [];

  const finish = (): Outcome => {
    const bad = traces.filter((t) => t.status === 0 || t.status >= 400 || t.cf);
    const seen = new Set<string>();
    for (const t of bad) {
      const key = short(t.url) + t.status;
      if (seen.has(key) || seen.size >= 4) continue;
      seen.add(key);
      notes.push((t.cf ? 'CF challenge ' : '') + (t.status || t.error || 'fail') + ' ' + short(t.url));
    }
    return { steps, notes };
  };

  try {
    new Function('harbor', code)(harbor);
  } catch (e: any) {
    steps.load = 'error: ' + String(e?.message ?? e).slice(0, 80);
    return finish();
  }
  if (!plugin) {
    steps.load = 'no plugin registered';
    return finish();
  }
  steps.load = 'ok';

  const attempt = async (name: string, fn: () => Promise<any>): Promise<any> => {
    try {
      const v = await withTimeout(fn(), STEP_TIMEOUT_MS);
      if (Array.isArray(v)) steps[name] = v.length > 0 ? 'ok (' + v.length + ')' : 'empty';
      else steps[name] = v ? 'ok' : 'empty';
      return v;
    } catch (e: any) {
      steps[name] = 'error: ' + String(e?.message ?? e).slice(0, 80);
      return undefined;
    }
  };

  let sampleId: string | null = null;
  let sampleTitle: string | null = null;

  const pop = await attempt('popular', () => plugin.popular(0));
  if (Array.isArray(pop) && pop.length > 0) {
    sampleId = pop[0].id;
    sampleTitle = pop[0].title;
  }

  const found = await attempt('search', () => plugin.search(sampleTitle ? firstWords(sampleTitle) : 'Solo', 0));
  if (!sampleId && Array.isArray(found) && found.length > 0) sampleId = found[0].id;

  if (sampleId) {
    const seriesId: string = sampleId;
    await attempt('detail', () => plugin.detail(seriesId));
    const ch = await attempt('chapters', () => plugin.chapters(seriesId));
    if (Array.isArray(ch) && ch.length > 0) {
      const chapterId: string = ch[0].id;
      await attempt('pages', () => plugin.pageUrls(chapterId));
    }
  }
  return finish();
}

function readTestingIds(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'prune-repo.ts'), 'utf-8');
  const start = src.indexOf('const TESTING');
  const end = src.indexOf(']);', start);
  if (start < 0 || end < 0) return [];
  return src
    .slice(start, end)
    .split("'")
    .filter((_, i) => i % 2 === 1);
}

async function main() {
  const testingPath = path.join(DIST, 'repo-testing.json');
  const reportPath = path.join(DIST, 'sync-report.json');
  let plugins: any[] = [];
  if (fs.existsSync(testingPath)) {
    plugins = JSON.parse(fs.readFileSync(testingPath, 'utf-8')).plugins ?? [];
  }
  let upstreams: any[] = [];
  if (fs.existsSync(reportPath)) {
    try {
      upstreams = JSON.parse(fs.readFileSync(reportPath, 'utf-8')).upstreams ?? [];
    } catch (_) {}
  }

  const wanted = readTestingIds();
  const present = new Set(plugins.map((p) => String(p.id).toLowerCase()));
  const missing = wanted.filter((id) => !present.has(id));

  const rows: string[] = [];
  for (const p of plugins) {
    const file = path.join(DIST, p.entry);
    if (!fs.existsSync(file)) {
      rows.push('| ' + p.id + ' | bundle file missing | | | | | | |');
      continue;
    }
    console.log('Testing ' + p.id + '...');
    const r = await runPlugin(fs.readFileSync(file, 'utf-8'));
    const cell = (k: string) => (r.steps[k] ?? '-').replace(/\|/g, '/');
    rows.push(
      '| ' +
        p.id +
        ' v' +
        (p.version ?? '?') +
        ' | ' +
        ['load', 'popular', 'search', 'detail', 'chapters', 'pages'].map(cell).join(' | ') +
        ' | ' +
        r.notes.join('; ').replace(/\|/g, '/') +
        ' |'
    );
  }

  const upRows = upstreams.map(
    (u: any) => '| ' + u.name + ' | ' + (u.ok ? 'ok, ' + u.count + ' sources' : 'FAILED: ' + (u.error ?? '')) + ' |'
  );

  const md = [
    '# Trial source report',
    '',
    'Run from GitHub Actions (not from your PC), using a stand-in for Harbor. Errors here show what the plugin sees from GitHub\'s servers.',
    '',
    '## Upstreams',
    '',
    '| Upstream | Result |',
    '| --- | --- |',
    ...(upRows.length ? upRows : ['| (no data) | |']),
    '',
    '## Allowlisted but not found in any upstream',
    '',
    missing.length ? missing.map((m) => '- ' + m).join('\n') : 'none',
    '',
    '## Results',
    '',
    '| Source | load | popular | search | detail | chapters | pages | notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(ROOT, 'trial-report.md'), md, 'utf-8');
  console.log(md);
}

main().catch((err) => {
  console.error('Trial report failed:', err);
  fs.writeFileSync(path.join(ROOT, 'trial-report.md'), '# Trial source report\n\nThe report script crashed: ' + String(err) + '\n', 'utf-8');
  process.exit(0);
});
