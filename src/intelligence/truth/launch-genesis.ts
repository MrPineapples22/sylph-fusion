/**
 * SOL-SYLPH Launch Genesis Engine
 * Blueprint Part VIII
 *
 * Tracks the exact genesis lifecycle from mint creation to earliest executable route.
 * Measures detection latencies and targets: EARLIEST DEFENSIBLE DECISION.
 */

export interface GenesisStageTimestamp {
  readonly stage: string;
  readonly slot: number;
  readonly blockTimeMs: number;
  readonly detectedAtMs: number;
  readonly detectionLatencyMs: number;
  readonly signature?: string;
}

export interface LaunchGenesisRecord {
  readonly mint: string;
  readonly programType: 'SPL_TOKEN' | 'TOKEN_2022' | 'UNKNOWN';
  readonly stages: Record<string, GenesisStageTimestamp>;
  readonly mintDetectionLatencyMs: number;
  readonly poolDetectionLatencyMs: number;
  readonly firstTradeDetectionLatencyMs: number;
  readonly routeDetectionLatencyMs: number;
  readonly verificationLatencyMs: number;
  readonly earliestDefensibleDecisionMs: number;
  readonly isGenesisComplete: boolean;
}

export class LaunchGenesisEngine {
  private readonly records = new Map<string, LaunchGenesisRecord>();

  public initializeGenesis(mint: string, slot: number, blockTimeMs: number, programType: 'SPL_TOKEN' | 'TOKEN_2022' = 'SPL_TOKEN'): LaunchGenesisRecord {
    const now = Date.now();
    const mintLatency = Math.max(0, now - blockTimeMs);

    const record: LaunchGenesisRecord = {
      mint,
      programType,
      stages: {
        mintCreation: {
          stage: 'MINT_CREATION',
          slot,
          blockTimeMs,
          detectedAtMs: now,
          detectionLatencyMs: mintLatency,
        },
      },
      mintDetectionLatencyMs: mintLatency,
      poolDetectionLatencyMs: 0,
      firstTradeDetectionLatencyMs: 0,
      routeDetectionLatencyMs: 0,
      verificationLatencyMs: 0,
      earliestDefensibleDecisionMs: 0,
      isGenesisComplete: false,
    };

    this.records.set(mint, record);
    return record;
  }

  public recordPoolCreation(mint: string, slot: number, blockTimeMs: number, signature?: string): void {
    const rec = this.records.get(mint);
    if (!rec) return;
    const now = Date.now();
    const latency = Math.max(0, now - blockTimeMs);
    rec.stages['poolCreation'] = {
      stage: 'POOL_CREATION',
      slot,
      blockTimeMs,
      detectedAtMs: now,
      detectionLatencyMs: latency,
      signature,
    };
    (rec as { poolDetectionLatencyMs: number }).poolDetectionLatencyMs = latency;
  }

  public recordFirstTrade(mint: string, slot: number, blockTimeMs: number, signature?: string): void {
    const rec = this.records.get(mint);
    if (!rec) return;
    const now = Date.now();
    const latency = Math.max(0, now - blockTimeMs);
    rec.stages['firstTrade'] = {
      stage: 'FIRST_TRADE',
      slot,
      blockTimeMs,
      detectedAtMs: now,
      detectionLatencyMs: latency,
      signature,
    };
    (rec as { firstTradeDetectionLatencyMs: number }).firstTradeDetectionLatencyMs = latency;
  }

  public recordExecutableRoute(mint: string, slot: number, blockTimeMs: number): void {
    const rec = this.records.get(mint);
    if (!rec) return;
    const now = Date.now();
    const latency = Math.max(0, now - blockTimeMs);
    rec.stages['routeFormation'] = {
      stage: 'ROUTE_FORMATION',
      slot,
      blockTimeMs,
      detectedAtMs: now,
      detectionLatencyMs: latency,
    };
    (rec as { routeDetectionLatencyMs: number }).routeDetectionLatencyMs = latency;
  }

  public recordVerificationComplete(mint: string): void {
    const rec = this.records.get(mint);
    if (!rec) return;
    const now = Date.now();
    const mintStage = rec.stages['mintCreation'];
    const vLatency = mintStage ? now - mintStage.detectedAtMs : 50;
    (rec as { verificationLatencyMs: number }).verificationLatencyMs = vLatency;
    (rec as { earliestDefensibleDecisionMs: number }).earliestDefensibleDecisionMs = now;
    (rec as { isGenesisComplete: boolean }).isGenesisComplete = true;
  }

  public getRecord(mint: string): LaunchGenesisRecord | undefined {
    return this.records.get(mint);
  }
}
