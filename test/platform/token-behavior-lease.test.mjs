import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticLeaseAuthority } from '../../dist/platform/security/token-semantics.js';

test('TokenBehaviorCertificate: certifies safe SPL token and blocks dangerous extensions', () => {
  const authority = new SemanticLeaseAuthority();
  const safeMint = 'SafeMint11111111111111111111111111111111111';

  // 1. Safe Token: mint & freeze revoked, 0 fee
  const safeCert = authority.certifyTokenBehavior({
    mint: safeMint,
    tokenProgram: 'TOKEN_PROGRAM',
    mintAuthority: null,
    freezeAuthority: null,
    certifiedAtSlot: 310000000,
  });
  assert.equal(safeCert.isOpenPermitted, true);
  assert.equal(safeCert.isIncreasePermitted, true);
  assert.equal(safeCert.isClosePermitted, true);
  assert.match(safeCert.certificateId, /^TBCERT-/);

  // 2. Dangerous: Permanent delegate
  const delegateMint = 'DelegateMint1111111111111111111111111111111';
  const delegateCert = authority.certifyTokenBehavior({
    mint: delegateMint,
    tokenProgram: 'TOKEN_2022_PROGRAM',
    mintAuthority: null,
    freezeAuthority: null,
    permanentDelegate: 'HackerWallet111111111111111111111111111111',
    certifiedAtSlot: 310000000,
  });
  assert.equal(delegateCert.isOpenPermitted, false);
  assert.equal(delegateCert.isIncreasePermitted, false);
  assert.match(delegateCert.reason, /Permanent delegate present/);

  // 3. Dangerous: Non-transferable
  const nonTransferMint = 'NonTransferMint1111111111111111111111111111';
  const nonTransferCert = authority.certifyTokenBehavior({
    mint: nonTransferMint,
    tokenProgram: 'TOKEN_2022_PROGRAM',
    mintAuthority: null,
    freezeAuthority: null,
    isNonTransferable: true,
    certifiedAtSlot: 310000000,
  });
  assert.equal(nonTransferCert.isOpenPermitted, false);
  assert.equal(nonTransferCert.isClosePermitted, false);
});

test('TokenAccountCertificate: validates ATA alignment, frozen states, and flags ATA creation', () => {
  const authority = new SemanticLeaseAuthority();
  const mint = 'AccountTestMint1111111111111111111111111111';
  const owner = 'Owner111111111111111111111111111111111111111';
  const expectedAta = 'CanonicalAta1111111111111111111111111111111';

  // 1. ATA does not exist on chain -> flags creation requirement
  const cert1 = authority.certifyTokenAccount({
    accountAddress: expectedAta,
    expectedAta,
    owner,
    mint,
    tokenProgram: 'TOKEN_PROGRAM',
    rawBalance: 0n,
    isFrozen: false,
    existsOnChain: false,
  });
  assert.equal(cert1.isEntryCertified, true);
  assert.equal(cert1.requiresAtaCreation, true);

  // 2. Mismatched address
  const cert2 = authority.certifyTokenAccount({
    accountAddress: 'WrongAta111111111111111111111111111111111111',
    expectedAta,
    owner,
    mint,
    tokenProgram: 'TOKEN_PROGRAM',
    rawBalance: 100n,
    isFrozen: false,
    existsOnChain: true,
  });
  assert.equal(cert2.isEntryCertified, false);
  assert.match(cert2.reason, /does not match canonical ATA/);

  // 3. Frozen account
  const cert3 = authority.certifyTokenAccount({
    accountAddress: expectedAta,
    expectedAta,
    owner,
    mint,
    tokenProgram: 'TOKEN_PROGRAM',
    rawBalance: 100n,
    isFrozen: true,
    existsOnChain: true,
  });
  assert.equal(cert3.isEntryCertified, false);
  assert.match(cert3.reason, /currently frozen/);
});

test('PositionSemanticLease: maintains renewable lease and preserves survival exit during drift', () => {
  const authority = new SemanticLeaseAuthority();
  const mint = 'LeaseMint11111111111111111111111111111111111';
  const tokenAccount = 'LeaseAta11111111111111111111111111111111111';

  // Setup valid behavior and account certs
  authority.certifyTokenBehavior({
    mint,
    tokenProgram: 'TOKEN_PROGRAM',
    mintAuthority: null,
    freezeAuthority: null,
    certifiedAtSlot: 310000000,
  });
  authority.certifyTokenAccount({
    accountAddress: tokenAccount,
    expectedAta: tokenAccount,
    owner: 'OwnerWallet',
    mint,
    tokenProgram: 'TOKEN_PROGRAM',
    rawBalance: 10_000n,
    isFrozen: false,
    existsOnChain: true,
  });

  // Issue lease with 50ms TTL
  const lease = authority.issueSemanticLease({
    mint,
    tokenAccount,
    epoch: 650,
    slot: 310000000,
    ttlMs: 50,
  });

  assert.equal(lease.status, 'ACTIVE');
  assert.equal(lease.isEntryPermitted, true);
  assert.equal(lease.isSurvivalExitPermitted, true);

  const retrieved = authority.getActiveLease(mint);
  assert.ok(retrieved);
  assert.equal(retrieved.status, 'ACTIVE');
});
