import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const statuses = new Set(['NOT_FOUND', 'STUB', 'PARTIAL', 'IMPLEMENTED_UNVERIFIED', 'CONNECTED_UNVERIFIED', 'VERIFIED', 'BLOCKED_EXTERNAL', 'OBSOLETE_SUPERSEDED']);
const scope = 'Structural evidence only: existing references and table consistency do not establish runtime connectivity, test success, or certification.';
const inside = (root, target) => { const rel = relative(root, target); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

// Split Markdown table cells without treating escaped pipes or code-span pipes as columns.
function cells(line) {
  const result = []; let cell = ''; let code = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cell += '|'; i++; }
    else if (ch === '`') { code = !code; cell += ch; }
    else if (ch === '|' && !code) { result.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  result.push(cell.trim());
  if (!result[0]) result.shift();
  if (!result.at(-1)) result.pop();
  return { values: result, unclosedCode: code };
}

function references(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map(match => match[1].trim().replace(/[.,;]+$/, ''))
    .filter(value => /(?:^|[\\/])(?:src|test|terminal)[\\/]/.test(value));
}

export async function auditEvidenceRegister({ root, text }) {
  const rootPath = await realpath(root);
  const errors = []; const rows = []; const counts = {}; const seen = new Set();
  let header = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim().startsWith('|')) continue;
    const parsed = cells(line); const values = parsed.values;
    if (values[0] === 'Requirement ID') { header = values; continue; }
    if (!/^REQ-/.test(values[0] ?? '')) continue;
    const id = values[0]; const lineNumber = index + 1;
    if (!header || parsed.unclosedCode || values.length !== header.length || !/^REQ-\d+$/.test(id)) {
      errors.push({ code: 'MALFORMED_ROW', id, line: lineNumber }); continue;
    }
    const statusIndex = header.indexOf('Status'); const testsIndex = header.indexOf('Tests');
    if (statusIndex < 0 || testsIndex < 0) { errors.push({ code: 'MALFORMED_HEADER', line: lineNumber }); continue; }
    const status = values[statusIndex];
    if (seen.has(id)) errors.push({ code: 'DUPLICATE_ID', id, line: lineNumber });
    seen.add(id); counts[status] = (counts[status] ?? 0) + 1;
    if (!statuses.has(status)) errors.push({ code: 'INVALID_STATUS', id, line: lineNumber, status });
    const paths = [...new Set(values.flatMap(references))];
    const testPaths = references(values[testsIndex]).filter(path => /^(?:test\/|terminal\/test\/)/.test(path.replaceAll('\\', '/')));
    if (status === 'VERIFIED' && !testPaths.length) errors.push({ code: 'VERIFIED_WITHOUT_TEST_REFERENCE', id, line: lineNumber });
    for (const path of paths) {
      const normalized = path.replaceAll('\\', '/');
      if (isAbsolute(path) || win32.isAbsolute(path) || !/^(src|test|terminal)\//.test(normalized) || normalized.split('/').includes('..')) {
        errors.push({ code: 'UNSAFE_REFERENCE', id, line: lineNumber, path }); continue;
      }
      try {
        const target = await realpath(resolve(rootPath, normalized));
        if (!inside(rootPath, target)) errors.push({ code: 'UNSAFE_REFERENCE', id, line: lineNumber, path });
        else if (!(await stat(target)).isFile()) errors.push({ code: 'REFERENCE_NOT_FILE', id, line: lineNumber, path });
      } catch (error) {
        errors.push({ code: error.code === 'ENOENT' ? 'MISSING_REFERENCE' : 'UNREADABLE_REFERENCE', id, line: lineNumber, path });
      }
    }
    rows.push({ id, line: lineNumber, status, references: paths });
  }
  if (!rows.length) errors.push({ code: 'NO_REQUIREMENTS' });
  return { scope, valid: errors.length === 0, requirementCount: rows.length, statusCounts: counts, uniqueReferenceCount: new Set(rows.flatMap(row => row.references)).size, errors, requirements: rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const text = await readFile(resolve(root, 'UPGRADES_REQUIREMENT_REGISTER.md'), 'utf8');
    const report = await auditEvidenceRegister({ root, text });
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ scope, valid: false, errors: [{ code: 'AUDIT_INPUT_UNAVAILABLE', reason: error.code ?? 'UNKNOWN' }] }, null, 2));
    process.exitCode = 1;
  }
}
