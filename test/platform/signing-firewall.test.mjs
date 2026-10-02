import test from 'node:test'; import assert from 'node:assert/strict'; import { createHash } from 'node:crypto'; import { SigningFirewall, InMemoryDurableReplayStore } from '../../dist/platform/signing/signing-firewall.js';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage } from '@solana/web3.js';
import { VeritasWireDecoder } from '../../dist/platform/signing/veritas-wire-decoder.js';
const payer = new PublicKey('11111111111111111111111111111111');
const recipient = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const bytes = new TransactionMessage({ payerKey: payer, recentBlockhash: payer.toBase58(),
  instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: 10n })],
}).compileToV0Message().serialize();
const hash=createHash('sha256').update(bytes).digest('hex'),now=1800000000000;
const request={requestId:'r',environment:'devnet',messageBytes:bytes,messageHash:hash,expectedSigner:payer.toBase58(),feePayer:payer.toBase58(),policyVersion:'v1',policyHash:'p1',intentId:'intent',simulationId:'sim',expiresAt:now+100};
const policy={version:'v1',hash:'p1',allowedPrograms:[SystemProgram.programId.toBase58()],allowedFeePayers:[payer.toBase58()],maxAmountLamports:10n,maxSlippageBps:100,maxPriorityFeeLamports:2n,expectedMint:'',expectedDestination:recipient.toBase58(),mainnetEnabled:false};
const gates={journalHealthy:true,killSwitchClear:true,providerGateHealthy:true,simulationPassed:true};
const decoded=VeritasWireDecoder.decode(bytes,{simulationId:'sim'});
test('firewall approves only a complete frozen decoded message bound to policy and simulation',()=>{const f=new SigningFirewall();assert.equal(f.evaluate(request,decoded,policy,gates,now).approved,true);assert.equal(f.evaluate(request,decoded,policy,gates,now).approved,false);});
test('firewall denies mutation, unknown programs, unhealthy journal and disabled mainnet',()=>{const f=new SigningFirewall();const altered=f.evaluate({...request,messageHash:'bad'},decoded,policy,gates,now);assert.ok(altered.reasonCodes.includes('MESSAGE_HASH_MISMATCH'));const unknown=f.evaluate({...request,requestId:'u'}, decoded,{...policy,allowedPrograms:[]},gates,now);assert.ok(unknown.reasonCodes.includes('UNKNOWN_PROGRAM_DENIED'));const mainnet=f.evaluate({...request,requestId:'m',environment:'mainnet-beta'},decoded,policy,{...gates,journalHealthy:false},now);assert.ok(mainnet.reasonCodes.includes('MAINNET_INTERLOCK_CLOSED'));assert.ok(mainnet.reasonCodes.includes('JOURNAL_UNHEALTHY'));});
test('shared in-memory replay store blocks duplicate requests across firewall instances', () => {
  const sharedStore = new InMemoryDurableReplayStore();
  const f1 = new SigningFirewall(sharedStore);
  const res1 = f1.evaluate(request, decoded, policy, gates, now);
  assert.equal(res1.approved, true);

  // Simulate process restart with new SigningFirewall instance loading sharedStore
  const f2 = new SigningFirewall(sharedStore);
  const res2 = f2.evaluate(request, decoded, policy, gates, now);
  assert.equal(res2.approved, false);
  assert.ok(res2.reasonCodes.includes('REPLAY_DETECTED'), 'Durable store must prevent replay after restart');
});

test('firewall rejects a real System transfer whose destination differs from policy', () => {
  const owner = Keypair.fromSeed(Buffer.alloc(32, 31)).publicKey;
  const actualRecipient = Keypair.fromSeed(Buffer.alloc(32, 32)).publicKey;
  const expectedRecipient = Keypair.fromSeed(Buffer.alloc(32, 33)).publicKey;
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: owner, toPubkey: actualRecipient, lamports: 9_000_000n })],
  }).compileToV0Message();
  const messageBytes = message.serialize();
  const messageHash = createHash('sha256').update(messageBytes).digest('hex');
  const decision = new SigningFirewall().evaluate({
    ...request,
    requestId: 'wrong-system-destination',
    messageBytes,
    messageHash,
    expectedSigner: owner.toBase58(),
    feePayer: owner.toBase58(),
  }, null, {
    ...policy,
    allowedPrograms: [SystemProgram.programId.toBase58()],
    allowedFeePayers: [owner.toBase58()],
    maxAmountLamports: 10_000_000n,
    expectedMint: '',
    expectedDestination: expectedRecipient.toBase58(),
  }, gates, now);
  assert.equal(decision.approved, false);
  assert.ok(decision.reasonCodes.includes('INTENT_BINDING_MISMATCH'));
});

test('firewall rejects unknown instructions even when their program is allow-listed', () => {
  const owner = Keypair.fromSeed(Buffer.alloc(32, 34)).publicKey;
  const jupiter = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 10n }),
      new TransactionInstruction({ programId: jupiter, keys: [], data: Buffer.from([0xff]) }),
    ],
  }).compileToV0Message();
  const messageBytes = message.serialize();
  const messageHash = createHash('sha256').update(messageBytes).digest('hex');
  const decision = new SigningFirewall().evaluate({
    ...request,
    requestId: 'unknown-allow-listed-jupiter',
    messageBytes,
    messageHash,
    expectedSigner: owner.toBase58(),
    feePayer: owner.toBase58(),
  }, null, {
    ...policy,
    allowedPrograms: [jupiter.toBase58()],
    allowedFeePayers: [owner.toBase58()],
    maxAmountLamports: 10n,
    expectedMint: '',
    expectedDestination: recipient.toBase58(),
  }, gates, now);
  assert.equal(decision.approved, false);
  assert.ok(decision.reasonCodes.includes('TRANSACTION_DECODER_INCOMPLETE'));
});

test('native decode failure cannot fall back to a caller manifest', () => {
  const spoofedBytes = Uint8Array.from([1, 2, 3]);
  const spoofedHash = createHash('sha256').update(spoofedBytes).digest('hex');
  const decision = new SigningFirewall().evaluate({
    ...request,
    requestId: 'native-decode-failure-no-fallback',
    messageBytes: spoofedBytes,
    messageHash: spoofedHash,
  }, decoded, policy, gates, now);
  assert.equal(decision.approved, false);
  assert.ok(decision.reasonCodes.some(code => code.startsWith('NATIVE_DECODE_FAILED:')));
  assert.ok(decision.reasonCodes.includes('TRANSACTION_DECODER_INCOMPLETE'));
});

test('decoder never labels policy expectations as observed mint or destination', () => {
  const view = VeritasWireDecoder.decode(bytes, {
    simulationId: 'sim',
    expectedMint: 'policy-mint-must-not-be-observed',
    expectedDestination: 'policy-destination-must-not-be-observed',
    maxSlippageBps: 999,
  });
  assert.equal(view.mint, '');
  assert.equal(view.destination, recipient.toBase58());
  assert.equal(view.maxSlippageBps, 0);
});
