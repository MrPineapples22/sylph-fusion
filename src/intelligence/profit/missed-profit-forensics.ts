/**
 * Research-only missed-opportunity classification. It deliberately measures
 * blockers from supplied point-in-time facts; it does not estimate or invent
 * profitability when executable entry or exit evidence is absent.
 */
export type MissedProfitClass =
  | 'NOT_DISCOVERED' | 'STALE' | 'FALSE_VETO' | 'LOW_RANK' | 'NO_CAPITAL'
  | 'NO_EXECUTION' | 'UNEXITABLE' | 'CORRECT_SKIP' | 'UNRESOLVED';

export interface MissedProfitCaseInput {
  readonly caseId: string;
  readonly mint: string;
  readonly firstSeenAtMs?: number;
  readonly firstUsableAtMs?: number;
  readonly decisionAtMs?: number;
  readonly eligibleAtDecision: boolean;
  readonly hardSafetyVetoed: boolean;
  readonly softVetoed: boolean;
  readonly rankEligible: boolean;
  readonly capitalAvailable: boolean;
  readonly executionAttempted: boolean;
  readonly executionSucceeded?: boolean;
  readonly executableEntryEvidence: boolean;
  readonly executableExitEvidence: boolean;
  readonly expectedNetPnlLamports?: bigint;
  readonly realizedExecutableNetPnlLamports?: bigint;
}

export interface MissedProfitCase {
  readonly caseId: string;
  readonly mint: string;
  readonly classification: MissedProfitClass;
  readonly firstBlocker: string;
  readonly executableNetPnlLamports?: string;
  readonly isProfitableExecutableMiss: boolean;
}

const validTime = (time: number | undefined): boolean => time === undefined || (Number.isSafeInteger(time) && time > 0);

function validate(input: MissedProfitCaseInput): void {
  if (!input.caseId || !input.mint) throw new Error('MISSED_PROFIT_IDENTITY_REQUIRED');
  for (const time of [input.firstSeenAtMs, input.firstUsableAtMs, input.decisionAtMs]) {
    if (!validTime(time)) throw new Error('MISSED_PROFIT_TIME_INVALID');
  }
  if (input.firstSeenAtMs && input.firstUsableAtMs && input.firstUsableAtMs < input.firstSeenAtMs) {
    throw new Error('MISSED_PROFIT_USABLE_BEFORE_SEEN');
  }
  if (input.expectedNetPnlLamports !== undefined && !input.executableEntryEvidence) {
    throw new Error('MISSED_PROFIT_EXPECTED_ECONOMICS_REQUIRE_ENTRY_EVIDENCE');
  }
}

/** Returns the earliest evidenced blocker in the discovery-to-exit chain. */
export function classifyMissedProfit(input: MissedProfitCaseInput): MissedProfitCase {
  validate(input);
  let classification: MissedProfitClass;
  let firstBlocker: string;
  if (!input.firstSeenAtMs) {
    classification = 'NOT_DISCOVERED'; firstBlocker = 'NO_DISCOVERY_EVIDENCE';
  } else if (!input.firstUsableAtMs || !input.decisionAtMs || input.decisionAtMs < input.firstUsableAtMs) {
    classification = 'STALE'; firstBlocker = 'NO_TIMELY_USABLE_DECISION';
  } else if (input.hardSafetyVetoed) {
    classification = 'CORRECT_SKIP'; firstBlocker = 'HARD_SAFETY_VETO';
  } else if (input.softVetoed) {
    classification = 'FALSE_VETO'; firstBlocker = 'SOFT_ECONOMIC_VETO';
  } else if (!input.rankEligible) {
    classification = 'LOW_RANK'; firstBlocker = 'RANKING_OR_AUCTION';
  } else if (!input.capitalAvailable) {
    classification = 'NO_CAPITAL'; firstBlocker = 'CAPITAL_RESERVATION';
  } else if (!input.executionAttempted || input.executionSucceeded === false) {
    classification = 'NO_EXECUTION'; firstBlocker = 'EXECUTION_UNAVAILABLE_OR_FAILED';
  } else if (!input.executableEntryEvidence || !input.executableExitEvidence) {
    classification = 'UNEXITABLE'; firstBlocker = 'EXECUTABLE_ENTRY_OR_EXIT_EVIDENCE_MISSING';
  } else {
    classification = 'UNRESOLVED'; firstBlocker = 'NO_EVIDENCED_BLOCKER';
  }
  const executableNet = input.executableEntryEvidence && input.executableExitEvidence
    ? input.realizedExecutableNetPnlLamports : undefined;
  return Object.freeze({
    caseId: input.caseId, mint: input.mint, classification, firstBlocker,
    executableNetPnlLamports: executableNet?.toString(),
    isProfitableExecutableMiss: executableNet !== undefined && executableNet > 0n && classification !== 'CORRECT_SKIP',
  });
}
