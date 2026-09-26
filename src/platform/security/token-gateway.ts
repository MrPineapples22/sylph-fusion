export type SecurityGatewayVerdict = 'ALLOW' | 'LIMIT' | 'QUARANTINE' | 'BLOCK';

export interface TokenSecurityAuditInput {
  mint: string;
  creator: string;
  rugcheckScore: number | null;
  rugged: boolean | null;
  isMintAuthorityRevoked: boolean;
  isFreezeAuthorityRevoked: boolean;
  token2022TransferFeeBps: number | null;
  hasPermanentDelegate: boolean;
  top10HoldersBps: number;
  realQuoteReserveLamports: bigint;
  creatorTokensHeldPct: number;
  knownIncidentHistoryCount: number;
}

export interface SecurityGatewayResult {
  verdict: SecurityGatewayVerdict;
  allowedMaxPositionSizeLamports: bigint | null;
  riskScore: number; // 0 (safest) to 100 (lethal)
  flags: string[];
  reason: string;
  evaluatedAt: number;
  readonly isStructuralFailure?: boolean;
  readonly domainDispositions?: {
    readonly tokenSafety: 'PASS' | 'FAIL' | 'UNKNOWN';
    readonly policy: 'ALLOW' | 'LIMIT' | 'QUARANTINE' | 'POLICY_EXCLUDED';
  };
}

export class TokenAdmissionGateway {
  evaluate(input: TokenSecurityAuditInput): SecurityGatewayResult {
    const flags: string[] = [];
    let score = 0;

    // 1. Hard Disqualifiers -> Immediate BLOCK (Structural Failure)
    if (input.rugged === true) {
      flags.push('confirmed_rugged');
      return {
        verdict: 'BLOCK',
        allowedMaxPositionSizeLamports: null,
        riskScore: 100,
        flags,
        reason: 'Confirmed rug on record',
        evaluatedAt: Date.now(),
        isStructuralFailure: true,
        domainDispositions: { tokenSafety: 'FAIL', policy: 'POLICY_EXCLUDED' },
      };
    }

    if (!input.isFreezeAuthorityRevoked) {
      flags.push('active_freeze_authority');
      return {
        verdict: 'BLOCK',
        allowedMaxPositionSizeLamports: null,
        riskScore: 100,
        flags,
        reason: 'Active freeze authority present',
        evaluatedAt: Date.now(),
        isStructuralFailure: true,
        domainDispositions: { tokenSafety: 'FAIL', policy: 'POLICY_EXCLUDED' },
      };
    }

    if (input.hasPermanentDelegate) {
      flags.push('permanent_delegate_enabled');
      return {
        verdict: 'BLOCK',
        allowedMaxPositionSizeLamports: null,
        riskScore: 100,
        flags,
        reason: 'Token-2022 permanent delegate backdoor detected',
        evaluatedAt: Date.now(),
        isStructuralFailure: true,
        domainDispositions: { tokenSafety: 'FAIL', policy: 'POLICY_EXCLUDED' },
      };
    }

    if (input.token2022TransferFeeBps !== null && input.token2022TransferFeeBps > 500) { // > 5% fee
      flags.push(`excessive_transfer_fee_${input.token2022TransferFeeBps}bps`);
      return {
        verdict: 'BLOCK',
        allowedMaxPositionSizeLamports: null,
        riskScore: 95,
        flags,
        reason: 'Transfer fee exceeds 5% threshold',
        evaluatedAt: Date.now(),
        isStructuralFailure: true,
        domainDispositions: { tokenSafety: 'FAIL', policy: 'POLICY_EXCLUDED' },
      };
    }

    if (input.knownIncidentHistoryCount > 0) {
      flags.push(`creator_incident_history_${input.knownIncidentHistoryCount}`);
      return {
        verdict: 'BLOCK',
        allowedMaxPositionSizeLamports: null,
        riskScore: 100,
        flags,
        reason: 'Creator linked to past malicious incidents',
        evaluatedAt: Date.now(),
        isStructuralFailure: false,
        domainDispositions: { tokenSafety: 'PASS', policy: 'POLICY_EXCLUDED' },
      };
    }

    // 2. Additive Risk Scoring
    if (input.rugcheckScore !== null) {
      if (input.rugcheckScore > 1000) {
        flags.push(`rugcheck_high_score_${input.rugcheckScore}`);
        score += 40;
      } else if (input.rugcheckScore > 500) {
        flags.push(`rugcheck_moderate_score_${input.rugcheckScore}`);
        score += 20;
      }
    } else {
      flags.push('rugcheck_unavailable');
      score += 25;
    }

    if (!input.isMintAuthorityRevoked) {
      flags.push('mint_authority_active');
      score += 30;
    }

    if (input.top10HoldersBps > 4000) { // Top 10 hold > 40%
      flags.push(`high_holder_concentration_${input.top10HoldersBps}bps`);
      score += 30;
    } else if (input.top10HoldersBps > 2500) {
      flags.push(`moderate_holder_concentration_${input.top10HoldersBps}bps`);
      score += 15;
    }

    if (input.creatorTokensHeldPct > 10.0) { // Creator holds > 10%
      flags.push(`creator_oversized_supply_${input.creatorTokensHeldPct}%`);
      score += 35;
    }

    // Minimum Reserve Check (0.5 SOL floor)
    if (input.realQuoteReserveLamports < 500_000_000n) {
      flags.push('shallow_bonding_reserve');
      score += 25;
    }

    score = Math.min(100, score);

    // 3. Verdict Categorization
    if (score >= 70) {
      return {
        verdict: 'BLOCK',
        allowedMaxPositionSizeLamports: null,
        riskScore: score,
        flags,
        reason: `Cumulative risk score (${score}/100) exceeds safety ceiling`,
        evaluatedAt: Date.now(),
        isStructuralFailure: false,
        domainDispositions: { tokenSafety: 'PASS', policy: 'POLICY_EXCLUDED' },
      };
    } else if (score >= 45) {
      return {
        verdict: 'QUARANTINE',
        allowedMaxPositionSizeLamports: null,
        riskScore: score,
        flags,
        reason: 'Quarantined for shadow observation; real capital prohibited',
        evaluatedAt: Date.now(),
        isStructuralFailure: false,
        domainDispositions: { tokenSafety: 'PASS', policy: 'QUARANTINE' },
      };
    } else if (score >= 20) {
      // LIMIT: Allowed but position size capped to 0.5 SOL
      return {
        verdict: 'LIMIT',
        allowedMaxPositionSizeLamports: 500_000_000n,
        riskScore: score,
        flags,
        reason: 'Authorized with limited position size due to elevated metrics',
        evaluatedAt: Date.now(),
        isStructuralFailure: false,
        domainDispositions: { tokenSafety: 'PASS', policy: 'LIMIT' },
      };
    } else {
      return {
        verdict: 'ALLOW',
        allowedMaxPositionSizeLamports: null, // Full mandate capacity allowed
        riskScore: score,
        flags,
        reason: 'All safety and integrity requirements verified',
        evaluatedAt: Date.now(),
        isStructuralFailure: false,
        domainDispositions: { tokenSafety: 'PASS', policy: 'ALLOW' },
      };
    }
  }
}
