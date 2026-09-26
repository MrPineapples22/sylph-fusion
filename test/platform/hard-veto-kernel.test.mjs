import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HardRuleRegistry, TokenSafetyAuthority } from '../../dist/platform/security/hard-veto-kernel.js';

const subject = { kind: 'TOKEN_MINT', clusterGenesisHash: 'cluster-a', mint: 'mint-a' };
const canonicalBank = { clusterGenesisHash: 'cluster-a', slot: 42n, blockhash: 'block-42', commitment: 'finalized', canonicality: 'CANONICAL' };
const rule = { ruleId: 'freeze-authority-present', subjectKind: 'TOKEN_MINT', requiredFact: 'FREEZE_AUTHORITY', violation: 'AUTHORITY_PRESENT', registryEpoch: 'registry-1' };
const root = (state, changes = {}) => ({ evidenceId: 'root-1', subject, bank: canonicalBank, rawBytesHash: 'raw', decoderId: 'reference-decoder', decoderHash: 'decoder', fact: 'FREEZE_AUTHORITY', state, ...changes });
const authority = () => { const registry = new HardRuleRegistry(); registry.register(rule); return new TokenSafetyAuthority(registry); };

test('only a registered, canonical, subject-bound proven authority can issue a proof', () => {
  const result = authority().evaluate(subject, rule.ruleId, [root({ kind: 'PRESENT', authority: 'freeze-key' })]);
  assert.equal(result.tokenSafety, 'FAIL');
  assert.equal(result.proof.subject.mint, subject.mint);
  assert.equal(result.proof.status, 'ACTIVE');
  assert.ok(result.proof.proofHash);
});

test('missing, conflicting, noncanonical, or cross-mint evidence never becomes VETO proof', () => {
  assert.equal(authority().evaluate(subject, rule.ruleId, []).tokenSafety, 'UNKNOWN');
  assert.equal(authority().evaluate(subject, rule.ruleId, [root({ kind: 'CONFLICTED', candidates: ['a', 'b'] })]).tokenSafety, 'CONFLICTED');
  assert.equal(authority().evaluate(subject, rule.ruleId, [root({ kind: 'PRESENT', authority: 'a' }, { bank: { ...canonicalBank, canonicality: 'ORPHANED' } })]).tokenSafety, 'UNKNOWN');
  assert.equal(authority().evaluate(subject, rule.ruleId, [root({ kind: 'PRESENT', authority: 'a' }, { subject: { ...subject, mint: 'mint-b' } })]).tokenSafety, 'CONFLICTED');
});

test('unregistered rules cannot manufacture a token-safety failure', () => {
  assert.equal(authority().evaluate(subject, 'not-registered', [root({ kind: 'PRESENT', authority: 'a' })]).tokenSafety, 'UNKNOWN');
});
