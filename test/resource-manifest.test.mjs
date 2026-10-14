import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resource manifest contains 288 unique, well-formed HTTP(S) sources', async () => {
  const source = await readFile(path.join(root, 'research/registry/resource_manifest.csv'), 'utf8');
  const lines = source.trimEnd().split(/\r?\n/);
  const header = lines.shift().split(',');
  assert.deepEqual(header, ['id', 'category', 'url', 'default_method', 'priority', 'review_status', 'evidence_id', 'commit_or_capture_digest', 'license', 'decision']);
  const rows = lines.map(line => {
    const fields = line.split(',');
    assert.equal(fields.length, header.length);
    return Object.fromEntries(header.map((key, index) => [key, fields[index]]));
  });
  assert.equal(rows.length, 288);
  assert.equal(new Set(rows.map(row => row.id)).size, 288);
  assert.equal(new Set(rows.map(row => row.url)).size, 288);
  assert.equal(new Set(rows.map(row => row.category)).size, 21);
  assert.deepEqual(Object.fromEntries(['P0', 'P1', 'P2'].map(priority => [priority, rows.filter(row => row.priority === priority).length])), { P0: 45, P1: 84, P2: 159 });
  for (const row of rows) assert.ok(['http:', 'https:'].includes(new URL(row.url).protocol), row.id);
});

test('source review batches are resumable, unique, and trace each finding to validation evidence', async () => {
  const manifest = await readFile(path.join(root, 'research/registry/resource_manifest.csv'), 'utf8');
  const manifestIds = new Set(manifest.trimEnd().split(/\r?\n/).slice(1).map(line => line.split(',')[0]));
  const registry = path.join(root, 'research/registry');
  const files = (await readdir(registry)).filter(name => /^source-review-batch-\d+-\d{4}-\d{2}-\d{2}\.json$/.test(name));
  const reviewed = [];
  for (const file of files) {
    const batch = JSON.parse(await readFile(path.join(registry, file), 'utf8'));
    const declaredCount = batch.sourcesReviewed ?? batch.manifest?.reviewedThisBatch;
    assert.equal(batch.sources.length, declaredCount, file);
    for (const source of batch.sources) {
      assert.ok(manifestIds.has(source.id), `${file}:${source.id} is not in the input manifest`);
      assert.equal(source.status, 'PARTIAL_REVIEW', `${file}:${source.id}`);
      assert.ok(source.provenance.length > 0, `${file}:${source.id} missing provenance`);
      assert.ok(source.discoveries.length > 0 && source.discoveries.length <= 3, `${file}:${source.id} discovery count`);
      assert.ok(source.patterns.length > 0, `${file}:${source.id} missing useful patterns`);
      assert.ok(source.sylphModules.length > 0, `${file}:${source.id} missing module mapping`);
      assert.ok(source.risks.length > 0, `${file}:${source.id} missing integration risks`);
      assert.ok(source.validation.length > 0, `${file}:${source.id} missing validation requirements`);
      assert.ok(source.evidence.length > 0, `${file}:${source.id} missing evidence`);
      reviewed.push(source.id);
    }
  }
  assert.equal(files.length, 23);
  assert.equal(reviewed.length, 288);
  assert.equal(new Set(reviewed).size, reviewed.length, 'source appears in multiple review batches');
});
