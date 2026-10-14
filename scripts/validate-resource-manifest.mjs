import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--json-out');
const manifestArg = args.find((value, index) => value !== '--json-out' && index !== outputIndex + 1);
const manifestPath = path.resolve(manifestArg ?? path.join(root, 'research/registry/resource_manifest.csv'));
const outputPath = outputIndex >= 0
  ? path.resolve(args[outputIndex + 1])
  : undefined;

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(value => !(value.length === 1 && value[0] === ''));
}

const bytes = await readFile(manifestPath);
const raw = bytes.toString('utf8');
const [headers, ...values] = parseCsv(raw);
const expectedHeaders = ['id', 'category', 'url', 'default_method', 'priority', 'review_status', 'evidence_id', 'commit_or_capture_digest', 'license', 'decision'];
if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) throw new Error('RESOURCE_MANIFEST_HEADERS_INVALID');
const rows = values.map((cells, index) => {
  if (cells.length !== headers.length) throw new Error(`RESOURCE_MANIFEST_COLUMN_COUNT:${index + 2}`);
  return Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
});
const duplicate = field => rows.map(row => row[field]).filter((value, index, all) => all.indexOf(value) !== index);
const invalidUrls = rows.filter(row => {
  try { const url = new URL(row.url); return !['http:', 'https:'].includes(url.protocol); }
  catch { return true; }
});
const summary = {
  path: manifestPath,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  records: rows.length,
  uniqueIds: new Set(rows.map(row => row.id)).size,
  uniqueUrls: new Set(rows.map(row => row.url)).size,
  uniqueHosts: new Set(rows.map(row => new URL(row.url).host)).size,
  categories: Object.fromEntries([...new Set(rows.map(row => row.category))].sort().map(key => [key, rows.filter(row => row.category === key).length])),
  priorities: Object.fromEntries([...new Set(rows.map(row => row.priority))].sort().map(key => [key, rows.filter(row => row.priority === key).length])),
  reviewStatuses: Object.fromEntries([...new Set(rows.map(row => row.review_status))].sort().map(key => [key, rows.filter(row => row.review_status === key).length])),
  invalidUrls: invalidUrls.map(row => row.id),
  duplicateIds: [...new Set(duplicate('id'))],
  duplicateUrls: [...new Set(duplicate('url'))],
};
if (summary.records !== 288 || summary.uniqueIds !== 288 || summary.uniqueUrls !== 288 || invalidUrls.length || summary.duplicateIds.length || summary.duplicateUrls.length) {
  throw new Error(`RESOURCE_MANIFEST_VALIDATION_FAILED:${JSON.stringify(summary)}`);
}
if (outputPath) await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
