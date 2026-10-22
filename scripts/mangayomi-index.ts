import fs from 'node:fs';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'manga');
const BASE = process.env.PAGES_BASE ?? 'https://g1nyu.github.io/harbor-plugins/manga';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const repo = JSON.parse(fs.readFileSync(path.join(DIST, 'repo.json'), 'utf-8'));

const index = (repo.plugins as any[]).map((p) => ({
  name: p.name,
  id: hash(String(p.id)),
  baseUrl: p.website ?? '',
  lang: p.lang ?? 'en',
  typeSource: 'single',
  iconUrl: p.icon ?? '',
  dateFormat: '',
  dateFormatLocale: '',
  isNsfw: Boolean(p.nsfw),
  hasCloudflare: false,
  sourceCodeUrl: `${BASE}/${p.entry}`,
  apiUrl: '',
  version: p.version ?? '1.0.0',
  isManga: true,
  itemType: 0,
  isFullData: false,
  appMinVerReq: '0.5.0',
  additionalParams: '',
  sourceCodeLanguage: 1,
  notes: p.description ?? '',
}));

fs.writeFileSync(path.join(DIST, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
console.log(`Wrote Mangayomi-style index.json with ${index.length} entries`);
