import test from 'node:test';
import assert from 'node:assert/strict';
import { KillSwitchHierarchy } from '../../dist/intelligence/safety/kill-switch-hierarchy.js';

test('KillSwitchHierarchy enforces multi-tier isolation and Modes 0 through 5', () => {
  const hierarchy = new KillSwitchHierarchy();

  // Baseline Mode 0 Full
  let status = hierarchy.getStatus();
  assert.equal(status.mode, 'MODE_0_FULL');
  assert.equal(status.liveTradingPermitted, true);
  assert.equal(hierarchy.isActionPermitted({ mint: 'mint_abc', isLiveExecution: true }).permitted, true);

  // 1. Token Kill
  hierarchy.activateKill('TOKEN_KILL', 'toxic_mint_123', 'Serial creator rugger identified');
  const tokenCheck = hierarchy.isActionPermitted({ mint: 'toxic_mint_123', isLiveExecution: true });
  assert.equal(tokenCheck.permitted, false);
  assert.match(tokenCheck.denialReason, /TOKEN_KILL_ACTIVE/);

  // Unrelated mint remains permitted
  assert.equal(hierarchy.isActionPermitted({ mint: 'healthy_mint_456', isLiveExecution: true }).permitted, true);

  // 2. Domain Kill
  hierarchy.activateKill('DOMAIN_KILL', 'pump.fun', 'DEX API outage');
  const domainCheck = hierarchy.isActionPermitted({ domain: 'pump.fun' });
  assert.equal(domainCheck.permitted, false);
  assert.match(domainCheck.denialReason, /DOMAIN_KILL_ACTIVE/);

  // 3. Execution Kill -> transitions to Mode 3 Shadow Only
  hierarchy.activateKill('EXECUTION_KILL', '*', 'RPC consensus desync');
  status = hierarchy.getStatus();
  assert.equal(status.mode, 'MODE_3_SHADOW_ONLY');
  assert.equal(status.liveTradingPermitted, false);
  assert.equal(status.shadowSimulationPermitted, true);

  // 4. System Kill -> transitions to Mode 5 Halt
  hierarchy.activateKill('SYSTEM_KILL', '*', 'Global emergency stop');
  status = hierarchy.getStatus();
  assert.equal(status.mode, 'MODE_5_HALT');
  assert.equal(status.liveTradingPermitted, false);
  assert.equal(status.shadowSimulationPermitted, false);
  assert.equal(status.dataIngestionActive, false);
});
