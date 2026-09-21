/**
 * SOL-SYLPH Master Implementation Blueprint - CONSTITUTION
 * Machine Governance, Immutable Policy Registry & Authority Hierarchy
 * Specifications: Parts 20-24.
 */

import {
  PolicyRecord,
  PolicyAuthorityLayer,
  PolicyLineage,
} from '../contracts/blueprint-contracts.js';

export type ConfigNamespace =
  | 'constitutional'
  | 'safety'
  | 'capital'
  | 'execution'
  | 'models'
  | 'strategy'
  | 'research'
  | 'ui';

export class ConstitutionRegistry {
  private readonly policies = new Map<string, PolicyRecord>();
  private readonly lineages = new Map<string, PolicyLineage>();
  private readonly configStore = new Map<string, any>();

  constructor() {
    this.registerFoundationalPolicies();
    this.initializeDefaultConfigs();
  }

  private registerFoundationalPolicies(): void {
    // 1. Constitutional Layer: Inviolable axioms
    this.registerPolicy({
      policy_id: 'pol_const_authority_inviolable',
      version: '1.0.0',
      rule_class: 'CONSTITUTIONAL',
      status: 'ACTIVE',
      authorized_modifier: 'SYSTEM_ROOT_MULTISIG',
      dependencies: [],
      constraints: ['No unverified mint or freeze authority permitted'],
      effective_from: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
      certification_id: 'cert_const_genesis',
      hash: 'h_const_auth_v1',
    });

    // 2. Safety-Critical Layer: Fail-closed executions
    this.registerPolicy({
      policy_id: 'pol_safety_max_slippage_bound',
      version: '1.0.0',
      rule_class: 'SAFETY_CRITICAL',
      status: 'ACTIVE',
      authorized_modifier: 'SAFETY_KERNEL_OFFICER',
      dependencies: ['pol_const_authority_inviolable'],
      constraints: ['Max single-trade slippage hard capped at 25%'],
      effective_from: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
      certification_id: 'cert_safety_slippage_v1',
      hash: 'h_safety_slip_v1',
    });

    // 3. Mission-Critical Layer: Capital allocation
    this.registerPolicy({
      policy_id: 'pol_mission_capital_governor',
      version: '1.0.0',
      rule_class: 'MISSION_CRITICAL',
      status: 'ACTIVE',
      authorized_modifier: 'GOVERNOR_AUTHORITY',
      dependencies: ['pol_safety_max_slippage_bound'],
      constraints: ['Max per-token allocation = 2.5 SOL; Max aggregate exposure = 10.0 SOL'],
      effective_from: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
      certification_id: 'cert_gov_cap_v1',
      hash: 'h_gov_cap_v1',
    });

    // 4. Certified Policy Layer: Strategy qualification
    this.registerPolicy({
      policy_id: 'pol_strategy_proof_quorum',
      version: '1.0.0',
      rule_class: 'CERTIFIED_POLICY',
      status: 'ACTIVE',
      authorized_modifier: 'STRATEGY_COUNCIL',
      dependencies: ['pol_mission_capital_governor'],
      constraints: ['Proof state 3/3 required for full size; 2/3 limited to probe size'],
      effective_from: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
      certification_id: 'cert_strat_proof_v1',
      hash: 'h_strat_proof_v1',
    });
  }

  private initializeDefaultConfigs(): void {
    this.setConfig('constitutional/immutable_epoch', 1);
    this.setConfig('safety/max_drawdown_limit_pct', 25);
    this.setConfig('capital/max_single_position_sol', 2.5);
    this.setConfig('execution/jito_tip_max_sol', 0.01);
    this.setConfig('models/min_calibration_brier', 0.25);
    this.setConfig('strategy/min_executable_edge_bps', 50);
    this.setConfig('research/max_parallel_trials', 8);
    this.setConfig('ui/progressive_disclosure_level', 2);
  }

  public registerPolicy(policy: PolicyRecord): void {
    if (this.policies.has(policy.policy_id)) {
      const existing = this.policies.get(policy.policy_id)!;
      // Immutable policy versions: modifying creates new version with supersedes link
      if (existing.version === policy.version) {
        throw new Error(`Policy ${policy.policy_id} v${policy.version} is immutable. Cannot overwrite.`);
      }
    }
    this.policies.set(policy.policy_id, policy);
  }

  public getPolicy(policyId: string): PolicyRecord | undefined {
    return this.policies.get(policyId);
  }

  public getActivePoliciesByLayer(layer: PolicyAuthorityLayer): readonly PolicyRecord[] {
    return Array.from(this.policies.values()).filter(
      (p) => p.rule_class === layer && p.status === 'ACTIVE'
    );
  }

  /**
   * Part 23: Authority Principle
   * Verifies that proposed parameter does not independently expand authority
   * beyond what higher governance layers authorized.
   */
  public verifyAuthorityClamp(
    governorCapSol: number,
    requestedSol: number
  ): { authorized_size_sol: number; clamped: boolean; reason: string } {
    if (requestedSol > governorCapSol) {
      return {
        authorized_size_sol: governorCapSol,
        clamped: true,
        reason: `Authority Principle: Subsystem requested ${requestedSol} SOL which exceeds Governor boundary (${governorCapSol} SOL). Clamped to ${governorCapSol} SOL.`,
      };
    }
    return {
      authorized_size_sol: requestedSol,
      clamped: false,
      reason: `Authorized within Governor cap (${requestedSol} <= ${governorCapSol} SOL).`,
    };
  }

  /**
   * Part 22: Policy Lineage Record
   */
  public recordLineage(lineage: PolicyLineage): void {
    this.lineages.set(lineage.decision_id, lineage);
  }

  public getLineage(decisionId: string): PolicyLineage | undefined {
    return this.lineages.get(decisionId);
  }

  /**
   * Part 24: Configuration Governance with Namespaces
   */
  public setConfig(key: `${ConfigNamespace}/${string}`, value: any): void {
    this.configStore.set(key, value);
  }

  public getConfig<T>(key: `${ConfigNamespace}/${string}`, defaultValue: T): T {
    return this.configStore.has(key) ? (this.configStore.get(key) as T) : defaultValue;
  }

  public getGovernanceSummary(): {
    totalPolicies: number;
    activePoliciesCount: number;
    constitutionVersion: string;
    totalLineagesTracked: number;
  } {
    return {
      totalPolicies: this.policies.size,
      activePoliciesCount: Array.from(this.policies.values()).filter((p) => p.status === 'ACTIVE').length,
      constitutionVersion: '1.0.0-immutable',
      totalLineagesTracked: this.lineages.size,
    };
  }
}
