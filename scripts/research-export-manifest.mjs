import { createResearchExportManifest, verifyResearchExportManifest } from '../dist/platform/audit/research-export-manifest.js';

const [action, snapshotPath, manifestPath] = process.argv.slice(2);
if (!['create', 'verify'].includes(action) || !snapshotPath) {
  process.stderr.write('Usage: node scripts/research-export-manifest.mjs <create|verify> <snapshot.sqlite> [manifest.json]\n');
  process.exitCode = 2;
} else {
  try {
    const result = action === 'create'
      ? await createResearchExportManifest(snapshotPath, manifestPath)
      : await verifyResearchExportManifest(snapshotPath, manifestPath);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (action === 'verify' && !result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'RESEARCH_EXPORT_FAILED'}\n`);
    process.exitCode = 1;
  }
}
