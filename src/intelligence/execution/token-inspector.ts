/**
 * SOL-SYLPH Master Production Intelligence - Token Program Inspector
 * Specifications: Section 10 (Token Program Inspection).
 *
 * Rules:
 * 1. Do not rely solely on RugCheck.
 * 2. Decompose risk into: TOKEN_CONTROL_RISK, TRANSFER_RISK, AUTHORITY_RISK, EXTENSION_RISK.
 * 3. Keep provenance for every conclusion.
 */

export interface TokenProgramAuditInput {
  readonly mint: string;
  readonly programOwner: string; // Tokenkeg or Token-2022
  readonly mintAuthority: string | null;
  readonly freezeAuthority: string | null;
  readonly metadataAuthority?: string | null;
  readonly updateAuthority?: string | null;
  readonly hasPermanentDelegate: boolean;
  readonly permanentDelegateAddress?: string | null;
  readonly transferFeeBps: number | null;
  readonly hasTransferHook: boolean;
  readonly transferHookProgramId?: string | null;
  readonly isNonTransferable: boolean;
  readonly hasCpiGuard: boolean;
  readonly defaultAccountFrozen: boolean;
  readonly hasConfidentialTransfer?: boolean;
  readonly isPausable?: boolean;
  readonly hasMintCloseAuthority?: boolean;
  readonly hasMetadataPointer?: boolean;
  readonly hasUnknownExtensions?: boolean;
}

export interface DecomposedRiskReport {
  readonly mint: string;
  readonly tokenControlRiskScore: number; // 0 to 100
  readonly transferRiskScore: number;     // 0 to 100
  readonly authorityRiskScore: number;    // 0 to 100
  readonly extensionRiskScore: number;    // 0 to 100
  readonly overallRiskScore: number;      // 0 (safest) to 100 (lethal)
  readonly uncertaintyPenalty: number;    // 0 to 100
  readonly hardDisqualifiers: readonly string[];
  readonly isAllowed: boolean;
  readonly evaluatedAtMs: number;
}

export class TokenProgramInspector {
  public inspect(input: TokenProgramAuditInput): DecomposedRiskReport {
    const hardDisqualifiers: string[] = [];
    let tokenControlRisk = 0;
    let transferRisk = 0;
    let authorityRisk = 0;
    let extensionRisk = 0;
    let uncertaintyPenalty = 0;

    // 1. Control & Authority Risk
    if (input.freezeAuthority !== null && input.freezeAuthority !== undefined && input.freezeAuthority !== 'Disabled') {
      tokenControlRisk += 80;
      hardDisqualifiers.push('active_freeze_authority');
    }
    if (input.mintAuthority !== null && input.mintAuthority !== undefined && input.mintAuthority !== 'Revoked') {
      tokenControlRisk += 30;
    }

    // 2. Permanent Delegate Backdoors
    if (input.hasPermanentDelegate) {
      authorityRisk += 100;
      hardDisqualifiers.push('permanent_delegate_backdoor');
    }

    // 3. Transfer Restrictions & Fees
    if (input.isNonTransferable) {
      transferRisk += 100;
      hardDisqualifiers.push('non_transferable_token');
    }
    if (input.defaultAccountFrozen) {
      transferRisk += 90;
      hardDisqualifiers.push('default_account_state_frozen');
    }
    if (input.transferFeeBps !== null && input.transferFeeBps !== undefined) {
      if (input.transferFeeBps > 500) { // > 5% fee
        transferRisk += 90;
        hardDisqualifiers.push(`excessive_transfer_fee_${input.transferFeeBps}bps`);
      } else if (input.transferFeeBps > 0) {
        transferRisk += Math.min(50, Math.round(input.transferFeeBps / 10));
      }
    }

    // 4. Token-2022 Extension Risks
    if (input.hasTransferHook) {
      extensionRisk += 70;
      hardDisqualifiers.push('unverified_transfer_hook');
    }
    if (input.hasConfidentialTransfer) {
      extensionRisk += 50;
      hardDisqualifiers.push('confidential_transfer_extension');
    }
    if (input.isPausable) {
      extensionRisk += 80;
      hardDisqualifiers.push('pausable_transfer_extension');
    }
    if (input.hasMintCloseAuthority) {
      extensionRisk += 60;
      hardDisqualifiers.push('mint_close_authority_active');
    }
    if (input.hasUnknownExtensions) {
      extensionRisk += 60;
      uncertaintyPenalty += 40;
      hardDisqualifiers.push('unknown_unsupported_extensions');
    }

    const overall = Math.min(
      100,
      Math.max(tokenControlRisk, transferRisk, authorityRisk, extensionRisk)
    );

    return {
      mint: input.mint,
      tokenControlRiskScore: tokenControlRisk,
      transferRiskScore: transferRisk,
      authorityRiskScore: authorityRisk,
      extensionRiskScore: extensionRisk,
      overallRiskScore: overall,
      uncertaintyPenalty,
      hardDisqualifiers,
      isAllowed: hardDisqualifiers.length === 0 && overall < 60 && uncertaintyPenalty < 50,
      evaluatedAtMs: Date.now(),
    };
  }
}
