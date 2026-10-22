import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'manga');

// Proven sources: shown in repo.json
const KEEP = new Set([
  'dragontea',
  'flamecomics',
  'hivetoons',
  'weebcentral',
  'mangadex',
  'kagane',
  'lilymanga',
  'lnori',
  'mangadistrict',
  'mangapill',
  'mangaworld',
  'mangaworldadult',
  'manhuaplus',
  'manhwaclub',
  'mgeko',
  'punkrecords',
  'royalroad',
  'samuraiscan',
  'chikari',
  'cocomic',
  'kingofshojo',
  'likemanga',
  'mangaberri',
  'mangacherri',
  'mangahere',
  'mangahome',
  'mangatown',
  'reimanga',
  'rinkocomics',
  'rokaricomics',
  'scansgg',
  'stonescape',
]);

// Untested sources: shown in repo-testing.json (add ids here to try new ones)
const TESTING = new Set<string>([]);

const repoPath = path.join(DIST, 'repo.json');
const repo = JSON.parse(fs.readFileSync(repoPath, 'utf-8'));
const all: any[] = repo.plugins ?? [];

const idOf = (p: any) => String(p.id).toLowerCase();

const kept = all.filter((p) => KEEP.has(idOf(p)));
const testing = all.filter((p) => TESTING.has(idOf(p)));
const removed = all.filter((p) => !KEEP.has(idOf(p)) && !TESTING.has(idOf(p)));

for (const id of [...KEEP, ...TESTING]) {
  if (!all.some((p) => idOf(p) === id)) {
    console.warn(`  Warning: allowlisted source '${id}' was not found in repo.json`);
  }
}

for (const p of removed) {
  if (!p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (fs.existsSync(f)) fs.rmSync(f);
}

if (testing.length > 0) {
  const testingRepo = {
    ...repo,
    name: `${repo.name} (Testing)`,
    plugins: testing,
  };
  fs.writeFileSync(path.join(DIST, 'repo-testing.json'), JSON.stringify(testingRepo, null, 2), 'utf-8');
}

repo.plugins = kept;
fs.writeFileSync(repoPath, JSON.stringify(repo, null, 2), 'utf-8');
console.log(`Pruned manga repo: kept ${kept.length}, testing ${testing.length}, removed ${removed.length}`);
