import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Royal Road is a prose platform. Keep its native Manga experiment in
// source control but never advertise it in an image-based reader.
const manga = path.resolve('dist/manga');
for (const name of ['repo.json', 'repo-extended.json', 'repo-testing.json']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(manga, name), 'utf8'));
  assert.ok(!manifest.plugins.some((p: any) => p.id === 'royalroad'), 'RoyalRoad must not be published in manga/' + name);
}
assert.ok(!fs.existsSync(path.join(manga, 'royalroad.plugin.js')), 'Unpublished Manga bundle must be pruned');
const ebook = JSON.parse(fs.readFileSync('dist/ebook/repo.json', 'utf8'));
const source = JSON.parse(fs.readFileSync('plugins/ebook/royalroad/manifest.json', 'utf8'));
const matches = ebook.plugins.filter((p: any) => p.id === 'royalroad');
assert.equal(matches.length, 1);
assert.equal(matches[0].version, source.version);
assert.ok(fs.existsSync(path.join('dist/ebook', matches[0].entry)));
console.log('Royal Road publication checks passed: eBook-only, Manga bundle pruned.');
