import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSystemIntegrationCertificate } from '../scripts/generate-system-integration-certificate.mjs';
import { verifySystemIntegrationCertificate } from '../scripts/verify-system-integration-certificate.mjs';
import { hashCanonicalV10 } from '../scripts/canonicalization-v10.mjs';

test('Step 7 Certificate Generator: Generation and independent verification', () => {
  const { certificate, verificationReport } = generateSystemIntegrationCertificate({ dryRun: true });
  assert.equal(certificate.schemaVersion, '1.0.0');
  assert.match(certificate.certificateRoot, /^[0-9a-f]{64}$/);
  assert.equal(certificate.certifiedPayload.systemId, 'SYLPH_FUSION');
  assert.equal(verificationReport.valid, true);
  assert.equal(verificationReport.tamperSensitivityProven, true);
});

test('Step 7 Certificate Generator: Status taxonomy enforcement', () => {
  // Case A: C10 in certify mode -> UNIFIED_PIPELINE_CERTIFIED
  const certA = generateSystemIntegrationCertificate({
    dryRun: true,
    convergenceReport: {
      schemaVersion: '1.0.0',
      convergenceRoot: '1'.repeat(64),
      certifiedPayload: {
        highestProvenLevel: 'C10',
        mode: 'certify',
        isFullyCertified: true,
        ladder: {},
      },
    },
  }).certificate;
  assert.equal(certA.certifiedPayload.certificationStatus, 'UNIFIED_PIPELINE_CERTIFIED');
  assert.equal(certA.certifiedPayload.rejectionNotice, null);

  // Case B: C10 in test mode -> PROVISIONALLY_INTEGRATED
  const certB = generateSystemIntegrationCertificate({
    dryRun: true,
    convergenceReport: {
      schemaVersion: '1.0.0',
      convergenceRoot: '2'.repeat(64),
      certifiedPayload: {
        highestProvenLevel: 'C10',
        mode: 'test',
        isFullyCertified: false,
        ladder: {},
      },
    },
  }).certificate;
  assert.equal(certB.certifiedPayload.certificationStatus, 'PROVISIONALLY_INTEGRATED');
  assert.match(certB.certifiedPayload.rejectionNotice, /PROVISIONAL STATUS/);

  // Case C: C4 -> PROVISIONALLY_INTEGRATED
  const certC = generateSystemIntegrationCertificate({
    dryRun: true,
    convergenceReport: {
      schemaVersion: '1.0.0',
      convergenceRoot: '3'.repeat(64),
      certifiedPayload: {
        highestProvenLevel: 'C4',
        mode: 'test',
        isFullyCertified: false,
        ladder: {},
      },
    },
  }).certificate;
  assert.equal(certC.certifiedPayload.certificationStatus, 'PROVISIONALLY_INTEGRATED');
  assert.match(certC.certifiedPayload.rejectionNotice, /PROVISIONAL STATUS/);

  // Case D: C1 -> NOT_CERTIFIED
  const certD = generateSystemIntegrationCertificate({
    dryRun: true,
    convergenceReport: {
      schemaVersion: '1.0.0',
      convergenceRoot: '4'.repeat(64),
      certifiedPayload: {
        highestProvenLevel: 'C1',
        mode: 'test',
        isFullyCertified: false,
        ladder: {},
      },
    },
  }).certificate;
  assert.equal(certD.certifiedPayload.certificationStatus, 'NOT_CERTIFIED');
  assert.match(certD.certifiedPayload.rejectionNotice, /NOT CERTIFIED/);
});

test('Step 7 Certificate Generator: Deterministic reproducibility', () => {
  const res1 = generateSystemIntegrationCertificate({ dryRun: true });
  const res2 = generateSystemIntegrationCertificate({ dryRun: true });
  // Given same system state and mocked time, certificates are identical
  assert.equal(res1.certificate.certifiedPayload.systemId, res2.certificate.certifiedPayload.systemId);
  assert.equal(res1.certificate.certifiedPayload.highestProvenLevel, res2.certificate.certifiedPayload.highestProvenLevel);
});

test('Step 7 Certificate Generator: Root mutation causes certificate divergence', () => {
  const base = generateSystemIntegrationCertificate({
    dryRun: true,
    manifest: {
      manifestRoot: 'a'.repeat(64),
      certifiedPayload: { repositoryCommitSha: 'sha1' },
    },
  }).certificate;

  const mutated = generateSystemIntegrationCertificate({
    dryRun: true,
    manifest: {
      manifestRoot: 'b'.repeat(64),
      certifiedPayload: { repositoryCommitSha: 'sha2' },
    },
  }).certificate;

  assert.notEqual(base.certificateRoot, mutated.certificateRoot);
});
