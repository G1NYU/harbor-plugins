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

// Work, but with caveats (Cloudflare popup etc.): only shown in repo-extended.json
const EXTENDED = new Set<string>(['batcave', 'royalroad']);

// Untested sources: shown in repo-testing.json (add ids here to try new ones)
const TESTING = new Set<string>([
  'probe',
  'atsumaru',
  'mangakatana',
  'mangademon',
  'thunderscans',
  'hijala',
  'kagane',
  'mangasushi',
  'manhwanex',
  'vortexscans',
  'asurascans',
]);

// Testing sources that already work: no debug wrapper
const DEBUG_SKIP = new Set<string>(['probe', 'hijala', 'manhwanex']);

// Compat shim: many upstream bundles run globalThis.App = ..., but Harbor's runtime has no usable globalThis.
// Give the bundle its own globalThis (reads fall through to the real one if present) and keep App in sync with a bare App variable.
const EXEC_FIND = 'const __executeUpstream = (Application) => {';
const EXEC_REPLACE = [
  'const __realG = (typeof globalThis === "object" && globalThis) ? globalThis : null;',
  'const __executeUpstream = (Application) => {',
  '  var globalThis = Object.create(__realG);',
  '  var App;',
  '  try { Object.defineProperty(globalThis, "App", { configurable: true, enumerable: true, get: function () { return App; }, set: function (v) { App = v; } }); } catch (_) {}',
].join('\n');

// Debug wrapper injected into testing-repo bundles: shows real errors as rows (cards cut text, so short rows)
const DEBUG_SNIPPET = [
  '  // --- debug wrapper (testing repo only) ---',
  '  (function () {',
  '    var lastReq = "";',
  '    var lastMsg = "";',
  '    function errText(e) { var m = (e && e.message) ? e.message : String(e); return String(m).slice(0, 200); }',
  '    try {',
  '      var oh = harbor.http;',
  '      harbor.http = async function (u, o) {',
  '        var m = (o && o.method) || "GET";',
  '        lastReq = m + " " + String(u).slice(0, 80) + " -> pending";',
  '        try {',
  '          var r = await oh.call(harbor, u, o);',
  '          lastReq = m + " " + String(u).slice(0, 80) + " -> " + r.status + " " + Math.round(String(r.body || "").length / 1024) + "KB";',
  '          return r;',
  '        } catch (e) {',
  '          lastReq = m + " " + String(u).slice(0, 80) + " -> THROW " + errText(e);',
  '          throw e;',
  '        }',
  '      };',
  '    } catch (_) {}',
  '    function full(msg) { return msg + (lastReq ? " | last request: " + lastReq : " | no web request made"); }',
  '    function rows(msg) {',
  '      lastMsg = full(msg);',
  '      var out = [];',
  '      for (var i = 0; i < lastMsg.length && out.length < 10; i += 34) {',
  '        out.push({ id: "debug-" + out.length, title: lastMsg.slice(i, i + 34) });',
  '      }',
  '      return out;',
  '    }',
  '    ["popular", "search"].forEach(function (name) {',
  '      var orig = plugin[name];',
  '      plugin[name] = async function () {',
  '        var args = arguments;',
  '        try {',
  '          var tmo = (typeof setTimeout === "function") ? new Promise(function (_, rej) { setTimeout(function () { rej(new Error("TIMEOUT after 12s")); }, 12000); }) : new Promise(function () {});',
  '          var r = await Promise.race([orig.apply(this, args), tmo]);',
  '          var emptyQuery = name === "popular" || !args[0];',
  '          if ((!r || r.length === 0) && emptyQuery) return rows("EMPTY " + name + " (0 items parsed)");',
  '          return r;',
  '        } catch (e) {',
  '          try { harbor.log("[debug] " + name + " failed:", e); } catch (_) {}',
  '          return rows("ERR " + name + ": " + errText(e));',
  '        }',
  '      };',
  '    });',
  '    var od = plugin.detail;',
  '    plugin.detail = async function (id) {',
  '      if (String(id).indexOf("debug-") === 0) return { id: id, title: lastMsg.slice(0, 120), description: lastMsg };',
  '      try {',
  '        var r = await od.apply(this, arguments);',
  '        if (!r) { lastMsg = full("EMPTY detail (null returned)"); return { id: id, title: lastMsg.slice(0, 120), description: lastMsg }; }',
  '        return r;',
  '      } catch (e) {',
  '        lastMsg = full("ERR detail: " + errText(e));',
  '        return { id: id, title: lastMsg.slice(0, 120), description: lastMsg };',
  '      }',
  '    };',
  '    function dbgChapter(id, msg) {',
  '      return { id: id + "::debug", chapter: null, title: full(msg), volume: null, pages: 0, language: "en" };',
  '    }',
  '    var oc = plugin.chapters;',
  '    plugin.chapters = async function (id) {',
  '      try {',
  '        var r = await oc.apply(this, arguments);',
  '        if (!r || r.length === 0) return [dbgChapter(id, "EMPTY chapters (0 parsed)")];',
  '        return r;',
  '      } catch (e) {',
  '        return [dbgChapter(id, "ERR chapters: " + errText(e))];',
  '      }',
  '    };',
  '  })();',
  '',
].join('\n');

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
const rank = (p: any) => {
  const i = ORDER.indexOf(idOf(p));
  return i < 0 ? ORDER.length : i;
};

const kept = all.filter((p) => KEEP.has(idOf(p))).sort((a, b) => rank(a) - rank(b));
const extra = all.filter((p) => EXTENDED.has(idOf(p)));
const testing = all.filter((p) => TESTING.has(idOf(p)));
const removed = all.filter((p) => !KEEP.has(idOf(p)) && !EXTENDED.has(idOf(p)) && !TESTING.has(idOf(p)));

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

// Apply the globalThis shim, debug wrapper and load guard to testing-only bundles
for (const p of testing) {
  if (DEBUG_SKIP.has(idOf(p)) || !p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf-8');
  if (code.includes('debug wrapper (testing repo only)')) continue;
  if (code.includes(EXEC_FIND)) {
    code = code.replace(EXEC_FIND, () => EXEC_REPLACE);
  } else {
    console.warn(`  Warning: ${p.entry} has no executeUpstream marker; globalThis shim skipped`);
  }
  const marker = '// Register with Harbor';
  const at = code.lastIndexOf(marker);
  if (at < 0) {
    console.warn(`  Warning: no registration marker in ${p.entry}; debug wrapper skipped`);
    continue;
  }
  const lineStart = code.lastIndexOf('\n', at) + 1;
  const injected = code.slice(0, lineStart) + DEBUG_SNIPPET + code.slice(lineStart);
  const guarded = 'try {\n' + injected + loadGuardTail(String(p.id), String(p.name));
  fs.writeFileSync(f, guarded, 'utf-8');
  p.version = `${p.version}-dbg`;
  p.name = `${p.name} [dbg]`;
}

if (testing.length > 0) {
  const testingRepo = {
    ...repo,
    name: `${repo.name} (Testing)`,
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
