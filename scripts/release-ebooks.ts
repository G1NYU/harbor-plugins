import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'dist', 'ebook');
const repoPath = path.join(dir, 'repo.json');
const repo = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
const lineup = [
  { id: 'readanybook-fresh', name: 'GinyuBooks ★', version: '1.3.0-alpha.1', description: 'Read books from ReadAnyBook. Alpha release: source reading order retained; chapter labels vary by edition. Browse and search return the first page only.' },
  { id: 'royalroad' },
  { id: 'libgen-stream', name: 'Library Genesis (Stream) [Download only]', version: '1.3.1-alpha.1', description: 'Library Genesis catalogue and download links. Published as download only; in-app chapter streaming is not promised. Existing provider behavior is unchanged.' },
  { id: 'standardebooks' },
] satisfies Array<{ id: string; name?: string; version?: string; description?: string }>;

const selected = lineup.map((spec) => {
  const found = (repo.plugins || []).filter((p: any) => p.id === spec.id);
  if (found.length !== 1) throw new Error('Expected exactly one built source: ' + spec.id);
  const original = found[0];
  const plugin = { ...original, ...spec };
  if (typeof plugin.entry !== 'string' || path.basename(plugin.entry) !== plugin.entry || !plugin.entry.endsWith('.plugin.js')) throw new Error('Invalid ebook entry: ' + spec.id);
  const file = path.join(dir, plugin.entry);
  let code = fs.readFileSync(file, 'utf8');
  if (spec.name && spec.name !== original.name) {
    const before = JSON.stringify(original.name);
    const after = JSON.stringify(spec.name);
    if (!code.includes(before)) throw new Error('Provider display name not found in built source: ' + spec.id);
    code = code.replaceAll(before, after);
  }
  return { plugin, file, code };
});

if (new Set(selected.map(({ plugin }) => plugin.id)).size !== 4) throw new Error('Alpha ebook release must contain four unique sources');
for (const { file, code } of selected) fs.writeFileSync(file, code, 'utf8');
const manifest = { ...repo, type: 'ebook', name: 'Community eBook Repo (Alpha)', description: 'Four-source alpha release: GinyuBooks, Royal Road, Library Genesis Stream (download only), and Standard Ebooks.', plugins: selected.map(({ plugin }) => plugin) };
const text = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(repoPath, text, 'utf8');
fs.writeFileSync(path.join(dir, 'repo-alpha.json'), text, 'utf8');

const keep = new Set(selected.map(({ plugin }) => plugin.entry));
for (const entry of fs.readdirSync(dir)) {
  if ((entry.endsWith('.plugin.js') && !keep.has(entry)) || (/^repo.*\.json$/.test(entry) && !['repo.json', 'repo-alpha.json'].includes(entry))) {
    fs.rmSync(path.join(dir, entry));
  }
}
console.log('Published four alpha ebook sources: ' + selected.map(({ plugin }) => plugin.name).join(', '));
