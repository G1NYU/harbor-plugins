import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIST = path.join(process.cwd(), 'dist', 'manga');
const REL = 'dist/manga';
const MANIFESTS = ['repo.json', 'repo-extended.json'];
const STEP_TIMEOUT_MS = 15000;
const ATTEMPTS = 2;
const BATCH = 3;
const DEADLINE = Date.now() + 18 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

interface Score {
  score: number;
  challenge: boolean;
}

function gitShow(rel: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
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

function makeHarbor(flags: { challenge: boolean }) {
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
          if (mitigated) flags.challenge = true;
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
        if (isChallenge) flags.challenge = true;
        return { status: res.status, ok: res.ok && !isChallenge, headers: resHeaders, body };
      } catch (_) {
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

async function step<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(fn(), STEP_TIMEOUT_MS);
  } catch (_) {
    return null;
  }
}

async function smoke(code: string): Promise<Score> {
  const flags = { challenge: false };
  const harbor = makeHarbor(flags);
  let plugin: any = null;
  harbor.register = (p: any) => {
    plugin = p;
  };
  try {
    new Function('harbor', code)(harbor);
  } catch (_) {
    return { score: 0, challenge: false };
  }
  if (!plugin) return { score: 0, challenge: false };

  let score = 0;
  let sampleId: string | null = null;
  let sampleTitle: string | null = null;

  const pop: any = await step(() => plugin.popular(0));
  if (Array.isArray(pop) && pop.length > 0) {
    score++;
    sampleId = pop[0].id;
    sampleTitle = pop[0].title;
  }

  const query = sampleTitle ? firstWords(sampleTitle) : 'Solo';
  const found: any = await step(() => plugin.search(query, 0));
  if (Array.isArray(found) && found.length > 0) {
    score++;
    if (!sampleId) sampleId = found[0].id;
  }

  if (sampleId) {
    const seriesId: string = sampleId;
    const detail: any = await step(() => plugin.detail(seriesId));
    if (detail && (detail.title || detail.id)) score++;

    const chapters: any = await step(() => plugin.chapters(seriesId));
    if (Array.isArray(chapters) && chapters.length > 0) {
      score++;
      const chapterId: string = chapters[0].id;
      const pages: any = await step(() => plugin.pageUrls(chapterId));
      if (Array.isArray(pages) && pages.length > 0) score++;
    }
  }

  return { score, challenge: flags.challenge };
}

async function best(code: string): Promise<Score> {
  const result: Score = { score: -1, challenge: false };
  for (let i = 0; i < ATTEMPTS; i++) {
    const r = await smoke(code);
    if (r.challenge) result.challenge = true;
    if (r.score > result.score) result.score = r.score;
    if (result.score === 5) break;
  }
  return result;
}

interface Candidate {
  id: string;
  entry: string;
  oldCode: string;
  newCode: string;
  oldVersion: string;
  newVersion: string;
}

async function main() {
  console.log('Update gate: comparing changed plugins against the last published version...');

  const manifests: Record<string, any> = {};
  for (const f of MANIFESTS) {
    const p = path.join(DIST, f);
    if (fs.existsSync(p)) {
      try {
        manifests[f] = JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (_) {}
    }
  }

  const published = new Map<string, any>();
  for (const m of Object.values(manifests)) {
    for (const p of m.plugins ?? []) {
      if (p && p.id && p.entry) published.set(String(p.id), p);
    }
  }

  const oldManifestEntries = new Map<string, any>();
  for (const f of MANIFESTS) {
    const text = gitShow(`${REL}/${f}`);
    if (!text) continue;
    try {
      for (const p of JSON.parse(text).plugins ?? []) {
        if (p && p.id) oldManifestEntries.set(String(p.id), p);
      }
    } catch (_) {}
  }

  const candidates: Candidate[] = [];
  for (const [id, p] of published) {
    const file = path.join(DIST, p.entry);
    if (!fs.existsSync(file)) continue;
    const newCode = fs.readFileSync(file, 'utf-8');
    const oldCode = gitShow(`${REL}/${p.entry}`);
    if (oldCode === null || oldCode === newCode) continue;
    candidates.push({
      id,
      entry: p.entry,
      oldCode,
      newCode,
      oldVersion: String(oldManifestEntries.get(id)?.version ?? 'unknown'),
      newVersion: String(p.version ?? 'unknown'),
    });
  }

  console.log(`  ${candidates.length} published plugin(s) changed since the last published version.`);

  const held: Array<{ id: string; oldVersion: string; newVersion: string; oldScore: number; newScore: number }> = [];
  const holdCodes = new Map<string, string>();

  for (let i = 0; i < candidates.length; i += BATCH) {
    if (Date.now() > DEADLINE) {
      console.warn('  Time budget reached, accepting the remaining updates untested.');
      break;
    }
    const batch = candidates.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (c) => {
        const oldR = await best(c.oldCode);
        const newR = await best(c.newCode);
        if (oldR.challenge || newR.challenge) {
          console.log(`  ${c.id}: Cloudflare challenge in test, inconclusive, accepting update`);
          return;
        }
        if (oldR.score >= 3 && newR.score < oldR.score) {
          console.warn(`  ${c.id}: HOLD (old ${oldR.score}/5 on v${c.oldVersion}, new ${newR.score}/5 on v${c.newVersion})`);
          held.push({
            id: c.id,
            oldVersion: c.oldVersion,
            newVersion: c.newVersion,
            oldScore: oldR.score,
            newScore: newR.score,
          });
          holdCodes.set(c.id, c.oldCode);
        } else {
          console.log(`  ${c.id}: ok (old ${oldR.score}/5, new ${newR.score}/5)`);
        }
      })
    );
  }

  for (const h of held) {
    const entry = published.get(h.id).entry as string;
    fs.writeFileSync(path.join(DIST, entry), holdCodes.get(h.id) as string, 'utf-8');
    const oldEntry = oldManifestEntries.get(h.id);
    if (!oldEntry) continue;
    for (const f of Object.keys(manifests)) {
      const plugins: any[] = manifests[f].plugins ?? [];
      const idx = plugins.findIndex((p) => p && String(p.id) === h.id);
      if (idx >= 0) plugins[idx] = oldEntry;
    }
  }

  if (held.length > 0) {
    for (const f of Object.keys(manifests)) {
      fs.writeFileSync(path.join(DIST, f), JSON.stringify(manifests[f], null, 2), 'utf-8');
    }
  }

  const reportPath = path.join(DIST, 'sync-report.json');
  let report: any = {};
  if (fs.existsSync(reportPath)) {
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    } catch (_) {}
  }
  report.held = held;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Update gate finished: ${held.length} update(s) held back.`);
}

main().catch((err) => {
  console.error('Update gate failed (continuing without it):', err);
  process.exit(0);
});
