import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { AwsKmsEd25519 } from '../../dist/platform/signing/aws-kms-ed25519.js';
import { VaultSigner } from '../../dist/intelligence/vault/vault-signer.js';

const arn = 'arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555';
const pair = generateKeyPairSync('ed25519');
const wallet = new PublicKey(Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url')).toBase58();
const metadata = {
  KeyId: arn,
  KeySpec: 'ECC_NIST_EDWARDS25519',
  KeyUsage: 'SIGN_VERIFY',
  SigningAlgorithms: ['ED25519_SHA_512'],
  PublicKey: pair.publicKey.export({ format: 'der', type: 'spki' }),
};

function createMockTransport(onSign) {
  return {
    getPublicKey: async () => metadata,
    sign: async (input) => {
      if (onSign) onSign(input);
      assert.equal(input.KeyId, arn);
      assert.equal(input.MessageType, 'RAW');
      assert.equal(input.SigningAlgorithm, 'ED25519_SHA_512');
      return {
        KeyId: arn,
        SigningAlgorithm: 'ED25519_SHA_512',
        Signature: sign(null, input.Message, pair.privateKey),
      };
    },
  };
}

function createValidRequest(overrides = {}) {
  const effectSpec = {
    authorized_intent_id: 'intent_kms_1',
    intent_type: 'OPEN_POSITION',
    target_mint: 'MintToken11111111111111111111111111111111111',
    authorized_route: 'RaydiumLaunchpad',
    max_sol_debit: 1.0,
    min_tokens_credit: 1000n,
    allowed_signers: [wallet],
    authorized_pools: ['Pool111111111111111111111111111111111111111'],
    allowed_programs: ['RaydiumProgram111111111111111111111111111111'],
    valid_until_slot: 1000,
    max_fee_sol: 0.001,
    max_jito_tip_sol: 0.0001,
  };

  const manifest = {
    transaction_candidate_id: 'cand_kms_1',
    signers: [wallet],
    writable_accounts: [],
    programs: ['RaydiumProgram111111111111111111111111111111'],
    token_mints_involved: ['MintToken11111111111111111111111111111111111'],
    estimated_sol_debit: 1.0,
    estimated_sol_credit: 0,
    compute_unit_limit: 200_000,
    priority_fee_micro_lamports: 50_000,
    jito_tip_sol: 0.0001,
    creates_ata: false,
    transfers_authority: false,
    assigns_delegate: false,
    instructions: [],
    has_unknown_instructions: false,
  };

  const commitCertificate = {
    certificate_id: 'cert_kms_1',
    intent_id: 'intent_kms_1',
    reservation_id: 'res_kms_1',
    capital_state_root: 'cap_root_kms',
    survival_proof_root: 'surv_root_kms',
    control_epoch: 1,
    revocation_epoch: 1,
    production_root: 'sylph_production_root_sha256_v1',
    max_sol_debit: 1.0,
    max_fee_sol: 0.001,
    max_tip_sol: 0.0001,
    expiration_slot: 1000,
    commit_generation: 1,
    is_durable_committed: true,
    certificate_hash: 'cert_hash_kms_1',
  };

  return {
    request_id: 'req_kms_1',
    intent_id: 'intent_kms_1',
    capability: 'SIGN_ENTRY',
    effect_spec: effectSpec,
    manifest,
    commit_certificate: commitCertificate,
    active_control_epoch: 1,
    active_revocation_epoch: 1,
    production_root: 'sylph_production_root_sha256_v1',
    proof_lease_valid: true,
    serialized_tx_bytes: Uint8Array.from(Buffer.from('valid_serialized_solana_transaction_envelope_bytes')),
    ...overrides,
  };
}

test('KMS Bridge: VaultSigner exposes pinned hardware signer wallet', async () => {
  const kmsSigner = await AwsKmsEd25519.connect(createMockTransport(), arn, wallet);
  const vault = new VaultSigner({ hardwareSigner: kmsSigner, allowSimulation: false });

  assert.equal(vault.getPublicKey(), wallet);
});

test('KMS Bridge: Synchronous signing fails closed when hardware signer is bound', async () => {
  const kmsSigner = await AwsKmsEd25519.connect(createMockTransport(), arn, wallet);
  const vault = new VaultSigner({ hardwareSigner: kmsSigner, allowSimulation: false });

  const request = createValidRequest();
  const resp = vault.processSignatureRequest(request);

  assert.equal(resp.success, false);
  assert.equal(resp.signing_state, 'REJECTED');
  assert.match(resp.denial_reason || '', /ASYNC_SIGNER_REQUIRED/);
});

test('KMS Bridge: processSignatureRequestAsync validates assertions and signs via hardware KMS', async () => {
  let kmsSignCalled = 0;
  const kmsSigner = await AwsKmsEd25519.connect(createMockTransport(() => { kmsSignCalled++; }), arn, wallet);
  const vault = new VaultSigner({ hardwareSigner: kmsSigner, allowSimulation: false });

  const request = createValidRequest();
  const resp = await vault.processSignatureRequestAsync(request);

  assert.equal(resp.success, true);
  assert.equal(resp.signing_state, 'RELEASED');
  assert.equal(resp.simulation_only, false);
  assert.equal(kmsSignCalled, 1);
  assert.ok(resp.signature_base58);

  // Verify the signature against the actual keypair
  const decodedSig = bs58.decode(resp.signature_base58);
  assert.equal(decodedSig.length, 64);
  const isValid = verify(null, request.serialized_tx_bytes, pair.publicKey, decodedSig);
  assert.equal(isValid, true);

  // Check signed registry
  const record = vault.getSignedRecord(resp.sign_operation_id);
  assert.ok(record);
  assert.equal(record.state, 'RELEASED');
  assert.equal(record.signature, resp.signature_base58);
  assert.equal(vault.getSignedCount(), 1);
});

test('KMS Bridge: Assertion failure blocks signing before reaching KMS', async () => {
  let kmsSignCalled = 0;
  const kmsSigner = await AwsKmsEd25519.connect(createMockTransport(() => { kmsSignCalled++; }), arn, wallet);
  const vault = new VaultSigner({ hardwareSigner: kmsSigner, allowSimulation: false });

  // 1. Control epoch mismatch
  const badEpochReq = createValidRequest({ active_control_epoch: 99 });
  const respEpoch = await vault.processSignatureRequestAsync(badEpochReq);
  assert.equal(respEpoch.success, false);
  assert.match(respEpoch.denial_reason || '', /CONTROL_EPOCH_MISMATCH/);
  assert.equal(kmsSignCalled, 0);

  // 2. Spending limit exceeded
  const excessiveReq = createValidRequest({
    effect_spec: { ...createValidRequest().effect_spec, max_sol_debit: 50.0 },
  });
  const respExcess = await vault.processSignatureRequestAsync(excessiveReq);
  assert.equal(respExcess.success, false);
  assert.match(respExcess.denial_reason || '', /HARD_TX_LIMIT_EXCEEDED/);
  assert.equal(kmsSignCalled, 0);

  // 3. Uncommitted certificate
  const uncommittedReq = createValidRequest({
    commit_certificate: { ...createValidRequest().commit_certificate, is_durable_committed: false },
  });
  const respUncommit = await vault.processSignatureRequestAsync(uncommittedReq);
  assert.equal(respUncommit.success, false);
  assert.match(respUncommit.denial_reason || '', /NO_DURABLE_COMMIT/);
  assert.equal(kmsSignCalled, 0);
});

test('KMS Bridge: Revocation epoch bump quarantines signature', async () => {
  const kmsSigner = await AwsKmsEd25519.connect(createMockTransport(), arn, wallet);
  const vault = new VaultSigner({ hardwareSigner: kmsSigner, allowSimulation: false });

  // Bump revocation epoch to 2 in vault
  vault.setEpochs(1, 2);

  // Request specifies revocation epoch 1 -> must be rejected during precondition check
  const staleReq = createValidRequest({ active_revocation_epoch: 1 });
  const resp = await vault.processSignatureRequestAsync(staleReq);

  assert.equal(resp.success, false);
  assert.equal(resp.signing_state, 'REJECTED');
  assert.match(resp.denial_reason || '', /REVOCATION_EPOCH_MISMATCH/);
});
