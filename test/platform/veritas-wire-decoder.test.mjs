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
