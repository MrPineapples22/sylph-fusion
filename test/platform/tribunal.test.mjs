import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TribunalAuthority
} from '../../dist/platform/control/tribunal.js';

describe('TRIBUNAL: Cryptographically Authorized Operator Command Plane (Upgrade 5)', () => {
  it('executes medium risk commands with valid operator signature and CAS root', () => {
    const tribunal = new TribunalAuthority(1, 'STATE_ROOT_001');
    const now = Date.now();

    const env = {
      commandId: 'CMD-MED-1',
      issuerId: 'OPERATOR_BOB',
      isAiGenerated: false,
      action: 'PAUSE_STRATEGY',
      riskTier: 'MEDIUM_RISK',
      payload: { strategyId: 'STRAT_PUMP' },
      payloadHash: 'hash_med_1',
      issuedAtMs: now,
      expiresAtMs: now + 5000,
      nonce: 'NONCE_MED_1',
      controlEpoch: 1,
      expectedPreviousStateRoot: 'STATE_ROOT_001',
      approvals: [],
      requiredApprovalsCount: 0,
      issuerSignature: 'sig_bob',
      digest: 'digest_1'
    };

    const auth = tribunal.journalAndAuthorizeCommand(env, now);
    assert.equal(auth.isAuthorized, true);

    const result = tribunal.recordCommandResult('CMD-MED-1', true, 'Strategy paused successfully', 'STATE_ROOT_002');
    assert.equal(result.success, true);
    assert.equal(tribunal.getCurrentStateRoot(), 'STATE_ROOT_002');
  });

  it('strictly forbids AI agents from self-approving high-risk commands', () => {
    const tribunal = new TribunalAuthority(1, 'STATE_ROOT_001');
    const now = Date.now();

    // AI agent drafts command to raise capital and attempts self-approval
    const aiHighRiskEnv = {
      commandId: 'CMD-AI-HIGH-1',
      issuerId: 'AI_AGENT_EINSTEIN',
      isAiGenerated: true,
      action: 'RAISE_MAX_CAPITAL',
      riskTier: 'HIGH_RISK',
      payload: { newLimitSol: 100 },
      payloadHash: 'hash_ai_1',
      issuedAtMs: now,
      expiresAtMs: now + 5000,
      nonce: 'NONCE_AI_1',
      controlEpoch: 1,
      expectedPreviousStateRoot: 'STATE_ROOT_001',
      approvals: [
        {
          approverId: 'AI_AGENT_EINSTEIN', // Self-approval!
          approverRole: 'SUPERVISOR',
          signature: 'sig_ai_self',
          approvedAtMs: now
        }
      ],
      requiredApprovalsCount: 1,
      issuerSignature: 'sig_ai',
      digest: 'digest_ai'
    };

    const auth = tribunal.journalAndAuthorizeCommand(aiHighRiskEnv, now);
    assert.equal(auth.isAuthorized, false);
    assert.ok(auth.reason?.includes('HIGH_RISK_AI_VIOLATION'));
    assert.ok(auth.reason?.includes('cannot self-approve high-risk action'));
  });

  it('approves high-risk command when independent human supervisor signs', () => {
    const tribunal = new TribunalAuthority(1, 'STATE_ROOT_001');
    const now = Date.now();

    // AI drafted, but approved by independent Human Risk Officer
    const authorizedHighRiskEnv = {
      commandId: 'CMD-AI-HIGH-APPROVED',
      issuerId: 'AI_AGENT_EINSTEIN',
      isAiGenerated: true,
      action: 'ENABLE_LIVE_MAINNET',
      riskTier: 'HIGH_RISK',
      payload: { mode: 'LIVE' },
      payloadHash: 'hash_ai_2',
      issuedAtMs: now,
      expiresAtMs: now + 5000,
      nonce: 'NONCE_AI_2',
      controlEpoch: 1,
      expectedPreviousStateRoot: 'STATE_ROOT_001',
      approvals: [
        {
          approverId: 'HUMAN_SUPERVISOR_ALICE', // Independent human approval
          approverRole: 'SUPERVISOR',
          signature: 'sig_alice_supervisor',
          approvedAtMs: now
        }
      ],
      requiredApprovalsCount: 1,
      issuerSignature: 'sig_ai',
      digest: 'digest_ai_2'
    };

    const auth = tribunal.journalAndAuthorizeCommand(authorizedHighRiskEnv, now);
    assert.equal(auth.isAuthorized, true);
  });
});
