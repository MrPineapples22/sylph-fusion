/**
 * SYLPH FUSION — AIRGAP-R: Hard Research / Production Authority Separation
 * Specifications: Section 13 (Upgrade 9: Airgap-R), Section 103 (Invariants 2, 6, 8)
 *
 * Invariants:
 * 1. The research and intelligence layer is physically incapable of moving money, signing, or modifying the ledger.
 * 2. 7 distinct architectural roles:
 *    SYLPH_RESEARCH, SYLPH_INTELLIGENCE_RUNTIME, SYLPH_CAPITAL_AUTHORITY,
 *    SYLPH_EXECUTION_AUTHORITY, SYLPH_SIGNER, SYLPH_RECONCILER, SYLPH_SETTLEMENT.
 * 3. AI models and research agents remain ADVISORY ONLY.
 * 4. Production execution chain must remain:
 *    market evidence -> certified intelligence -> RiskAuthority -> capital reservation ->
 *    witness -> signer -> broadcast -> clearing. AI cannot bypass this pipeline.
 */

export type AuthorityDomain =
  | 'SYLPH_RESEARCH'
  | 'SYLPH_INTELLIGENCE_RUNTIME'
  | 'SYLPH_CAPITAL_AUTHORITY'
  | 'SYLPH_EXECUTION_AUTHORITY'
  | 'SYLPH_SIGNER'
  | 'SYLPH_RECONCILER'
  | 'SYLPH_SETTLEMENT';

export type ActionCapability =
  | 'READ_MARKET_TELEMETRY'
  | 'GENERATE_ADVISORY_SIGNAL'
  | 'PROPOSE_STRATEGY'
  | 'TRAIN_OFFLINE_MODEL'
  | 'RESERVE_CAPITAL'
  | 'BUILD_TRANSACTION'
  | 'SIGN_TRANSACTION_KMS'
  | 'BROADCAST_TRANSACTION'
  | 'SETTLE_DELTAS'
  | 'TRANSFER_TREASURY';

export class AirgapSecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AirgapSecurityViolationError';
  }
}

export class AirgapRAuthority {
  private static readonly DOMAIN_CAPABILITIES: Record<AuthorityDomain, ReadonlySet<ActionCapability>> = {
    SYLPH_RESEARCH: new Set<ActionCapability>([
      'READ_MARKET_TELEMETRY',
      'GENERATE_ADVISORY_SIGNAL',
      'PROPOSE_STRATEGY',
      'TRAIN_OFFLINE_MODEL'
    ]),
    SYLPH_INTELLIGENCE_RUNTIME: new Set<ActionCapability>([
      'READ_MARKET_TELEMETRY',
      'GENERATE_ADVISORY_SIGNAL'
    ]),
    SYLPH_CAPITAL_AUTHORITY: new Set<ActionCapability>([
      'READ_MARKET_TELEMETRY',
      'RESERVE_CAPITAL'
    ]),
    SYLPH_EXECUTION_AUTHORITY: new Set<ActionCapability>([
      'READ_MARKET_TELEMETRY',
      'BUILD_TRANSACTION',
      'BROADCAST_TRANSACTION'
    ]),
    SYLPH_SIGNER: new Set<ActionCapability>([
      'SIGN_TRANSACTION_KMS'
    ]),
    SYLPH_RECONCILER: new Set<ActionCapability>([
      'READ_MARKET_TELEMETRY'
    ]),
    SYLPH_SETTLEMENT: new Set<ActionCapability>([
      'SETTLE_DELTAS'
    ])
  };

  /**
   * Asserts whether a specific domain has structural authority to execute a capability.
   * Throws AirgapSecurityViolationError immediately if unauthorized.
   */
  public static assertAuthority(domain: AuthorityDomain, action: ActionCapability): void {
    const allowed = this.DOMAIN_CAPABILITIES[domain];
    if (!allowed || !allowed.has(action)) {
      throw new AirgapSecurityViolationError(
        `AIRGAP_AUTHORITY_VIOLATION: Domain ${domain} is strictly forbidden from executing action ${action}! ` +
        `Research, AI models, and advisory runtime cannot hold signing, capital, or settlement authority.`
      );
    }
  }

  /**
   * Validates that an economic order followed the canonical pipeline:
   * Evidence -> Advisory Signal -> Risk Check -> Capital Reservation -> Witness -> Signer.
   */
  public static assertPipelineIntegrity(pipelineSteps: readonly AuthorityDomain[]): boolean {
    const expectedOrder: AuthorityDomain[] = [
      'SYLPH_INTELLIGENCE_RUNTIME',
      'SYLPH_CAPITAL_AUTHORITY',
      'SYLPH_EXECUTION_AUTHORITY',
      'SYLPH_SIGNER',
      'SYLPH_SETTLEMENT'
    ];

    let currentExpectedIdx = 0;
    for (const step of pipelineSteps) {
      if (step === expectedOrder[currentExpectedIdx]) {
        currentExpectedIdx++;
      }
    }

    if (currentExpectedIdx !== expectedOrder.length) {
      throw new AirgapSecurityViolationError(
        `PIPELINE_INTEGRITY_BREACH: Execution bypassed mandatory safety sequence. ` +
        `Executed sequence: [${pipelineSteps.join(' -> ')}], expected complete chain.`
      );
    }

    return true;
  }
}
