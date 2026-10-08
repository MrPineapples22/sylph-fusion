import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySystemIntegrationCertificate } from '../scripts/verify-system-integration-certificate.mjs';
import { hashCanonicalV10, EMPTY_SHA256_HEX } from '../scripts/canonicalization-v10.mjs';

test('Step 4 Independent Verifier: Valid in-memory certificate passes', () => {
  const payload = {
    campaignId: 'campaign_alpha_001',
    commitSha: '373143a10d05327149cc5d3cbd0cfb44bff9cc18',
    status: 'TEST_PASSED',
  };
  const root = hashCanonicalV10(payload);
  const cert = {
    schemaVersion: '1.0.0',
    certificateRoot: root,
    certifiedPayload: payload,
  };

  const report = verifySystemIntegrationCertificate(cert);
  assert.equal(report.valid, true);
  assert.equal(report.certificateRoot, root);
  assert.equal(report.tamperSensitivityProven, true);
});

test('Step 4 Independent Verifier: Root mismatch fails closed', () => {
  const payload = { campaignId: 'campaign_alpha_001' };
  const cert = {
    schemaVersion: '1.0.0',
    certificateRoot: '0'.repeat(64),
    certifiedPayload: payload,
  };

  assert.throws(
    () => verifySystemIntegrationCertificate(cert),
    /CRYPTOGRAPHIC_INTEGRITY_FAILURE: Certificate root mismatch/
  );
});

test('Step 4 Independent Verifier: Mutated payload fails closed', () => {
  const payload = { campaignId: 'campaign_alpha_001', value: 100 };
  const root = hashCanonicalV10(payload);
  const cert = {
    schemaVersion: '1.0.0',
    certificateRoot: root,
    certifiedPayload: { ...payload, value: 101 }, // tampered value
  };

  assert.throws(
    () => verifySystemIntegrationCertificate(cert),
    /CRYPTOGRAPHIC_INTEGRITY_FAILURE/
  );
});

test('Step 4 Independent Verifier: Empty hash strictly rejected', () => {
  const cert = {
    schemaVersion: '1.0.0',
    certificateRoot: EMPTY_SHA256_HEX,
    certifiedPayload: {},
  };

  assert.throws(
    () => verifySystemIntegrationCertificate(cert),
    /CRYPTOGRAPHIC_INTEGRITY_FAILURE/
  );
});

test('Step 4 Independent Verifier: Malformed certificate schema fails closed', () => {
  assert.throws(
    () => verifySystemIntegrationCertificate({ certificateRoot: 'abc' }),
    /VERIFICATION_FAILURE: Missing schemaVersion/
  );
  assert.throws(
    () => verifySystemIntegrationCertificate({ schemaVersion: '1.0.0' }),
    /VERIFICATION_FAILURE: Missing certificateRoot/
  );
  assert.throws(
    () => verifySystemIntegrationCertificate({ schemaVersion: '1.0.0', certificateRoot: 'a'.repeat(64) }),
    /VERIFICATION_FAILURE: Missing certifiedPayload/
  );
});

test('Step 4 Independent Verifier: C4 integration certificate requires physical audit binding', () => {
  const payload = {
    systemId: 'SYLPH_FUSION',
    ladder: { C4: { awarded: true } },
    roots: {},
  };
  assert.throws(() => verifySystemIntegrationCertificate({
    schemaVersion: '1.0.0',
    certificateRoot: hashCanonicalV10(payload),
    certifiedPayload: payload,
  }), /missing a valid physical authority audit root/);
});

test('Step 4 Independent Verifier: Non-existent file path fails closed', () => {
  assert.throws(
    () => verifySystemIntegrationCertificate('non/existent/path/to/cert.json'),
    /CERTIFICATE_NOT_FOUND/
  );
});
