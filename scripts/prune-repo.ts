import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'manga');

// Display order in repo.json: pinned first, then approximate popularity.
// Ids missing from this list are placed at the end.
const ORDER = [
  'asura-seanime',
  'legion-scans',
  'weebcentral',
  'kaynscan',
  'projectsuki',
  'mangadex',
  'nhentai',
  'mgeko',
  'kingofshojo',
  'manhuaplus',
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
  'thunderscans',
  'mangakatana',
  'mangademon',
  'vortexscans',
  'hijala',
  'manhwanex',
  'atsumaru',
];

// Proven sources: shown in repo.json
const KEEP = new Set([
  'asura-seanime',
  'legion-scans',
  'flamecomics',
  'hivetoons',
  'weebcentral',
  'mangadex',
  'lilymanga',
  'lnori',
  'mangadistrict',
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
  'thunderscans',
  'mangakatana',
  'mangademon',
  'vortexscans',
  'hijala',
  'manhwanex',
  'atsumaru',
]);

// Work, but with caveats (Cloudflare popup etc.): only shown in repo-extended.json
const EXTENDED = new Set<string>([]);

// Clean testing sources: shown in repo-testing.json without debug cards
const TESTING = new Set<string>([
  'mangasushi',
  'batcave',
  'royalroad',
  'readall-native2',
  'mangapill',
  'atsumaru',
]);

// Diagnostic prefixes remain available but are excluded from this clean testing build.
const TESTING_PREFIXES: string[] = [];

// No debug wrapper is applied in the clean testing build.
const DEBUG_SKIP = new Set<string>([
  'asura-seanime',
  'mangasushi',
  'batcave',
  'royalroad',
  'readall-native2',
  'mangapill',
  'atsumaru',
]);
const DEBUG_SKIP_PREFIXES: string[] = [];

// Published sources whose bundles need the globalThis shim (they assign globalThis.App at load)
const SHIM_PUBLISHED = new Set<string>(['thunderscans', 'mangakatana', 'mangademon', 'vortexscans', 'atsumaru']);

// Atsumaru lists several cover variants. The small, medium and large ones are AVIF files that Harbor's covers do not show;
// the plain image field is a JPEG. Reorder 'X.mediumImage ?? X.smallImage ?? X.image' so the JPEG comes first.
const ATSUMARU_COVER_RE = /(\w+)(\??\.)mediumImage\?\?\1\2smallImage\?\?\1\2image/g;
const ATSUMARU_COVER_REPLACE = '$1$2image??$1$2mediumImage??$1$2smallImage';

// Compat shim: many upstream bundles run globalThis.App = ... (or this.App / self.App), but Harbor's runtime has no usable globalThis/self.
// Run the bundle as a normal function bound to its own global-like object (reads fall through to the real global if present)
// and keep App in sync with a bare App variable.
const EXEC_FIND = 'const __executeUpstream = (Application) => {';
const EXEC_REPLACE = [
  'const __realG = (typeof globalThis === "object" && globalThis) ? globalThis : null;',
  'const __executeUpstream = function (Application) {',
  '  var globalThis = this;',
  '  var self = this;',
  '  var App;',
  '  try { Object.defineProperty(this, "App", { configurable: true, enumerable: true, get: function () { return App; }, set: function (v) { App = v; } }); } catch (_) {}',
].join('\n');
const CALL_FIND = 'const __sourceModule = __executeUpstream(Application);';
const CALL_REPLACE = 'const __sourceModule = __executeUpstream.call(Object.create(__realG), Application);';

// Load-time guard: if the bundle throws while loading in Harbor, register a plugin that shows the error and missing runtime features
function loadGuardTail(id: string, name: string): string {
  return (
    '\n} catch (__e) {\n' +
    [
      '(function () {',
      '  var t = { TextDecoder: typeof TextDecoder, TextEncoder: typeof TextEncoder, URL: typeof URL, URLSearchParams: typeof URLSearchParams, structuredClone: typeof structuredClone, Intl: typeof Intl, atob: typeof atob, btoa: typeof btoa, setTimeout: typeof setTimeout, AbortController: typeof AbortController, Headers: typeof Headers, Blob: typeof Blob, FormData: typeof FormData, Proxy: typeof Proxy, Reflect: typeof Reflect, WeakRef: typeof WeakRef, queueMicrotask: typeof queueMicrotask, globalThis: typeof globalThis, crypto: typeof crypto, window: typeof window, document: typeof document, self: typeof self };',
      '  var miss = [];',
      '  for (var k in t) { if (t[k] === "undefined") miss.push(k); }',
      '  var m = (__e && __e.message) ? __e.message : String(__e);',
      '  var st = (__e && __e.stack) ? String(__e.stack).split("\\n").slice(0, 2).join(" / ") : "";',
      '  var msg = "LOAD ERR: " + m + (st ? " | " + st : "") + " | missing: " + (miss.length ? miss.join(",") : "none");',
      '  var rows = function () { var out = []; for (var i = 0; i < msg.length && out.length < 12; i += 34) out.push({ id: "debug-" + out.length, title: msg.slice(i, i + 34) }); return out; };',
      '  harbor.register({ id: ' + JSON.stringify(id) + ', name: ' + JSON.stringify(name) + ', popular: async function () { return rows(); }, search: async function () { return rows(); }, detail: async function (id) { return { id: id, title: msg.slice(0, 120), description: msg }; }, chapters: async function () { return []; }, pageUrls: async function () { return []; } });',
      '})();',
    ].join('\n') +
    '\n}\n'
  );
}

const repoPath = path.join(DIST, 'repo.json');
const repo = JSON.parse(fs.readFileSync(repoPath, 'utf-8'));
const all: any[] = repo.plugins ?? [];

const idOf = (p: any) => String(p.id).toLowerCase();
const startsWithAny = (id: string, prefixes: string[]) => prefixes.some((x) => id.startsWith(x));
const inTesting = (p: any) => TESTING.has(idOf(p)) || startsWithAny(idOf(p), TESTING_PREFIXES);
const skipsDebug = (p: any) => DEBUG_SKIP.has(idOf(p)) || startsWithAny(idOf(p), DEBUG_SKIP_PREFIXES);
const rank = (p: any) => {
  const i = ORDER.indexOf(idOf(p));
  return i < 0 ? ORDER.length : i;
};

const kept = all.filter((p) => KEEP.has(idOf(p))).sort((a, b) => rank(a) - rank(b));
const extra = all.filter((p) => EXTENDED.has(idOf(p)));
const testing = all.filter((p) => inTesting(p));
const removed = all.filter((p) => !KEEP.has(idOf(p)) && !EXTENDED.has(idOf(p)) && !inTesting(p));

for (const id of [...KEEP, ...EXTENDED, ...TESTING]) {
  if (!all.some((p) => idOf(p) === id)) {
    console.warn(`  Warning: allowlisted source '${id}' was not found in repo.json`);
  }
}

for (const p of removed) {
  if (!p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (fs.existsSync(f)) fs.rmSync(f);
}

// Apply the globalThis shim (and source-specific fixes) to published bundles that need it
for (const p of kept) {
  if (!SHIM_PUBLISHED.has(idOf(p)) || !p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf-8');
  const original = code;
  if (!code.includes('const __realG')) {
    if (code.includes(EXEC_FIND) && code.includes(CALL_FIND)) {
      code = code.replace(EXEC_FIND, () => EXEC_REPLACE).replace(CALL_FIND, () => CALL_REPLACE);
    } else {
      console.warn(`  Warning: ${p.entry} has no executeUpstream marker; globalThis shim skipped`);
    }
  }
  if (idOf(p) === 'atsumaru') {
    const fixed = code.replace(ATSUMARU_COVER_RE, ATSUMARU_COVER_REPLACE);
    if (fixed === code) console.warn('  Warning: Atsumaru cover pattern not found; covers unchanged');
    code = fixed;
    // New version string so Harbor does not keep serving a cached copy (semver: alpha.25.1 > alpha.25)
    p.version = `${p.version}.1`;
  }
  if (code !== original) fs.writeFileSync(f, code, 'utf-8');
}

// Clean testing build: apply only the compatibility shim and load guard; no debug cards, cover URL rows, or request logs.
for (const p of testing) {
  if (skipsDebug(p) || !p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf-8');
  if (code.includes('debug wrapper (testing repo only)')) continue;
  if (code.includes(EXEC_FIND) && code.includes(CALL_FIND)) {
    code = code.replace(EXEC_FIND, () => EXEC_REPLACE).replace(CALL_FIND, () => CALL_REPLACE);
  } else if (!code.includes('const __realG')) {
    console.warn(`  Warning: ${p.entry} has no executeUpstream marker; globalThis shim skipped`);
  }
  const guarded = 'try {\n' + code + loadGuardTail(String(p.id), String(p.name));
  fs.writeFileSync(f, guarded, 'utf-8');
  p.version = `${p.version}-clean.1`;
  p.name = `${p.name} [clean]`;
}

if (testing.length > 0) {
  const testingRepo = {
    ...repo,
    name: `${repo.name} (Testing)`,
    description: 'Clean testing repository: no diagnostic cards or request logging.',
    plugins: testing,
  };
  fs.writeFileSync(path.join(DIST, 'repo-testing.json'), JSON.stringify(testingRepo, null, 2), 'utf-8');
}

const extendedRepo = {
  ...repo,
  name: `${repo.name} (Extended)`,
  description: `${repo.description ?? ''} Includes sources that work but may show a Cloudflare popup.`.trim(),
  plugins: [...kept, ...extra],
};
fs.writeFileSync(path.join(DIST, 'repo-extended.json'), JSON.stringify(extendedRepo, null, 2), 'utf-8');

repo.plugins = kept;
fs.writeFileSync(repoPath, JSON.stringify(repo, null, 2), 'utf-8');

// Only report fallbacks for sources that are actually published.
const reportPath = path.join(DIST, 'sync-report.json');
if (fs.existsSync(reportPath)) {
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    const published = new Set([...kept, ...extra].map(idOf));
    report.restored = (report.restored ?? []).filter((r: any) => published.has(String(r.id).toLowerCase()));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  } catch (_) {}
}

console.log(`Pruned manga repo: kept ${kept.length}, extended +${extra.length}, testing ${testing.length}, removed ${removed.length}`);
