/** Legacy command name retained for a read-only audit. Never rewrites or labels rows. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function harmonizeCsv(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('An explicit input CSV path is required. This command is read-only.');
  }
  const source = path.resolve(filePath);
  const bytes = fs.readFileSync(source);
  return {
    source,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    processAssessment: 'UNKNOWN',
    note: 'No process evidence is verified by this audit. Source bytes and labels are unchanged.',
  };
}

// Importing the module performs no reads or writes; CLI requires exactly one path.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/harmonize-pavlov-attributions.mjs <input.csv> (read-only)');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(harmonizeCsv(process.argv[2]), null, 2));
  }
}
