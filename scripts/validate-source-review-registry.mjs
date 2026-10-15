import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = join(root, 'research', 'registry');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const [headers, ...records] = rows;
  if (!headers?.length || records.some(record => record.length !== headers.length)) throw new Error('CSV_COLUMN_COUNT_MISMATCH');
  return records.map(record => Object.fromEntries(headers.map((header, index) => [header, record[index]])));
}

const manifest = parseCsv(await readFile(join(registry, 'resource_manifest.csv'), 'utf8'));
const files = (await readdir(registry)).filter(name => /^source-review-batch-\d{3}-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
const batches = await Promise.all(files.map(async name => JSON.parse(await readFile(join(registry, name), 'utf8'))));
const manifestById = new Map(manifest.map(row => [row.id, row]));
const reviewed = new Map();
const defects = [];
const statusCounts = {};
const decisionCounts = {};

for (const batch of batches) {
  if (!Array.isArray(batch.sources)) { defects.push(`${batch.batchId}: sources array missing`); continue; }
  for (const source of batch.sources) {
    const label = `${batch.batchId}/${source.id ?? 'NO_ID'}`;
    const expected = manifestById.get(source.id);
    if (!expected) defects.push(`${label}: ID not in manifest`);
    else if (expected.url !== source.url) defects.push(`${label}: URL differs from manifest`);
    else {
      const expectedReviewStatus = expected.review_status === 'PARTIAL_REVIEW' ? 'PARTIAL_REVIEW' : 'CATALOG_TRIAGE';
      if (source.status !== expectedReviewStatus) defects.push(`${label}: batch status ${source.status} differs from manifest-derived ${expectedReviewStatus}`);
    }
    if (reviewed.has(source.id)) defects.push(`${label}: duplicate source review (also ${reviewed.get(source.id)})`);
    reviewed.set(source.id, batch.batchId);
    statusCounts[source.status ?? 'MISSING'] = (statusCounts[source.status ?? 'MISSING'] ?? 0) + 1;
    decisionCounts[source.decision ?? 'MISSING'] = (decisionCounts[source.decision ?? 'MISSING'] ?? 0) + 1;
    if (!Array.isArray(source.provenance) || source.provenance.length === 0) defects.push(`${label}: provenance missing`);
    if (!Array.isArray(source.discoveries) || source.discoveries.length === 0 || source.discoveries.length > 3) defects.push(`${label}: discoveries must contain 1–3 entries`);
    if (!Array.isArray(source.patterns) || source.patterns.length === 0) defects.push(`${label}: useful patterns missing`);
    if (!Array.isArray(source.sylphModules) || source.sylphModules.length === 0) defects.push(`${label}: SYLPH relevance missing`);
    if (!source.overlap) defects.push(`${label}: overlap missing`);
    if (!Array.isArray(source.risks) || source.risks.length === 0) defects.push(`${label}: risks missing`);
    if (!Array.isArray(source.validation) || source.validation.length === 0) defects.push(`${label}: validation requirements missing`);
    if (!Array.isArray(source.evidence) || source.evidence.length === 0) defects.push(`${label}: evidence links missing`);
    if (!source.license) defects.push(`${label}: license status missing`);
    if (!source.decision) defects.push(`${label}: decision missing`);
  }
}

for (const row of manifest) if (!reviewed.has(row.id)) defects.push(`${row.id}: no batch review`);
for (const id of reviewed.keys()) if (!manifestById.has(id)) defects.push(`${id}: reviewed ID not in manifest`);

const decisionCountsSummary = Object.entries(decisionCounts)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
const report = {
  generatedAt: new Date().toISOString(),
  manifestRows: manifest.length,
  uniqueManifestIds: manifestById.size,
  batchFiles: files.length,
  catalogRecords: reviewed.size,
  uniqueCatalogIds: reviewed.size,
  directlyReviewedRecords: manifest.filter(row => row.review_status === 'PARTIAL_REVIEW').length,
  triageOnlyRecords: manifest.filter(row => row.review_status !== 'PARTIAL_REVIEW').length,
  manifestReviewStatusCounts: manifest.reduce((counts, row) => ({ ...counts, [row.review_status]: (counts[row.review_status] ?? 0) + 1 }), {}),
  batchStatusCounts: statusCounts,
  distinctDecisionCount: decisionCountsSummary.length,
  topDecisionCounts: decisionCountsSummary.slice(0, 12).map(([decision, count]) => ({ decision, count })),
  defectCount: defects.length,
  defects,
  interpretation: 'Coverage validates catalog record structure and manifest identity. PARTIAL_REVIEW means pinned source/document inspection was performed; CATALOG_TRIAGE is not direct source review. Neither status establishes exhaustive upstream inspection, current source availability, runtime integration, API authorization, profitability, or REA execution.',
};

const output = join(registry, 'source-review-validation-latest.json');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, output }, null, 2));
if (defects.length) process.exitCode = 1;
