import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TransactionMessage,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { VeritasWireDecoder } from '../../dist/platform/signing/veritas-wire-decoder.js';
import { SigningFirewall } from '../../dist/platform/signing/signing-firewall.js';

const payer = new PublicKey('11111111111111111111111111111111');
const recipient = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const blockhash = 'GHtXQBsoZHVnNFa9YevAzFr1KkWKEpppzU6hiHjJxgjg';

function v1Message({ configMask = 0b1_1111, trailing = Buffer.alloc(0), programIndex = 2 } = {}) {
  const config = Buffer.concat([
    Buffer.from([0x57, 0x04, 0, 0, 0, 0, 0, 0]), // 1111 lamports priority fee
    Buffer.from([0x40, 0x0d, 0x03, 0]), // 200,000 CU
    Buffer.from([0, 0, 1, 0]), // 65,536 loaded-account data bytes
    Buffer.from([0, 0x80, 0, 0]), // 32,768-byte heap
  ]);
  const instructions = Buffer.concat([
    Buffer.from([programIndex, 2, 12, 0]), // program index, account count, data length
    Buffer.from([0, 1]), // payer and recipient account indexes
    Buffer.from([2, 0, 0, 0, 0x40, 0x4b, 0x4c, 0, 0, 0, 0, 0]), // System transfer 5,000,000 lamports
  ]);
  const mask = Buffer.alloc(4); mask.writeUInt32LE(configMask);
  const keys = Buffer.concat([payer.toBuffer(), recipient.toBuffer(), SystemProgram.programId.toBuffer()]);
  const fixed = Buffer.concat([
    Buffer.from([0x81, 1, 0, 1]), // version, one writable signer, one readonly unsigned key
    mask,
    new PublicKey(blockhash).toBuffer(),
    Buffer.from([1, 3]), // one instruction, three inline addresses
    keys,
  ]);
  return new Uint8Array(Buffer.concat([fixed, config, instructions, trailing]));
}

test('VeritasWireDecoder: decodes V1 message config fees but keeps the message signing-incomplete', () => {
  const bytes = v1Message();
  const view = VeritasWireDecoder.decode(bytes, { simulationId: 'v1-observation' });
  assert.equal(view.version, 1);
  assert.equal(view.priorityFeeLamports, 1111n);
  assert.equal(view.computeUnitLimit, 200_000);
  assert.equal(view.loadedAccountsDataSizeLimit, 65_536);
  assert.equal(view.requestedHeapSize, 32_768);
  assert.equal(view.computeUnitPriceMicroLamports, undefined);
  assert.equal(view.feePayer, payer.toBase58());
  assert.equal(view.recentBlockhash, blockhash);
  assert.equal(view.complete, false);
  assert.equal(view.instructions[0].instructionType, 'UNKNOWN');
});

test('VeritasWireDecoder: reads an SDK-serialized v1 fixture from Solana Foundation examples', () => {
  // Generated offline with @solana/kit 8.4.0 at upstream commit
  // solana-foundation/transaction-v1-examples baa8b2654d1695d62c17dd8a0d2ef775ef45ad14.
  const bytes = Buffer.from(
    '810100011f00000000000000000000000000000000000000000000000000000000000000000000000103321cfa5add185e8893a5fd88013ec4d7e122ded46354cadff50d956395e75b607e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f200000000000000000000000000000000000000000000000000000000000000005704000000000000400d0300000001000080000002020c00000102000000404b4c0000000000',
    'hex',
  );
  const view = VeritasWireDecoder.decode(bytes);
  assert.equal(view.version, 1);
  assert.equal(view.feePayer, '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T');
  assert.equal(view.recentBlockhash, '11111111111111111111111111111111');
  assert.equal(view.priorityFeeLamports, 1111n);
  assert.equal(view.computeUnitLimit, 200_000);
  assert.equal(view.loadedAccountsDataSizeLimit, 65_536);
  assert.equal(view.requestedHeapSize, 32_768);
  assert.equal(view.complete, false);
});

test('VeritasWireDecoder: rejects malformed V1 config masks and trailing wire bytes', () => {
  assert.throws(() => VeritasWireDecoder.decode(v1Message({ configMask: 1 })), /priority fee mask must set both bits/);
  assert.throws(() => VeritasWireDecoder.decode(v1Message({ configMask: 0x8000_0000 })), /config mask contains unknown bits/);
  assert.throws(() => VeritasWireDecoder.decode(v1Message({ trailing: Buffer.from([0]) })), /message contains trailing bytes/);
  assert.throws(() => VeritasWireDecoder.decode(Uint8Array.of(0x81)), /V1 message is truncated/);
});

test('SigningFirewall: decoded V1 message remains rejected until its effects are authority-complete', () => {
  const firewall = new SigningFirewall();
  const messageBytes = v1Message();
  const messageHash = createHash('sha256').update(messageBytes).digest('hex');
  const decision = firewall.evaluate({
    requestId: 'req_v1_observation', environment: 'devnet', messageBytes, messageHash,
    expectedSigner: payer.toBase58(), feePayer: payer.toBase58(), policyVersion: 'v1', policyHash: 'hash_v1',
    intentId: 'intent_v1', simulationId: 'v1-observation', expiresAt: Date.now() + 60_000,
  }, null, {
    version: 'v1', hash: 'hash_v1', allowedPrograms: [SystemProgram.programId.toBase58()],
    allowedFeePayers: [payer.toBase58()], maxAmountLamports: 10_000_000n, maxSlippageBps: 0,
    maxPriorityFeeLamports: 10_000n, expectedMint: '', expectedDestination: '', mainnetEnabled: false,
  }, { journalHealthy: true, killSwitchClear: true, providerGateHealthy: true, simulationPassed: true });
  assert.equal(decision.approved, false);
  assert.ok(decision.reasonCodes.includes('TRANSACTION_DECODER_INCOMPLETE'));
});

test('VeritasWireDecoder: natively deserializes compiled VersionedMessage wire bytes', () => {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: 5_000_000n }),
    ],
  }).compileToV0Message();

  const bytes = message.serialize();
  const view = VeritasWireDecoder.decode(bytes, {
    expectedDestination: recipient.toBase58(),
  });

  assert.equal(view.complete, true);
  assert.equal(view.version, 0);
  assert.equal(view.feePayer, payer.toBase58());
  assert.equal(view.signer, payer.toBase58());
  assert.equal(view.amountLamports, 5_000_000n);
  assert.equal(view.destination, recipient.toBase58());
  assert.equal(view.computeUnitLimit, 250_000);
  assert.equal(view.computeUnitPriceMicroLamports, 10_000n);
  assert.equal(view.messageHash, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(view.programIds.includes(SystemProgram.programId.toBase58()));
  assert.ok(view.programIds.includes(ComputeBudgetProgram.programId.toBase58()));
});

test('SigningFirewall: auto-decodes from raw messageBytes when decoded parameter is null', () => {
  const firewall = new SigningFirewall();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: 1_000_000n }),
    ],
  }).compileToV0Message();

  const messageBytes = message.serialize();
  const messageHash = createHash('sha256').update(messageBytes).digest('hex');

  const request = {
    requestId: 'req_auto_1',
    environment: 'devnet',
    messageBytes,
    messageHash,
    expectedSigner: payer.toBase58(),
    feePayer: payer.toBase58(),
    policyVersion: 'v1',
    policyHash: 'hash_1',
    intentId: 'intent_1',
    simulationId: 'sim_1',
    expiresAt: Date.now() + 60_000,
  };

  const policy = {
    version: 'v1',
    hash: 'hash_1',
    allowedPrograms: [SystemProgram.programId.toBase58(), ComputeBudgetProgram.programId.toBase58()],
    allowedFeePayers: [payer.toBase58()],
    maxAmountLamports: 10_000_000n,
    maxSlippageBps: 500,
    maxPriorityFeeLamports: 100_000n,
    expectedMint: '',
    expectedDestination: recipient.toBase58(),
    mainnetEnabled: false,
  };

  const gates = {
    journalHealthy: true,
    killSwitchClear: true,
    providerGateHealthy: true,
    simulationPassed: true,
  };

  // Pass decoded = null; SigningFirewall must auto-decode natively from messageBytes
  const decision = firewall.evaluate(request, null, policy, gates);
  assert.equal(decision.approved, true, `Expected approval but got: ${JSON.stringify(decision)}`);
  assert.equal(decision.messageHash, messageHash);
});

test('SigningFirewall: rejects when caller manifest attempts to spoof fee payer', () => {
  const firewall = new SigningFirewall();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: 1_000_000n }),
    ],
  }).compileToV0Message();

  const messageBytes = message.serialize();
  const messageHash = createHash('sha256').update(messageBytes).digest('hex');

  const request = {
    requestId: 'req_spoof_1',
    environment: 'devnet',
    messageBytes,
    messageHash,
    expectedSigner: payer.toBase58(),
    feePayer: payer.toBase58(),
    policyVersion: 'v1',
    policyHash: 'hash_1',
    intentId: 'intent_1',
    simulationId: 'sim_1',
    expiresAt: Date.now() + 60_000,
  };

  // Spoofed decoded view claiming fee payer is recipient
  const spoofedDecoded = {
    complete: true,
    frozen: true,
    messageHash,
    signer: payer.toBase58(),
    feePayer: recipient.toBase58(), // Spoofed!
    programIds: [SystemProgram.programId.toBase58()],
    writableAccounts: [payer.toBase58(), recipient.toBase58()],
    amountLamports: 1_000_000n,
    mint: '',
    destination: recipient.toBase58(),
    maxSlippageBps: 100,
    priorityFeeLamports: 0n,
    simulationId: 'sim_1',
  };

  const policy = {
    version: 'v1',
    hash: 'hash_1',
    allowedPrograms: [SystemProgram.programId.toBase58()],
    allowedFeePayers: [payer.toBase58(), recipient.toBase58()],
    maxAmountLamports: 10_000_000n,
    maxSlippageBps: 500,
    maxPriorityFeeLamports: 100_000n,
    expectedMint: '',
    expectedDestination: recipient.toBase58(),
    mainnetEnabled: false,
  };

  const gates = {
    journalHealthy: true,
    killSwitchClear: true,
    providerGateHealthy: true,
    simulationPassed: true,
  };

  const decision = firewall.evaluate(request, spoofedDecoded, policy, gates);
  assert.equal(decision.approved, false);
  assert.ok(decision.reasonCodes.includes('CALLER_MANIFEST_SPOOF_DETECTED'));
});
