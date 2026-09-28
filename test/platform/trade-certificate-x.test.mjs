import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TokenCapabilityFirewallX as Token, ProgramIdentityFirewallX as Programs, AstraSigningFirewallX as Firewall } from '../../dist/platform/security/trade-certificate-x.js';
const sha = text => createHash('sha256').update(text).digest('hex');
const safeProperties = () => ({ freezeAuthority: null, mintAuthority: null, permanentDelegate: null, transferFeeBps: 0, isPaused: false });
const seal = certificate => { certificate.certificate_hash = Firewall.hashCertificate(certificate); return certificate; };
function fixture() {
  const frozenMessageBytes = Buffer.from('research-message');
  const messageHash = sha(frozenMessageBytes);
  const program = { programId: 'program', executableHash: sha('code'), codeEpoch: 1, isCertified: true };
  const programFirewall = new Programs();
  programFirewall.certifyProgram(program);
  const certificate = seal({
    fork_lineage: 'root->tip', root_watermark: 1000, evidence_quorum: true, snapshot_hash: sha('snapshot'),
    capability_epoch: Token.certifyCapabilityEpoch('mint', 1, safeProperties()), program_epochs: [program], parser_certification: true,
    opportunity_certificate: 'opportunity', multiplier_distribution: { p2x: .8, p5x: .6, p10x: .4, p20x: .2, p50x: .1, p100x: .05 },
    competing_risk_distribution: { dev_dump_hazard: .1, rug_hazard: .05 }, alpha_expiry: 20_000,
    quote_hash: sha('quote'), simulation_certificate: 'simulation', resource_envelope: { compute_limit: 200_000, priority_fee_micro_lamports: 10_000n },
    execution_deadline: 15_000, capital_lease: 'capital', risk_reservation: 'risk', settlement_reserve: .01,
    account_lease: 'account', execution_generation: 1, exitability_proof: Token.generateExitabilityProof('mint', 40, .5),
    intent_hash: sha('intent'), message_hash: messageHash, expires_at_slot: 1050,
  });
  return { frozenMessageBytes, messageHash, certificate, currentSlot: 1010, currentTimeMs: 10_000, expectedCapabilityEpoch: 1, expectedExecutionGeneration: 1, programFirewall };
}
function reject(input, reason) {
  const inspected = Firewall.inspectCertificate(input);
  assert.equal(inspected.isStructurallyValid, false);
  assert.equal(inspected.isAuthorized, false);
  if (reason) assert.match(inspected.rejectionReason, reason);
  const auth = Firewall.authorizeAndSign(input);
  assert.equal(auth.isAuthorized, false);
  assert.equal('signedMessageHash' in auth, false);
}

test('complete self-consistent research certificate never authorizes or claims a signature', () => {
  const input = fixture();
  assert.deepEqual(Firewall.inspectCertificate(input), { isStructurallyValid: true, isAuthorized: false });
  assert.match(Firewall.authorizeAndSign(input).rejectionReason, /LIVE_SIGNING_UNAVAILABLE/);
  assert.equal('signedMessageHash' in Firewall.authorizeAndSign(input), false);
});

test('missing, inherited or malformed authority evidence cannot mean revoked', () => {
  for (const key of ['freezeAuthority', 'mintAuthority', 'permanentDelegate', 'transferFeeBps', 'isPaused']) {
    const properties = safeProperties();
    delete properties[key];
    assert.throws(() => Token.certifyCapabilityEpoch('mint', 1, properties));
  }
  for (const value of [undefined, '', false, 0]) {
    assert.throws(() => Token.certifyCapabilityEpoch('mint', 1, { ...safeProperties(), permanentDelegate: value }));
  }
  assert.throws(() => Token.certifyCapabilityEpoch('mint', 1, Object.create(safeProperties())));
  for (const value of [-1, NaN, Infinity, .1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Token.certifyCapabilityEpoch('mint', value, safeProperties()));
  }
  const safe = Token.certifyCapabilityEpoch('mint', 1, safeProperties());
  const delegate = Token.certifyCapabilityEpoch('mint', 1, { ...safeProperties(), permanentDelegate: 'delegate' });
  assert.notEqual(safe.hash, delegate.hash);
  assert.equal(delegate.isPermanentDelegateRevoked, false);
  assert.ok(Object.isFrozen(safe));
});

test('exit estimates bind size, reject invalid quantities and round conservatively', () => {
  const safe = Token.generateExitabilityProof('mint', 50, .5);
  assert.equal(safe.maxExitImpactBps, 100);
  assert.equal(safe.isExitable, true);
  assert.equal(Token.generateExitabilityProof('mint', 50, 2.50001).isExitable, false);
  assert.notEqual(Token.generateExitabilityProof('mint', 50, .500001).hash, safe.hash);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => Token.generateExitabilityProof('mint', value, .5));
    assert.throws(() => Token.generateExitabilityProof('mint', 50, value));
  }
});

test('program registry snapshots input and rejects rollback, same-epoch drift and revoked reapproval', () => {
  const programs = new Programs();
  const original = { programId: 'program', executableHash: sha('code'), codeEpoch: 2, isCertified: true };
  programs.certifyProgram(original);
  original.executableHash = sha('mutated');
  assert.equal(programs.isProgramEpochCertified('program', sha('code'), 2), true);
  assert.throws(() => programs.certifyProgram({ ...original, codeEpoch: 1 }), /ROLLBACK/);
  assert.throws(() => programs.certifyProgram(original), /HASH_CONFLICT/);
  programs.certifyProgram({ ...original, executableHash: sha('code'), isCertified: false });
  assert.equal(programs.isProgramEpochCertified('program', sha('code'), 2), false);
  assert.throws(() => programs.certifyProgram({ ...original, executableHash: sha('code') }), /REVOKED/);
  for (const change of [{ executableHash: 'unverified-label' }, { codeEpoch: NaN }, { isCertified: 'true' }]) {
    assert.throws(() => programs.certifyProgram({ ...original, ...change }));
  }
});

test('message and full certificate digests bind bytes and all supplied fields', () => {
  const message = fixture(); message.frozenMessageBytes = Buffer.from('tampered'); reject(message, /MESSAGE_HASH_MISMATCH/);
  for (const key of ['capital_lease', 'account_lease', 'risk_reservation', 'intent_hash', 'quote_hash', 'snapshot_hash']) {
    const input = fixture(); input.certificate[key] = key.endsWith('hash') ? sha('different') : 'different';
    reject(input, /CERTIFICATE_HASH_MISMATCH/);
  }
  const input = fixture();
  const reversed = Object.fromEntries(Object.entries(input.certificate).reverse());
  assert.equal(Firewall.hashCertificate(reversed), input.certificate.certificate_hash);
});

test('malformed slots, time, generations and missing context reject rather than bypass comparisons', () => {
  for (const key of ['currentSlot', 'currentTimeMs', 'expectedCapabilityEpoch', 'expectedExecutionGeneration']) {
    for (const value of [undefined, NaN, Infinity, -1, 1.5]) {
      const input = fixture(); input[key] = value; reject(input, /INVALID_INSPECTION_CONTEXT/);
    }
  }
  const cases = [ ['root_watermark', 1011], ['root_watermark', -1], ['expires_at_slot', 1010], ['expires_at_slot', .5],
    ['execution_deadline', 10_000], ['execution_deadline', 20_001], ['alpha_expiry', 14_999], ['execution_generation', 2] ];
  for (const [key, value] of cases) {
    const input = fixture(); input.certificate[key] = value; seal(input.certificate); reject(input);
  }
});

test('rehashed malformed claims, missing reservations and unsafe resources still reject', () => {
  const cases = [
    c => { c.parser_certification = 'true'; }, c => { c.evidence_quorum = 1; },
    ...['capital_lease', 'risk_reservation', 'account_lease', 'opportunity_certificate', 'simulation_certificate', 'fork_lineage'].map(k => c => { c[k] = ' '; }),
    c => { c.settlement_reserve = 0; }, c => { c.settlement_reserve = -1; },
    c => { c.resource_envelope.compute_limit = 1.5; }, c => { c.resource_envelope.compute_limit = 0; },
    c => { c.resource_envelope.compute_limit = 1_400_001; },
    c => { c.resource_envelope.priority_fee_micro_lamports = -1n; },
    c => { c.resource_envelope.priority_fee_micro_lamports = 1; },
    c => { c.resource_envelope.priority_fee_micro_lamports = 18_446_744_073_709_551_616n; },
    c => { c.multiplier_distribution.p100x = .9; }, c => { c.multiplier_distribution.p2x = 1.1; },
    c => { c.competing_risk_distribution.rug_hazard = -1; }, c => { c.program_epochs = []; },
    c => { c.program_epochs.push({ ...c.program_epochs[0] }); },
  ];
  for (const mutate of cases) {
    const input = fixture(); mutate(input.certificate); seal(input.certificate); reject(input);
  }
});

test('capability hash, epochs and all authority flags checked after whole-certificate rehash', () => {
  for (const change of [{ isPermanentDelegateRevoked: false }, { epochIndex: 2 }, { hash: sha('forged') }]) {
    const input = fixture(); input.certificate.capability_epoch = { ...input.certificate.capability_epoch, ...change }; seal(input.certificate); reject(input);
  }
  for (const change of [{ freezeAuthority: 'authority' }, { mintAuthority: 'authority' }, { permanentDelegate: 'authority' }, { isPaused: true }, { transferFeeBps: 1 }]) {
    const input = fixture(); input.certificate.capability_epoch = Token.certifyCapabilityEpoch('mint', 1, { ...safeProperties(), ...change }); seal(input.certificate); reject(input, /UNSAFE_OR_UNSUPPORTED_CAPABILITY/);
  }
});

test('program revocation and epoch updates invalidate old certificate snapshots', () => {
  for (const change of [{ isCertified: false }, { codeEpoch: 2, executableHash: sha('upgrade') }]) {
    const input = fixture(); input.programFirewall.certifyProgram({ ...input.certificate.program_epochs[0], ...change }); reject(input, /PROGRAM_EPOCH_UNCERTIFIED/);
  }
});

test('exit proof mint, size, impact, digest and flag tampering rejected', () => {
  for (const change of [{ mint: 'other' }, { positionSizeSol: 1 }, { maxExitImpactBps: 0 }, { hash: sha('forged') }, { proofId: 'made-up' }, { isExitable: 'true' }]) {
    const input = fixture(); input.certificate.exitability_proof = { ...input.certificate.exitability_proof, ...change }; seal(input.certificate); reject(input);
  }
  const input = fixture(); input.certificate.exitability_proof = Token.generateExitabilityProof('mint', 1, .5); seal(input.certificate); reject(input, /INVALID_EXIT_PROOF/);
});

test('arbitrary runtime input fails closed without a signature-shaped result', () => {
  for (const value of [null, undefined, {}, [], 1, 'certificate']) reject(value);
  const input = fixture(); input.certificate.settlement_reserve = NaN; reject(input);
});

test('accessors are rejected before execution at every certificate and context boundary', () => {
  let getterCalls = 0;
  const accessor = value => ({ enumerable: true, configurable: true, get() { getterCalls++; return value; } });
  const cases = [
    input => Object.defineProperty(input, 'currentSlot', accessor(input.currentSlot)),
    input => Object.defineProperty(input, 'certificate', accessor(input.certificate)),
    input => Object.defineProperty(input.certificate, 'root_watermark', accessor(input.certificate.root_watermark)),
    input => Object.defineProperty(input.certificate.resource_envelope, 'compute_limit', accessor(200_000)),
    input => Object.defineProperty(input.certificate.program_epochs, '0', accessor(input.certificate.program_epochs[0])),
    input => Object.defineProperty(input.frozenMessageBytes, 'buffer', accessor(input.frozenMessageBytes.buffer)),
  ];
  for (const mutate of cases) {
    const input = fixture(); mutate(input); reject(input);
  }
  const c = fixture().certificate;
  Object.defineProperty(c, 'risk_reservation', accessor('risk'));
  assert.throws(() => Firewall.hashCertificate(c), /ACCESSOR_OR_HIDDEN_PROPERTY/);
  const properties = safeProperties(); Object.defineProperty(properties, 'permanentDelegate', accessor(null));
  assert.throws(() => Token.certifyCapabilityEpoch('mint', 1, properties), /ACCESSOR_OR_HIDDEN_PROPERTY/);
  const program = { programId: 'program', executableHash: sha('code'), codeEpoch: 1, isCertified: true };
  Object.defineProperty(program, 'isCertified', accessor(true));
  assert.throws(() => new Programs().certifyProgram(program), /ACCESSOR_OR_HIDDEN_PROPERTY/);
  assert.equal(getterCalls, 0);
});

test('proxies are rejected without executing any get, ownKeys or descriptor traps', () => {
  let trapCalls = 0;
  const traps = { get() { trapCalls++; throw Error('get trap'); }, ownKeys() { trapCalls++; throw Error('ownKeys trap'); }, getOwnPropertyDescriptor() { trapCalls++; throw Error('descriptor trap'); }, getPrototypeOf() { trapCalls++; throw Error('prototype trap'); } };
  reject(new Proxy(fixture(), traps));
  for (const key of ['certificate', 'programFirewall', 'frozenMessageBytes']) {
    const input = fixture(); input[key] = new Proxy(input[key], traps); reject(input);
  }
  for (const key of ['resource_envelope', 'program_epochs', 'capability_epoch', 'exitability_proof']) {
    const input = fixture(); input.certificate[key] = new Proxy(input.certificate[key], traps); reject(input);
    assert.throws(() => Firewall.hashCertificate(input.certificate), /UNSAFE_OBJECT/);
  }
  assert.throws(() => Firewall.hashCertificate(new Proxy(fixture().certificate, traps)), /UNSAFE_OBJECT/);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const input = fixture(); input.certificate = revoked.proxy; reject(input);
  assert.equal(trapCalls, 0);
});

test('shared message buffers, inherited data, sparse arrays and cycles cannot enter a hash snapshot', () => {
  const shared = fixture();
  shared.frozenMessageBytes = new Uint8Array(new SharedArrayBuffer(shared.frozenMessageBytes.length));
  reject(shared, /UNSAFE_MESSAGE_BUFFER/);
  const inherited = fixture(); inherited.certificate = Object.create(inherited.certificate); reject(inherited, /UNSAFE_OBJECT_PROTOTYPE/);
  const sparse = fixture(); sparse.certificate.program_epochs = new Array(1); reject(sparse, /SPARSE_OR_EXTENDED_ARRAY/);
  const cyclic = fixture(); cyclic.certificate.loop = cyclic.certificate; reject(cyclic, /CYCLIC_CERTIFICATE/);
  assert.throws(() => Firewall.hashCertificate(cyclic.certificate), /CYCLIC_CERTIFICATE/);
});

test('exported verification methods and prototypes cannot be monkey-patched', () => {
  assert.equal(Object.isFrozen(Token), true);
  assert.equal(Object.isFrozen(Token.prototype), true);
  assert.equal(Object.isFrozen(Programs), true);
  assert.equal(Object.isFrozen(Programs.prototype), true);
  assert.equal(Object.isFrozen(Firewall), true);
  assert.equal(Object.isFrozen(Firewall.prototype), true);
  assert.throws(() => { Firewall.hashCertificate = () => 'forged'; }, TypeError);
  assert.throws(() => { Programs.prototype.isProgramEpochCertified = () => true; }, TypeError);
  assert.equal(Firewall.inspectCertificate(fixture()).isStructurallyValid, true);
});

test('subclass overrides cannot replace certificate digest verification', () => {
  class ForgedFirewall extends Firewall {
    static hashCertificate(certificate) { return certificate.certificate_hash; }
  }
  const input = fixture();
  input.certificate.capital_lease = 'forged-after-seal';
  assert.equal(ForgedFirewall.inspectCertificate(input).isStructurallyValid, false);
  assert.equal(ForgedFirewall.inspectCertificate(input).isAuthorized, false);
});
