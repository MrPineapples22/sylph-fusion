import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ControlRootKernel,
  createConfigSeal,
  signCommandEnvelope
} from '../../dist/platform/control/command-seal.js';

describe('CONTROLROOT & COMMANDSEAL: Cryptographic Command Authority (Sections 44, 45, 46)', () => {
  const initialBundle = {
    execution: { maxSlippageBps: 250 },
    risk: { maxPositions: 3, dailyLossSol: 1.5 },
    tokenPolicy: { minHolders: 10 },
    providerConfig: { quorumMin: 2 },
    signerConfig: { kmsKeyId: 'kms-key-prod-1' },
    modelConfig: { activeEpoch: 'EPOCH-2026.09.26-1' },
    feePolicy: { dynamicPriorityBps: 50 },
    jitoPolicy: { tipFloorLamports: 10000 },
    capitalLimits: { totalAllocatedSol: 10 }
  };

  const initialSeal = createConfigSeal(1, initialBundle);
  const releaseRoot = 'RELEASE-COMMIT-SHA256-AAAA1111';
  const operatorKey = 'super_secret_operator_key_32bytes';

  it('verifies and executes an authentic CommandEnvelope', () => {
    const kernel = new ControlRootKernel({
      initialFenceEpoch: 10,
      initialConfigSeal: initialSeal,
      currentReleaseRoot: releaseRoot
    });

    kernel.registerOperator({
      operatorId: 'OPS-ALPHA',
      role: 'OPERATOR',
      secretOrKey: operatorKey
    });

    const now = Date.now();
    const env = signCommandEnvelope(
      {
        commandId: 'CMD-001',
        operatorId: 'OPS-ALPHA',
        role: 'OPERATOR',
        action: 'CLOSE_POSITION',
        payload: { mint: 'TokenABC', exitPct: 100 },
        issuedAtMs: now,
        expiresAtMs: now + 10000,
        nonce: 'NONCE-UNIQUE-001',
        controlEpoch: 1,
        fenceEpoch: 10,
        releaseRoot,
        configRoot: initialSeal.bundleHash,
        expectedStateRoot: 'STATE-ROOT-VALID-123'
      },
      operatorKey
    );

    const res = kernel.verifyAndAuthorizeCommand(env, 'STATE-ROOT-VALID-123', now + 100);
    assert.equal(res.authorized, true);

    // Replay attack with same nonce MUST FAIL
    const replayRes = kernel.verifyAndAuthorizeCommand(env, 'STATE-ROOT-VALID-123', now + 200);
    assert.equal(replayRes.authorized, false);
    assert.ok(replayRes.reason?.includes('ANTI-REPLAY VIOLATION'));
  });

  it('strictly rejects stale fence epoch (Invariant 4)', () => {
    const kernel = new ControlRootKernel({
      initialFenceEpoch: 10,
      initialConfigSeal: initialSeal,
      currentReleaseRoot: releaseRoot
    });

    kernel.registerOperator({
      operatorId: 'OPS-ALPHA',
      role: 'OPERATOR',
      secretOrKey: operatorKey
    });

    // Advance fence epoch to 11
    kernel.advanceFenceEpoch(11);

    const now = Date.now();
    // Command prepared under obsolete fence epoch 10
    const env = signCommandEnvelope(
      {
        commandId: 'CMD-FENCE-002',
        operatorId: 'OPS-ALPHA',
        role: 'OPERATOR',
        action: 'OPEN_POSITION',
        payload: { mint: 'TokenXYZ' },
        issuedAtMs: now,
        expiresAtMs: now + 10000,
        nonce: 'NONCE-UNIQUE-002',
        controlEpoch: 1,
        fenceEpoch: 10, // Stale!
        releaseRoot,
        configRoot: initialSeal.bundleHash,
        expectedStateRoot: 'STATE-123'
      },
      operatorKey
    );

    const res = kernel.verifyAndAuthorizeCommand(env, 'STATE-123', now);
    assert.equal(res.authorized, false);
    assert.ok(res.reason?.includes('STALE FENCE REJECTION'));
  });

  it('invalidates risk-increasing commands when configuration changes (Section 46)', () => {
    const kernel = new ControlRootKernel({
      initialFenceEpoch: 10,
      initialConfigSeal: initialSeal,
      currentReleaseRoot: releaseRoot
    });

    kernel.registerOperator({
      operatorId: 'OPS-ALPHA',
      role: 'OPERATOR',
      secretOrKey: operatorKey
    });

    const now = Date.now();
    // Prepare OPEN command under old config
    const env = signCommandEnvelope(
      {
        commandId: 'CMD-OPEN-003',
        operatorId: 'OPS-ALPHA',
        role: 'OPERATOR',
        action: 'OPEN_POSITION',
        payload: { mint: 'TokenRun' },
        issuedAtMs: now,
        expiresAtMs: now + 10000,
        nonce: 'NONCE-UNIQUE-003',
        controlEpoch: 1,
        fenceEpoch: 10,
        releaseRoot,
        configRoot: initialSeal.bundleHash,
        expectedStateRoot: 'STATE-ROOT-001'
      },
      operatorKey
    );

    // Operator updates risk configuration
    const updatedBundle = {
      ...initialBundle,
      risk: { maxPositions: 2, dailyLossSol: 1.0 }
    };
    kernel.updateConfiguration(updatedBundle);

    // Command authorized under old config must be strictly rejected
    const res = kernel.verifyAndAuthorizeCommand(env, 'STATE-ROOT-001', now + 50);
    assert.equal(res.authorized, false);
    assert.ok(res.reason?.includes('CONFIG STALENESS VIOLATION'));
  });
});
