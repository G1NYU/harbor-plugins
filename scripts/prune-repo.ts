import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'manga');

// Display order in repo.json: pinned first, then approximate popularity.
// Ids missing from this list are placed at the end.
const ORDER = [
  'asura-seanime',
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
const EXTENDED = new Set<string>(['batcave', 'royalroad']);

// Untested sources: shown in repo-testing.json (add ids here to try new ones)
const TESTING = new Set<string>([
  'probe',
  'mangasushi',
]);

// Testing sources that get no debug wrapper
const DEBUG_SKIP = new Set<string>(['probe', 'asura-seanime']);

// Published sources whose bundles need the globalThis shim (they assign globalThis.App at load)
const SHIM_PUBLISHED = new Set<string>(['thunderscans', 'mangakatana', 'mangademon', 'vortexscans', 'atsumaru']);

// Atsumaru lists several cover variants. The small, medium and large ones are AVIF files that Harbor's covers do not show;
// the plain image field is a JPEG. Reorder 'X.mediumImage ?? X.smallImage ?? X.image' so the JPEG comes first.
const ATSUMARU_COVER_RE = /(\w+)(\??\.)mediumImage\?\?\1\2smallImage\?\?\1\2image/g;
const ATSUMARU_COVER_REPLACE = '$1$2image??$1$2mediumImage??$1$2smallImage';

// Experiment (testing copies listed here only): Harbor seems to draw grid covers only from web hosts the plugin has already
// contacted. Before a list is returned, download one cover per image host so Harbor has seen that host.
const TOUCH_IDS = new Set<string>(['atsumaru-dbg']);
const COVER_TOUCH_SNIPPET = [
  '  // --- cover host contact (testing repo only) ---',
  '  (function () {',
  '    var seen = {};',
  '    function originOf(u) {',
  '      u = String(u || "");',
  '      var i = u.indexOf("://");',
  '      if (i < 0) return "";',
  '      var j = u.indexOf("/", i + 3);',
  '      return j < 0 ? u : u.slice(0, j);',
  '    }',
  '    async function touch(items) {',
  '      if (!items || !items.length) return;',
  '      var jobs = [];',
  '      for (var i = 0; i < items.length; i++) {',
  '        var c = items[i] && items[i].cover;',
  '        var o = originOf(c);',
  '        if (!o || seen[o]) continue;',
  '        seen[o] = true;',
  '        try { jobs.push(Promise.resolve(harbor.http(c, { method: "GET", responseType: "text", timeoutMs: 10000 })).catch(function () {})); } catch (_) {}',
  '      }',
  '      if (jobs.length) await Promise.all(jobs);',
  '    }',
  '    ["popular", "search"].forEach(function (name) {',
  '      var orig = plugin[name];',
  '      plugin[name] = async function () {',
  '        var r = await orig.apply(this, arguments);',
  '        try { await touch(r); } catch (_) {}',
  '        return r;',
  '      };',
  '    });',
  '  })();',
  '',
].join('\n');

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

// Interceptor support (testing repo only): the bridge normally stores only the interceptor id and drops the functions.
// Keep the request/response functions and run them around every Application.scheduleRequest call.
const INTERCEPT_PATCH = [
  '// --- interceptor support (testing repo only) ---',
  'const __icpt = [];',
  'Application.registerInterceptor = function (id, reqSel, respSel) {',
  '  for (let i = __icpt.length - 1; i >= 0; i--) { if (__icpt[i].id === id) __icpt.splice(i, 1); }',
  '  __icpt.push({ id: id, req: reqSel, res: respSel });',
  '};',
  'Application.unregisterInterceptor = function (id) {',
  '  for (let i = __icpt.length - 1; i >= 0; i--) { if (__icpt[i].id === id) __icpt.splice(i, 1); }',
  '};',
  'const __baseSchedule = Application.scheduleRequest;',
  'Application.scheduleRequest = async function (req) {',
  '  let r = Object.assign({}, req);',
  '  for (const ic of __icpt.slice()) {',
  '    if (typeof ic.req === "function") { const out = await ic.req(r); if (out) r = out; }',
  '  }',
  '  if (r.cookies && typeof r.cookies === "object") {',
  '    const pairs = Object.keys(r.cookies).map(function (k) { return k + "=" + r.cookies[k]; });',
  '    if (pairs.length) r.headers = Object.assign({}, r.headers || {}, { cookie: pairs.join("; ") });',
  '  }',
  '  const result = await __baseSchedule.call(Application, r);',
  '  const resp = Object.assign({ cookies: [] }, result[0]);',
  '  let data = result[1];',
  '  for (const ic of __icpt.slice()) {',
  '    if (typeof ic.res === "function") { const out = await ic.res(r, resp, data); if (out) data = out; }',
  '  }',
  '  return [result[0], data];',
  '};',
  '',
].join('\n');

// Debug wrapper injected into testing-repo bundles: shows real errors as rows (cards cut text, so short rows)
const DEBUG_SNIPPET = [
  '  // --- debug wrapper (testing repo only) ---',
  '  (function () {',
  '    var lastReq = "";',
  '    var lastMsg = "";',
  '    function errText(e) {',
  '      var m = (e && e.message) ? e.message : String(e);',
  '      var fr = "";',
  '      try {',
  '        var ls = String((e && e.stack) || "").split("\\n").slice(1, 5);',
  '        var parts = [];',
  '        for (var i = 0; i < ls.length; i++) {',
  '          var pos = ls[i].match(/<anonymous>:(\\d+:\\d+)/);',
  '          if (pos) parts.push(pos[1]);',
  '        }',
  '        if (parts.length) fr = " @" + parts.join(",");',
  '      } catch (_) {}',
  '      return String(m).slice(0, 160) + fr;',
  '    }',
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
  '          if (name === "popular" && r && r.length && r[0] && r[0].id !== "debug-0") {',
  '            var cv = [];',
  '            for (var q = 0; q < r.length && q < 2; q++) cv.push(String(r[q] && r[q].cover));',
  '            var cm = "COVERS: " + cv.join(" | ");',
  '            var extra = [];',
  '            for (var z = 0; z < cm.length && extra.length < 12; z += 34) extra.push({ id: "cov-" + extra.length, title: cm.slice(z, z + 34) });',
  '            return r.concat(extra);',
  '          }',
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

// Debug copy of Atsumaru under its own id in the testing repo, to see which cover links the plugin returns inside Harbor
// and to test the cover-host contact step.
const atsuPub = kept.find((p) => idOf(p) === 'atsumaru');
if (atsuPub && atsuPub.entry) {
  const srcFile = path.join(DIST, atsuPub.entry);
  if (fs.existsSync(srcFile)) {
    const cloneEntry = 'atsumaru-dbg.plugin.js';
    const srcCode = fs.readFileSync(srcFile, 'utf-8');
    if (!srcCode.includes('id: "atsumaru",')) console.warn('  Warning: could not rename the Atsumaru debug copy');
    fs.writeFileSync(path.join(DIST, cloneEntry), srcCode.replace('id: "atsumaru",', () => 'id: "atsumaru-dbg",'), 'utf-8');
    testing.push({ ...atsuPub, id: 'atsumaru-dbg', name: 'Atsumaru (cover debug)', entry: cloneEntry });
  }
}

// Apply the globalThis shim, interceptor support, debug wrapper and load guard to testing-only bundles
for (const p of testing) {
  if (DEBUG_SKIP.has(idOf(p)) || !p.entry) continue;
  const f = path.join(DIST, p.entry);
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf-8');
  if (code.includes('debug wrapper (testing repo only)')) continue;
  if (code.includes(EXEC_FIND) && code.includes(CALL_FIND)) {
    code = code.replace(EXEC_FIND, () => INTERCEPT_PATCH + EXEC_REPLACE).replace(CALL_FIND, () => CALL_REPLACE);
  } else if (!code.includes('const __realG')) {
    console.warn(`  Warning: ${p.entry} has no executeUpstream marker; globalThis shim skipped`);
  }
  const marker = '// Register with Harbor';
  const at = code.lastIndexOf(marker);
  if (at < 0) {
    console.warn(`  Warning: no registration marker in ${p.entry}; debug wrapper skipped`);
    continue;
  }
  const lineStart = code.lastIndexOf('\n', at) + 1;
  const touchPart = TOUCH_IDS.has(idOf(p)) ? COVER_TOUCH_SNIPPET : '';
  const injected = code.slice(0, lineStart) + touchPart + DEBUG_SNIPPET + code.slice(lineStart);
  const guarded = 'try {\n' + injected + loadGuardTail(String(p.id), String(p.name));
  fs.writeFileSync(f, guarded, 'utf-8');
  p.version = `${p.version}-dbg.i3`;
  p.name = `${p.name} [dbg.i3]`;
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
