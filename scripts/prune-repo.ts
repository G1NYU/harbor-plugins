import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'manga');

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
]);

const repoPath = path.join(DIST, 'repo.json');
const repo = JSON.parse(fs.readFileSync(repoPath, 'utf-8'));
const all: any[] = repo.plugins ?? [];

const kept = all.filter((p) => KEEP.has(String(p.id).toLowerCase()));
const removed = all.filter((p) => !KEEP.has(String(p.id).toLowerCase()));

for (const id of KEEP) {
  if (!kept.some((p) => String(p.id).toLowerCase() === id)) {
    console.warn(`  Warning: allowlisted source '${id}' was not found in repo.json`);
  }
}

for (const p of removed) {
  if (!p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (fs.existsSync(f)) fs.rmSync(f);
}

repo.plugins = kept;
fs.writeFileSync(repoPath, JSON.stringify(repo, null, 2), 'utf-8');
console.log(`Pruned manga repo: kept ${kept.length}, removed ${removed.length}`);
