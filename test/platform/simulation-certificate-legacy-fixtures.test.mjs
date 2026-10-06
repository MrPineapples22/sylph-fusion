import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const fixtureDir = new URL('../fixtures/', import.meta.url);
const distRoot = process.env.RUNTIME_ROOT_SCHEMA_TEST_DIST;
const moduleUrl = distRoot
  ? pathToFileURL(join(distRoot, 'platform', 'simulation', 'simulation-certificate.js')).href
  : new URL('../../dist/platform/simulation/simulation-certificate.js', import.meta.url).href;
const oracleUrl = new URL('../oracles/pre-2.2/platform/simulation/simulation-certificate.js', import.meta.url);
const { verifySimulationCertificate } = await import(moduleUrl);
const { verifySimulationCertificate: verifyWithFrozenOracle } = await import(oracleUrl);

function loadFixture(name) {
  const text = readFileSync(new URL(name, fixtureDir), 'utf8');
  return JSON.parse(text, (_key, value) => {
    if (value && typeof value === 'object' && Object.keys(value).length === 1 &&
        typeof value.$bigint === 'string' && /^\d+$/.test(value.$bigint)) return BigInt(value.$bigint);
    return value;
  });
}

function computeEvidenceHash(certificate) {
  const { evidenceHash: _ignored, ...preimage } = certificate;
  function encode(value) {
    if (value === null) return 'null;';
    if (value === undefined) return 'undefined;';
    if (typeof value === 'string') return `string:${JSON.stringify(value)};`;
    if (typeof value === 'boolean') return value ? 'boolean:true;' : 'boolean:false;';
    if (typeof value === 'number') return `number:${JSON.stringify(value)};`;
    if (typeof value === 'bigint') return `bigint:${JSON.stringify(value.toString())};`;
    if (Array.isArray(value)) return `array:${value.map(encode).join('')}end-array;`;
    return `object:{${Object.keys(value).sort().map(key => `${encode(key)}${encode(value[key])}`).join('')}}end-object;`;
  }
  return createHash('sha256').update('SYLPH_SIMULATION_CERTIFICATE\0v2\0').update(encode(preimage)).digest('hex');
}

test('frozen local pre-2.2 certificate fixtures retain their candidate hash and verifier result', () => {
  const manifest = JSON.parse(readFileSync(new URL('simulation-certificate-local-v2-manifest.json', fixtureDir), 'utf8'));
  const oracleBytes = readFileSync(oracleUrl);
  assert.equal(createHash('sha256').update(oracleBytes).digest('hex').toUpperCase(), manifest.provenance.compiledVerifierSha256);
  for (const [schema, file] of Object.entries(manifest.fixtures)) {
    const fixture = loadFixture(file.path);
    assert.equal(fixture.schemaVersion, schema);
    assert.equal(fixture.evidenceHash, file.evidenceHash);
    assert.equal(computeEvidenceHash(fixture), file.evidenceHash);
    assert.equal(verifyWithFrozenOracle(fixture), true);
    assert.equal(verifySimulationCertificate(fixture), true);
  }
});

test('legacy schema/status/trace fields and rehashed tampering stay rejected by frozen and candidate verifiers', () => {
  const cases = [
    ['2.0.0', certificate => { certificate.cpiTraceStatus = 'UNAVAILABLE'; }],
    ['2.0.0', certificate => { certificate.cpiTrace = { status: 'UNAVAILABLE' }; }],
    ['2.1.0', certificate => { delete certificate.cpiTraceStatus; }],
    ['2.1.0', certificate => { certificate.cpiTraceStatus = 'COMPLETE'; }],
    ['2.1.0', certificate => { certificate.cpiTraceStatus = 'STRUCTURALLY_VALID'; }],
    ['2.1.0', certificate => { certificate.schemaVersion = '2.2.0'; }],
  ];
  for (const [schema, mutate] of cases) {
    const certificate = loadFixture(schema === '2.0.0'
      ? 'simulation-certificate-local-v2.0.0.json'
      : 'simulation-certificate-local-v2.1.0.json');
    mutate(certificate);
    certificate.evidenceHash = computeEvidenceHash(certificate);
    assert.equal(verifyWithFrozenOracle(certificate), false, `${schema} oracle should reject mutation`);
    assert.equal(verifySimulationCertificate(certificate), false, `${schema} candidate should reject mutation`);
  }
  const tampered = loadFixture('simulation-certificate-local-v2.1.0.json');
  tampered.provider = 'changed-without-rehash';
  assert.equal(verifyWithFrozenOracle(tampered), false);
  assert.equal(verifySimulationCertificate(tampered), false);
});
