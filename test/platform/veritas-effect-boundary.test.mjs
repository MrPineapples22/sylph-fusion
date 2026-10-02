import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionMessage, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { VeritasWireDecoder } from '../../dist/platform/signing/veritas-wire-decoder.js';
import { SigningFirewall } from '../../dist/platform/signing/signing-firewall.js';
const payer = new PublicKey('11111111111111111111111111111111');
const recipient = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const other = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const transfer = to => SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: 10n });
function bytes(instructions, legacy = false) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: payer.toBase58(), instructions });
  return (legacy ? message.compileToLegacyMessage() : message.compileToV0Message()).serialize();
}
function evaluate(messageBytes, overrides = {}, manifest = null) {
  const request = { requestId: 'test', environment: 'devnet', messageBytes,
    messageHash: createHash('sha256').update(messageBytes).digest('hex'), expectedSigner: payer.toBase58(),
    feePayer: payer.toBase58(), policyVersion: '1', policyHash: 'p', intentId: 'i', simulationId: 'sim', expiresAt: 200 };
  const policy = { version: '1', hash: 'p', allowedPrograms: [SystemProgram.programId.toBase58(), ComputeBudgetProgram.programId.toBase58()],
    allowedFeePayers: [payer.toBase58()], maxAmountLamports: 100n, maxSlippageBps: 100,
    maxPriorityFeeLamports: 5000n, expectedMint: '', expectedDestination: recipient.toBase58(), mainnetEnabled: false, ...overrides };
  return new SigningFirewall().evaluate(request, manifest, policy,
    { journalHealthy: true, killSwitchClear: true, providerGateHealthy: true, simulationPassed: true }, 100);
}
test('policy destination and mint cannot be substituted for observed transfer facts', () => {
  const raw = bytes([transfer(other)]);
  const view = VeritasWireDecoder.decode(raw, { expectedDestination: recipient.toBase58(), expectedMint: other.toBase58(), maxSlippageBps: 999 });
  assert.equal(view.destination, other.toBase58()); assert.equal(view.mint, ''); assert.equal(view.maxSlippageBps, 0);
  assert.equal(evaluate(raw).approved, false);
  assert.equal(evaluate(bytes([transfer(recipient)]), { expectedMint: other.toBase58() }).approved, false);
});
test('unknown Jupiter instruction denies even with allowed program and forged complete manifest', () => {
  const jupiter = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  const raw = bytes([new TransactionInstruction({ programId: jupiter, keys: [], data: Buffer.from([255]) })]);
  const native = VeritasWireDecoder.decode(raw, { simulationId: 'sim' });
  assert.equal(native.complete, false);
  assert.equal(evaluate(raw, { allowedPrograms: [jupiter.toBase58()] }).approved, false);
  assert.equal(evaluate(raw, { allowedPrograms: [jupiter.toBase58()] }, { ...native, complete: true }).approved, false);
});
test('SDK 2.0.0 Pump V2 buy and sell remain explicitly unsupported, not zero-cost complete', async () => {
  for (const builder of ['getBuyV2InstructionRaw', 'getSellV2InstructionRaw']) {
    const ix = await PUMP_SDK[builder]({ user: payer, mint: recipient, creator: other,
      amount: new BN(1), quoteAmount: new BN(1000), feeRecipient: recipient, buybackFeeRecipient: other });
    assert.ok(ix.keys.length >= 26);
    const raw = bytes([ix]);
    const native = VeritasWireDecoder.decode(raw);
    assert.equal(native.complete, false);
    assert.equal(evaluate(raw, { allowedPrograms: [ix.programId.toBase58()] }).approved, false);
  }
});
test('native decoding is mandatory and caller amount/destination/program claims never authorize', () => {
  const raw = bytes([transfer(recipient)]), native = VeritasWireDecoder.decode(raw, { simulationId: 'sim' });
  for (const change of [{ amountLamports: 0n }, { destination: other.toBase58() }, { programIds: [] }, { writableAccounts: [] }]) {
    assert.equal(evaluate(raw, {}, { ...native, ...change }).approved, false);
  }
  assert.equal(evaluate(Uint8Array.from([1,2,3]), {}, native).approved, false);
});
test('multiple recipients and unsupported effects cannot hide behind a valid transfer', () => {
  assert.equal(evaluate(bytes([transfer(recipient), transfer(other)])).approved, false);
  const unsupported = new TransactionInstruction({ programId: SystemProgram.programId, keys: [], data: Buffer.from([99]) });
  assert.equal(evaluate(bytes([transfer(recipient), unsupported])).approved, false);
});
test('priority fee calculation is independent of instruction order and missing/duplicate limits deny', () => {
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 });
  const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 });
  for (const instructions of [[price, limit, transfer(recipient)], [limit, price, transfer(recipient)]]) {
    const raw = bytes(instructions);
    assert.equal(VeritasWireDecoder.decode(raw).priorityFeeLamports, 2000n);
    assert.equal(evaluate(raw, { maxPriorityFeeLamports: 1999n }).approved, false);
    assert.equal(evaluate(raw).approved, true);
  }
  assert.equal(evaluate(bytes([price, transfer(recipient)])).approved, false);
  assert.equal(evaluate(bytes([limit, limit, transfer(recipient)])).approved, false);
  assert.equal(evaluate(bytes([limit, price, price, transfer(recipient)])).approved, false);
  const roundUp = bytes([ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), transfer(recipient)]);
  assert.equal(VeritasWireDecoder.decode(roundUp).priorityFeeLamports, 1n);
  assert.equal(evaluate(roundUp, { maxPriorityFeeLamports: 0n }).approved, false);
});
test('same-recipient transfers aggregate principal and do not invent tip attribution', () => {
  const raw = bytes([transfer(recipient), transfer(recipient)]);
  const view = VeritasWireDecoder.decode(raw);
  assert.equal(view.complete, true); assert.equal(view.amountLamports, 20n);
  assert.equal(view.jitoTipLamports, undefined);
  assert.equal(evaluate(raw, { maxAmountLamports: 19n }).approved, false);
  assert.equal(evaluate(raw, { maxAmountLamports: 20n }).approved, true);
});
test('non-payer sources and absent or readonly transfer accounts deny', () => {
  const data = SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: 10n }).data;
  const cases = [
    [{ pubkey: other, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: true }],
    [{ pubkey: payer, isSigner: true, isWritable: true }],
    [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: false }],
  ];
  for (const keys of cases) {
    const raw = bytes([new TransactionInstruction({ programId: SystemProgram.programId, keys, data })]);
    assert.equal(VeritasWireDecoder.decode(raw).complete, false);
    assert.equal(evaluate(raw).approved, false);
  }
});
test('legacy and v0 canonical transfers pass; trailing bytes fail before interpretation', () => {
  for (const legacy of [false, true]) {
    const raw = bytes([transfer(recipient)], legacy);
    assert.equal(evaluate(raw).approved, true);
    const suffixed = Buffer.concat([Buffer.from(raw), Buffer.from([255])]);
    assert.throws(() => VeritasWireDecoder.decode(suffixed), /Noncanonical message encoding or trailing bytes/);
    assert.equal(evaluate(suffixed).approved, false);
    // The shortvec account count starts after the version byte (v0 only) and header.
    const accountCountOffset = legacy ? 3 : 4;
    const overlong = Buffer.concat([Buffer.from(raw.subarray(0, accountCountOffset)),
      Buffer.from([raw[accountCountOffset] | 0x80, 0]), Buffer.from(raw.subarray(accountCountOffset + 1))]);
    assert.throws(() => VeritasWireDecoder.decode(overlong), /VERITAS_DECODE_FAILED/);
    assert.equal(evaluate(overlong).approved, false);
  }
});
