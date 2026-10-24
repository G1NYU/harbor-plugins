import fs from 'node:fs';
import path from 'node:path';
import { generateHarborPluginBundle, SourceMeta } from '../shared/adapter/paperback-runtime.js';

const ROOT_DIR = process.cwd();
const CONFIG_FILE = path.join(ROOT_DIR, 'config', 'sources.json');
const DIST_MANGA_DIR = path.join(ROOT_DIR, 'dist', 'manga');
const PLUGINS_MANGA_DIR = path.join(ROOT_DIR, 'plugins', 'manga');

interface UpstreamSource {
  id: string;
  name: string;
  description?: string;
  version: string;
  icon?: string;
  language?: string;
  contentRating?: string;
}

interface UpstreamVersioning {
  repository: {
    name: string;
    description: string;
  };
  sources: UpstreamSource[];
}

interface UpstreamRef {
  name?: string;
  versioningUrl: string;
  rawBaseUrl: string;
}

interface Config {
  upstream: {
    repo: string;
    branch: string;
    versioningUrl: string;
    rawBaseUrl: string;
  };
  extraUpstreams?: UpstreamRef[];
  syncMode: string;
  popular: string[];
  verified: string[];
  options: {
    includeNsfw: boolean;
    maxBundleSizeMb: number;
    defaultTimeoutMs: number;
  };
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  lang: string;
  nsfw: boolean;
  icon?: string;
  entry: string;
  description?: string;
  badges?: string[];
}

function toPluginId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
}

function createMockHarbor(): { register: (p: any) => void; registered?: any; http: any; parseHtml: any; log: any } {
  const h: any = {
    http: async () => ({ status: 200, ok: true, headers: {}, body: '' }),
    parseHtml: async () => ({ querySelector: () => null, querySelectorAll: () => [] }),
    register: (p: any) => { h.registered = p; },
    log: () => {},
  };
  return h;
}

function testPlugin(code: string, id: string): boolean {
  try {
    const mockHarbor = createMockHarbor();
    const runner = new Function('harbor', code);
    runner(mockHarbor);

    const p = mockHarbor.registered;
    if (!p || !p.id || !p.name) return false;

    const req = ['popular', 'search', 'detail', 'chapters', 'pageUrls'];
    for (const m of req) {
      if (typeof p[m] !== 'function') return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Harbor-Plugin-Sync/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Harbor-Plugin-Sync/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Previously published plugins (last deployed manifests). Must be read before repo.json is rewritten.
function loadPreviousManifests(): Map<string, PluginManifest> {
  const previous = new Map<string, PluginManifest>();
  for (const file of ['repo.json', 'repo-extended.json']) {
    const p = path.join(DIST_MANGA_DIR, file);
    if (!fs.existsSync(p)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
      for (const m of json.plugins ?? []) {
        if (m && m.id && m.entry) previous.set(String(m.id), m as PluginManifest);
      }
    } catch (_) {}
  }
  return previous;
}

async function main() {
  console.log('Starting Automated Manga Upstream Conversion Pipeline...');

  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Config file not found: ${CONFIG_FILE}`);
  }

  const config: Config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  if (!fs.existsSync(DIST_MANGA_DIR)) {
    fs.mkdirSync(DIST_MANGA_DIR, { recursive: true });
  }

  const previous = loadPreviousManifests();
  const failures = new Map<string, string>();
  const upstreamStatus: Array<{ name: string; ok: boolean; count?: number; error?: string }> = [];

  const upstreams: UpstreamRef[] = [
    {
      name: config.upstream.repo,
      versioningUrl: config.upstream.versioningUrl,
      rawBaseUrl: config.upstream.rawBaseUrl,
    },
    ...(config.extraUpstreams ?? []),
  ];

  const queue: Array<{ source: UpstreamSource; rawBaseUrl: string }> = [];
  const seen = new Set<string>();

  for (const up of upstreams) {
    const upName = up.name ?? up.versioningUrl;
    try {
      console.log(`Fetching upstream registry from: ${up.versioningUrl}`);
      const versioning = await fetchJson<UpstreamVersioning>(up.versioningUrl);
      console.log(`Found ${versioning.sources.length} sources in ${upName}.`);
      upstreamStatus.push({ name: upName, ok: true, count: versioning.sources.length });
      for (const s of versioning.sources) {
        const pid = toPluginId(s.id);
        if (seen.has(pid)) continue;
        seen.add(pid);
        queue.push({ source: s, rawBaseUrl: up.rawBaseUrl });
      }
    } catch (err: any) {
      console.warn(`  Warning: could not read upstream ${up.versioningUrl}: ${err.message}`);
      upstreamStatus.push({ name: upName, ok: false, error: String(err.message).slice(0, 120) });
    }
  }

  if (queue.length === 0) {
    throw new Error('No upstream sources could be loaded');
  }

  const popularSet = new Set(config.popular.map((s) => s.toLowerCase()));
  const verifiedSet = new Set(config.verified.map((s) => s.toLowerCase()));

  const convertedManifests: PluginManifest[] = [];
  let successCount = 0;
  let skippedCount = 0;

  const BATCH_SIZE = 5;
  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async ({ source, rawBaseUrl }) => {
        const sourceLower = source.id.toLowerCase();
        const isPopular = popularSet.has(sourceLower);
        const isVerified = verifiedSet.has(sourceLower);
        const isNsfw = source.contentRating === 'ADULT' || source.contentRating === 'MATURE';

        if (!config.options.includeNsfw && isNsfw) {
          skippedCount++;
          return;
        }

        const pluginId = toPluginId(source.id);
        const bundleFileName = `${pluginId}.plugin.js`;
        const bundleUrl = `${rawBaseUrl}/${source.id}/index.js`;

        try {
          const rawCode = await fetchText(bundleUrl);

          const meta: SourceMeta = {
            id: pluginId,
            name: source.name || source.id,
            version: source.version || '1.0.0',
            description: source.description || `Manga source for ${source.name}`,
            icon: `${rawBaseUrl}/${source.id}/static/icon.png`,
            language: source.language || 'en',
            contentRating: source.contentRating,
            isPopular,
            isVerified,
          };

          const wrappedCode = generateHarborPluginBundle(rawCode, meta);
          const sizeBytes = Buffer.byteLength(wrappedCode, 'utf-8');

          if (sizeBytes > config.options.maxBundleSizeMb * 1024 * 1024) {
            console.warn(`  Skipping ${source.name}: exceeds max bundle size (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
            failures.set(pluginId, 'bundle exceeds max size');
            skippedCount++;
            return;
          }

          const isValid = testPlugin(wrappedCode, pluginId);
          if (!isValid) {
            console.warn(`  Skipping ${source.name}: failed Harbor compatibility validation`);
            failures.set(pluginId, 'failed Harbor compatibility validation');
            skippedCount++;
            return;
          }

          const destPath = path.join(DIST_MANGA_DIR, bundleFileName);
          fs.writeFileSync(destPath, wrappedCode, 'utf-8');

          const badges: string[] = [];
          if (isVerified) badges.push('Verified');
          if (isPopular) badges.push('Popular');

          let badgePrefix = '';
          if (badges.length > 0) {
            badgePrefix = `[${badges.join(' | ')}] `;
          }

          convertedManifests.push({
            id: pluginId,
            name: source.name,
            version: source.version || '1.0.0',
            lang: source.language || 'en',
            nsfw: isNsfw,
            icon: meta.icon,
            entry: bundleFileName,
            description: `${badgePrefix}${source.description || 'Manga source for ' + source.name}`,
            badges: badges.length > 0 ? badges : undefined,
          });

          const badgeIndicator = badges.length > 0 ? ` [${badges.join(', ')}]` : '';
          console.log(`  Converted ${source.name} (v${source.version})${badgeIndicator} -> ${(sizeBytes / 1024).toFixed(1)} KB`);
          successCount++;
        } catch (err: any) {
          console.warn(`  Failed to process ${source.name}: ${err.message}`);
          failures.set(pluginId, err.message);
          skippedCount++;
        }
      })
    );
  }

  const manualEntries = fs.readdirSync(PLUGINS_MANGA_DIR, { withFileTypes: true });
  for (const entry of manualEntries) {
    if (!entry.isDirectory()) continue;
    const manualManifestPath = path.join(PLUGINS_MANGA_DIR, entry.name, 'manifest.json');
    if (fs.existsSync(manualManifestPath)) {
      const manualManifest = JSON.parse(fs.readFileSync(manualManifestPath, 'utf-8'));
      if (!convertedManifests.some((m) => m.id === manualManifest.id)) {
        convertedManifests.push(manualManifest);
      }
    }
  }

  // Last-known-good fallback: anything published before that did not convert this run keeps its previous bundle.
  const restored: Array<{ id: string; version: string; reason: string }> = [];
  for (const [id, prevManifest] of previous) {
    if (convertedManifests.some((m) => m.id === id)) continue;
    const prevFile = path.join(DIST_MANGA_DIR, prevManifest.entry);
    if (!fs.existsSync(prevFile)) {
      console.warn(`  Cannot restore ${id}: previous bundle ${prevManifest.entry} is missing`);
      continue;
    }
    convertedManifests.push(prevManifest);
    const reason = failures.get(id) ?? 'no longer provided by any upstream';
    restored.push({ id, version: prevManifest.version ?? 'unknown', reason });
    console.warn(`  Restored ${id} (v${prevManifest.version}) from last known good: ${reason}`);
  }

  convertedManifests.sort((a, b) => {
    const aVerified = a.badges?.includes('Verified') ? 1 : 0;
    const bVerified = b.badges?.includes('Verified') ? 1 : 0;
    if (bVerified !== aVerified) return bVerified - aVerified;

    const aPopular = a.badges?.includes('Popular') ? 1 : 0;
    const bPopular = b.badges?.includes('Popular') ? 1 : 0;
    if (bPopular !== aPopular) return bPopular - aPopular;

    return a.name.localeCompare(b.name);
  });

  const repoMetaPath = path.join(PLUGINS_MANGA_DIR, 'repo.meta.json');
  let repoMeta = { name: 'Harbor Manga Repository', description: 'Comprehensive community manga source plugins' };
  if (fs.existsSync(repoMetaPath)) {
    repoMeta = JSON.parse(fs.readFileSync(repoMetaPath, 'utf-8'));
  }

  const fullRepoManifest = {
    ...repoMeta,
    plugins: convertedManifests,
  };

  const repoJsonPath = path.join(DIST_MANGA_DIR, 'repo.json');
  fs.writeFileSync(repoJsonPath, JSON.stringify(fullRepoManifest, null, 2), 'utf-8');

  fs.writeFileSync(
    path.join(DIST_MANGA_DIR, 'sync-report.json'),
    JSON.stringify({ restored, upstreams: upstreamStatus }, null, 2),
    'utf-8'
  );

  console.log('========================================');
  console.log('Upstream Sync and Conversion Complete');
  console.log(`   - Converted and verified: ${successCount} sources`);
  console.log(`   - Skipped or failed:      ${skippedCount} sources`);
  console.log(`   - Restored from last good: ${restored.length} sources`);
  console.log(`   - Total in repo.json:     ${convertedManifests.length} plugins`);
  console.log(`   - Output manifest:        ${repoJsonPath}`);
  console.log('========================================');
}

main().catch((err) => {
  console.error('Conversion pipeline failed:', err);
  process.exit(1);
});
