import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = join(root, 'research', 'registry');
const inputPath = join(registry, 'resource_manifest.csv');
const outputPath = join(registry, 'source-url-availability-latest.json');
const concurrency = 6;
const timeoutMs = 8_000;

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

async function request(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, redirect: 'follow', signal: controller.signal });
    return { status: response.status, finalUrl: response.url, method };
  } finally {
    clearTimeout(timer);
  }
}

async function inspect(row) {
  const checkedAt = new Date().toISOString();
  try {
    let response = await request(row.url, 'HEAD');
    if ([405, 501].includes(response.status)) response = await request(row.url, 'GET');
    const status = response.status >= 200 && response.status < 400
      ? 'REACHABLE'
      : [401, 403].includes(response.status)
        ? 'REACHABLE_RESTRICTED'
        : [404, 410].includes(response.status)
          ? 'NOT_FOUND'
          : response.status === 429 || response.status >= 500
            ? 'INCONCLUSIVE_REMOTE'
            : 'HTTP_ERROR';
    return { id: row.id, category: row.category, url: row.url, checkedAt, method: response.method, httpStatus: response.status, finalUrl: response.finalUrl, status };
  } catch (error) {
    return {
      id: row.id,
      category: row.category,
      url: row.url,
      checkedAt,
      status: 'INCONCLUSIVE_NETWORK',
      errorCode: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.cause?.code ?? error?.name ?? 'FETCH_ERROR').slice(0, 80),
    };
  }
}

const sources = parseCsv(await readFile(inputPath, 'utf8'));
if (sources.length !== 288 || new Set(sources.map(source => source.id)).size !== 288) {
  throw new Error(`EXPECTED_288_UNIQUE_SOURCES_GOT_${sources.length}`);
}
for (const source of sources) {
  const parsed = new URL(source.url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(`UNSUPPORTED_URL_SCHEME_${source.id}`);
}

const results = [];
for (let offset = 0; offset < sources.length; offset += concurrency) {
  const batch = sources.slice(offset, offset + concurrency);
  results.push(...await Promise.all(batch.map(inspect)));
  const counts = Object.fromEntries(results.reduce((map, item) => map.set(item.status, (map.get(item.status) ?? 0) + 1), new Map()));
  const report = {
    generatedAt: new Date().toISOString(),
    manifestRows: sources.length,
    checkedRows: results.length,
    uniqueCheckedIds: new Set(results.map(item => item.id)).size,
    methodology: 'Unauthenticated HEAD requests with redirect following; GET fallback only for HTTP 405/501. Availability checks establish only endpoint reachability at observation time, not source correctness, safety, license, maintenance, or API authorization.',
    statusCounts: counts,
    sources: results,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ checkedRows: report.checkedRows, total: report.manifestRows, statusCounts: counts }));
}
