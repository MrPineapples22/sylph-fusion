import { createResearchExportManifest, verifyResearchExportManifest } from '../dist/platform/audit/research-export-manifest.js';

const [action, snapshotPath, manifestPath] = process.argv.slice(2);
if (!['create', 'verify'].includes(action) || !snapshotPath) {
  process.stderr.write('Usage: node scripts/research-export-manifest.mjs <create|verify> <snapshot.sqlite> [manifest.json]\n');
  process.stderr.write('Optional env: SYLPH_RESEARCH_MANIFEST_SIGNING_KEY + SYLPH_RESEARCH_MANIFEST_SIGNER_ID for create; SYLPH_RESEARCH_MANIFEST_VERIFICATION_KEY for verify.\n');
  process.exitCode = 2;
} else {
  try {
    const signingKey = process.env.SYLPH_RESEARCH_MANIFEST_SIGNING_KEY;
    const signerId = process.env.SYLPH_RESEARCH_MANIFEST_SIGNER_ID;
    const witnessRootSha256 = process.env.SYLPH_RESEARCH_MANIFEST_WITNESS_ROOT_SHA256;
    const anchorReference = process.env.SYLPH_RESEARCH_MANIFEST_ANCHOR_REFERENCE;
    const createOptions = {
      ...(signingKey === undefined ? {} : { signingKey }),
      ...(signerId === undefined ? {} : { signerId }),
      ...(witnessRootSha256 === undefined && anchorReference === undefined ? {} : {
        externalAnchor: { witnessRootSha256, anchorReference },
      }),
    };
    const verifyOptions = process.env.SYLPH_RESEARCH_MANIFEST_VERIFICATION_KEY === undefined
      ? undefined
      : { verificationKey: process.env.SYLPH_RESEARCH_MANIFEST_VERIFICATION_KEY };
    const result = action === 'create'
      ? await createResearchExportManifest(snapshotPath, manifestPath, createOptions)
      : await verifyResearchExportManifest(snapshotPath, manifestPath, verifyOptions);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (action === 'verify' && !result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'RESEARCH_EXPORT_FAILED'}\n`);
    process.exitCode = 1;
  }
}
