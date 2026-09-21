/**
 * SOL-SYLPH Agent-Based Market Twin
 * Blueprint Part XXVIII
 *
 * Models reactive behavioral agents on top of protocol mechanics:
 * organic participant, sniper, arbitrageur, market maker,
 * LP provider, dev-related cluster, momentum bot, whale.
 */

export type ActorRole =
  | 'ORGANIC_PARTICIPANT'
  | 'SNIPER'
  | 'ARBITRAGEUR'
  | 'MARKET_MAKER'
  | 'LP_PROVIDER'
  | 'DEV_CLUSTER'
  | 'MOMENTUM_BOT'
  | 'WHALE'
  | 'FRESH_WALLET_CLUSTER'
  | 'UNKNOWN_AUTOMATION';

export interface ActorAgent {
  readonly agentId: string;
  readonly role: ActorRole;
  readonly holdingsTokens: number;
  readonly balanceSol: number;
  readonly entryBasisSol: number;
  readonly reactionLatencyMs: number;
  readonly exitTriggerGainPct: number;
  readonly panicExitLossPct: number;
  readonly confidence: number;
}

export interface AgentSimulationStep {
  readonly stepIndex: number;
  readonly activeSellingPressureSol: number;
  readonly activeBuyingPressureSol: number;
  readonly remainingWhaleInventoryTokens: number;
  readonly simulatedPriceChangePct: number;
}

export interface AgentTwinReport {
  readonly mint: string;
  readonly simulatedAgents: readonly ActorAgent[];
  readonly agentCascadeSusceptibility: number; // 0.0 to 1.0 (propensity for panic cascade)
  readonly expectedSniperDumpTimingSec: number;
  readonly organicAbsorptionCapacitySol: number;
}

export class AgentMarketTwinEngine {
  public simulateAgents(mint: string, agents: readonly ActorAgent[], currentPriceSol: number): AgentTwinReport {
    let sniperTokens = 0;
    let organicSol = 0;
    let panicVulnerability = 0;

    for (const a of agents) {
      if (a.role === 'SNIPER' || a.role === 'FRESH_WALLET_CLUSTER') {
        sniperTokens += a.holdingsTokens;
      }
      if (a.role === 'ORGANIC_PARTICIPANT' || a.role === 'MARKET_MAKER') {
        organicSol += a.balanceSol;
      }
      if (a.panicExitLossPct < 25) {
        panicVulnerability += 1;
      }
    }

    const cascadeSusceptibility = agents.length > 0
      ? Math.min(1.0, (panicVulnerability / agents.length) * 1.5)
      : 0.2;

    const expectedSniperDumpTimingSec = agents.some(a => a.role === 'SNIPER') ? 15 : 120;

    return {
      mint,
      simulatedAgents: agents,
      agentCascadeSusceptibility: Number(cascadeSusceptibility.toFixed(2)),
      expectedSniperDumpTimingSec,
      organicAbsorptionCapacitySol: Number(organicSol.toFixed(2)),
    };
  }
}
