import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'manga');

// Display order in repo.json: pinned first, then approximate popularity.
// Ids missing from this list are placed at the end.
const ORDER = [
  'weebcentral',
  'kaynscan',
  'projectsuki',
  'mangadex',
  'nhentai',
  'mgeko',
  'kingofshojo',
  'manhuaplus',
  'mangapill',
  'flamecomics',
  'hivetoons',
  'mangadistrict',
  'manhwaclub',
  'lilymanga',
  'mangaworld',
  'mangaworldadult',
  'rawkuma',
  'tcbscans',
  'lnori',
  'scythescans',
  'reimanga',
  'cocomic',
  'manhwatoon',
  'samuraiscan',
  'mangaberri',
  'mangacherri',
  'chikari',
  'rinkocomics',
  'rokaricomics',
  'scansgg',
  'dankefurslesen',
  'punkrecords',
];

// Proven sources: shown in repo.json
const KEEP = new Set([
  'flamecomics',
  'hivetoons',
  'weebcentral',
  'mangadex',
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
  'samuraiscan',
  'chikari',
  'cocomic',
  'kingofshojo',
  'mangaberri',
  'mangacherri',
  'reimanga',
  'rinkocomics',
  'rokaricomics',
  'scansgg',
  'dankefurslesen',
  'kaynscan',
  'manhwatoon',
  'nhentai',
  'projectsuki',
  'rawkuma',
  'scythescans',
  'tcbscans',
]);

// Untested sources: shown in repo-testing.json (add ids here to try new ones)
const TESTING = new Set<string>([]);

const repoPath = path.join(DIST, 'repo.json');
const repo = JSON.parse(fs.readFileSync(repoPath, 'utf-8'));
const all: any[] = repo.plugins ?? [];

const idOf = (p: any) => String(p.id).toLowerCase();
const rank = (p: any) => {
  const i = ORDER.indexOf(idOf(p));
  return i < 0 ? ORDER.length : i;
};

const kept = all.filter((p) => KEEP.has(idOf(p))).sort((a, b) => rank(a) - rank(b));
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
