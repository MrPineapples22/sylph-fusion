/**
 * SYLPH FUSION — SOL AGENT 2: MARKET MICROSTRUCTURE ENGINEER (MICROSTRUCTURE-X)
 * Specifications: Sections 3 (Sol Agent 2), 16 (Barrier Fatigue), 17 (Authentic Demand),
 * 18 (Metaorders), 19 (Wallets), 20 (Inventory), 21 (Creator), 23 (Capital Reservoir),
 * 24 (Capital Tournament), 30 (MEV Contamination).
 *
 * Implements:
 * 1. AuthenticDemandEngine: EffectiveBuyerCount, EffectiveSellerCount, MeaningfulBuyerBreadth, FreshCapital.
 * 2. MetaorderIntelligenceEngine: Latent parent order detection, algorithmic completion, reversion hazard, algo sync.
 * 3. SellHazardEngine: Cost basis distribution, BreakEvenOverhang, ProfitOverhang, UnderwaterSupplySurface.
 * 4. ParticipantEcologyEngine: ECOLOGY-X classification (sniper, copy trader, cabal, organic, diamond hands).
 * 5. CapitalTournamentEngine: Capital competition, CapitalShare, CapitalShareMomentum, Leader/Challenger ranking.
 * 6. CohortSurvivalEngine: Holder cohort retention and survival analysis across drawdown.
 * 7. BarrierFatigueEngine: Barrier attempt ledger, AttemptEfficiency, FailedBreakoutInventory.
 * 8. MevContaminationEngine: MEV filtration, MEVContaminationRatio, OrganicPriceDiscoveryRatio.
 *
 * Research-only heuristics. Wallet roles, inferred capital origin, metaorder
 * probabilities, hazard scores, tournament ranks, and safety flags are not
 * calibrated or backed by verified provenance. They must not grant trade
 * authority or be treated as certified market facts.
 */

// ---------------------------------------------------------------------------
// 1. AUTHENTIC DEMAND & SYBIL PURGING (Section 17)
// ---------------------------------------------------------------------------

function nonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
}

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
}

function nonNegativeBigint(value: bigint, name: string): void {
  if (typeof value !== 'bigint' || value < 0n) throw new RangeError(`${name} must be a nonnegative bigint`);
}

function nonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${name} must be nonempty`);
}

function ratio(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 1_000_000_000n) / denominator) / 1_000_000_000;
}

export interface TradeParticipant {
  readonly wallet: string;
  readonly fundingRoot?: string;
  readonly isWashSuspect: boolean;
  readonly isSubDust: boolean;
  readonly isSniper: boolean;
  readonly solAmount: number;
}

export interface AuthenticDemandProfile {
  readonly mint: string;
  readonly rawBuyerCount: number;
  readonly effectiveBuyerCount: number;
  readonly rawSellerCount: number;
  readonly effectiveSellerCount: number;
  readonly meaningfulBuyerBreadth: number; // 0.0 to 1.0
  readonly controllerAdjustedBreadth: number;
  readonly freshCapitalSol: number;
  readonly recirculatedCapitalSol: number;
  readonly meetsAntiSniperBaseline: boolean; // age >= 10s & effectiveBuyers >= 3
  readonly passesUniqueBuyerCheck: boolean;  // effectiveBuyers >= 5
}

export class AuthenticDemandEngine {
  public static evaluateDemand(
    mint: string,
    ageSeconds: number,
    buyers: readonly TradeParticipant[],
    sellers: readonly TradeParticipant[]
  ): AuthenticDemandProfile {
    nonEmpty(mint, 'mint');
    nonNegativeFinite(ageSeconds, 'ageSeconds');
    for (const p of [...buyers, ...sellers]) {
      nonEmpty(p.wallet, 'participant wallet');
      if (p.fundingRoot !== undefined) nonEmpty(p.fundingRoot, 'fundingRoot');
      nonNegativeFinite(p.solAmount, 'participant solAmount');
    }
    // Sybil clustering by funding root
    const independentBuyerEntities = new Set<string>();
    let freshSol = 0;
    let recirculatedSol = 0;

    for (const b of buyers) {
      if (b.isWashSuspect || b.isSubDust) continue;
      const entityKey = b.fundingRoot && b.fundingRoot.length > 0 ? b.fundingRoot : b.wallet;
      independentBuyerEntities.add(entityKey);
      if (b.isSniper) {
        recirculatedSol += b.solAmount;
      } else {
        freshSol += b.solAmount;
      }
    }

    const independentSellerEntities = new Set<string>();
    for (const s of sellers) {
      if (s.isWashSuspect || s.isSubDust) continue;
      const entityKey = s.fundingRoot && s.fundingRoot.length > 0 ? s.fundingRoot : s.wallet;
      independentSellerEntities.add(entityKey);
    }

    const effectiveBuyerCount = independentBuyerEntities.size;
    const effectiveSellerCount = independentSellerEntities.size;

    const rawBuyerCount = buyers.length;
    const rawSellerCount = sellers.length;

    const meaningfulBuyerBreadth = rawBuyerCount > 0 ? effectiveBuyerCount / rawBuyerCount : 0;
    const controllerAdjustedBreadth = Math.min(1.0, effectiveBuyerCount / 10);

    const meetsAntiSniperBaseline = ageSeconds >= 10 && effectiveBuyerCount >= 3;
    const passesUniqueBuyerCheck = effectiveBuyerCount >= 5;

    return {
      mint,
      rawBuyerCount,
      effectiveBuyerCount,
      rawSellerCount,
      effectiveSellerCount,
      meaningfulBuyerBreadth,
      controllerAdjustedBreadth,
      freshCapitalSol: freshSol,
      recirculatedCapitalSol: recirculatedSol,
      meetsAntiSniperBaseline,
      passesUniqueBuyerCheck,
    };
  }
}

// ---------------------------------------------------------------------------
// 2. METAORDER INTELLIGENCE (Section 18)
// ---------------------------------------------------------------------------

export type OrderDirection = 'BUY' | 'SELL';

export interface InferredMetaorder {
  readonly orderId: string;
  readonly direction: OrderDirection;
  readonly probableEntity: string;
  readonly confidence: number;
  readonly childCount: number;
  readonly childNotionalSol: number;
  readonly estimatedTotalSol: number;
  readonly estimatedRemainingSol: number;
  readonly cadenceSeconds: number;
  readonly completionProbability: number; // 0.0 to 1.0
  readonly informationProbability: number;
  readonly programReversionHazard: number; // expected post-completion drop
}

export class MetaorderIntelligenceEngine {
  public static inferMetaorder(trades: readonly {
    wallet: string;
    timestampMs: number;
    solAmount: number;
    isBuy: boolean;
  }[]): InferredMetaorder | null {
    if (trades.length < 3) return null;
    const first = trades[0];
    nonEmpty(first.wallet, 'wallet');
    for (const trade of trades) {
      nonEmpty(trade.wallet, 'wallet');
      nonNegativeFinite(trade.timestampMs, 'timestampMs');
      positiveFinite(trade.solAmount, 'solAmount');
      if (trade.wallet !== first.wallet || trade.isBuy !== first.isBuy) return null;
    }
    for (let i = 1; i < trades.length; i++) {
      if (trades[i].timestampMs <= trades[i - 1].timestampMs) return null;
    }

    // Check cadence regularity (interval variance)
    const intervals: number[] = [];
    for (let i = 1; i < trades.length; i++) {
      intervals.push((trades[i].timestampMs - trades[i - 1].timestampMs) / 1000);
    }

    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, v) => acc + Math.pow(v - meanInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = meanInterval > 0 ? stdDev / meanInterval : 1.0;

    // Regular cadence (CV < 0.45) indicates algorithmic parent order execution
    const isAlgorithmic = coefficientOfVariation < 0.45;
    const confidence = isAlgorithmic ? Math.min(0.95, 0.5 + (0.5 - coefficientOfVariation)) : 0.2;

    const childNotionalSol = trades.reduce((sum, t) => sum + t.solAmount, 0);
    const estimatedTotalSol = childNotionalSol * 1.5;
    const estimatedRemainingSol = Math.max(0, estimatedTotalSol - childNotionalSol);
    const completionProbability = Math.min(1.0, childNotionalSol / estimatedTotalSol);

    return {
      orderId: `meta_${trades[0].wallet.slice(0, 8)}`,
      direction: trades[0].isBuy ? 'BUY' : 'SELL',
      probableEntity: trades[0].wallet,
      confidence,
      childCount: trades.length,
      childNotionalSol,
      estimatedTotalSol,
      estimatedRemainingSol,
      cadenceSeconds: meanInterval,
      completionProbability,
      informationProbability: confidence * 0.8,
      programReversionHazard: completionProbability > 0.85 ? 0.35 : 0.10,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. SELL HAZARD & INVENTORY INTELLIGENCE (Section 20)
// ---------------------------------------------------------------------------

export interface InventoryHolder {
  readonly wallet: string;
  readonly balanceTokens: bigint;
  readonly costBasisUsd: number;
  readonly isDevOrCabal: boolean;
  readonly acquisitionTimeMs: number;
}

export interface SellHazardProfile {
  readonly mint: string;
  readonly currentPriceUsd: number;
  readonly profitOverhangPct: number;      // % of supply in >50% profit
  readonly breakEvenOverhangPct: number;   // % of supply near cost basis
  readonly underwaterSupplyPct: number;    // % of supply in severe loss
  readonly devDumpHazard: number;          // 0.0 to 1.0
  readonly cabalDumpHazard: number;        // 0.0 to 1.0
  readonly totalSellHazard: number;        // Composite instantaneous dump hazard (0.0 to 1.0)
  readonly canSafelyAbsorbSell: boolean;
}

export class SellHazardEngine {
  public static evaluateSellHazard(
    mint: string,
    currentPriceUsd: number,
    holders: readonly InventoryHolder[],
    devWallet?: string
  ): SellHazardProfile {
    nonEmpty(mint, 'mint');
    positiveFinite(currentPriceUsd, 'currentPriceUsd');
    if (devWallet !== undefined) nonEmpty(devWallet, 'devWallet');
    for (const h of holders) {
      nonEmpty(h.wallet, 'holder wallet');
      nonNegativeBigint(h.balanceTokens, 'balanceTokens');
      positiveFinite(h.costBasisUsd, 'costBasisUsd');
      nonNegativeFinite(h.acquisitionTimeMs, 'acquisitionTimeMs');
    }
    let totalTokens = 0n;
    let profitTokens = 0n;
    let breakEvenTokens = 0n;
    let underwaterTokens = 0n;
    let devTokens = 0n;
    let cabalTokens = 0n;

    for (const h of holders) {
      totalTokens += h.balanceTokens;
      const gain = currentPriceUsd / (h.costBasisUsd > 0 ? h.costBasisUsd : 0.000001) - 1.0;

      if (gain >= 0.5) {
        profitTokens += h.balanceTokens;
      } else if (gain >= -0.1 && gain < 0.5) {
        breakEvenTokens += h.balanceTokens;
      } else {
        underwaterTokens += h.balanceTokens;
      }

      if (h.wallet === devWallet) {
        devTokens += h.balanceTokens;
      } else if (h.isDevOrCabal) {
        cabalTokens += h.balanceTokens;
      }
    }

    if (totalTokens === 0n) {
      return {
        mint,
        currentPriceUsd,
        profitOverhangPct: 0,
        breakEvenOverhangPct: 0,
        underwaterSupplyPct: 0,
        devDumpHazard: 0,
        cabalDumpHazard: 0,
        totalSellHazard: 0,
        canSafelyAbsorbSell: false,
      };
    }

    const profitPct = ratio(profitTokens, totalTokens);
    const breakEvenPct = ratio(breakEvenTokens, totalTokens);
    const underwaterPct = ratio(underwaterTokens, totalTokens);
    const devPct = ratio(devTokens, totalTokens);
    const cabalPct = ratio(cabalTokens, totalTokens);

    const devDumpHazard = Math.min(1.0, devPct * 3.0);
    const cabalDumpHazard = Math.min(1.0, cabalPct * 2.0);

    const totalSellHazard = Math.min(
      1.0,
      0.15 + (profitPct * 0.35) + (devDumpHazard * 0.35) + (cabalDumpHazard * 0.25)
    );

    return {
      mint,
      currentPriceUsd,
      profitOverhangPct: profitPct,
      breakEvenOverhangPct: breakEvenPct,
      underwaterSupplyPct: underwaterPct,
      devDumpHazard,
      cabalDumpHazard,
      totalSellHazard,
      canSafelyAbsorbSell: totalSellHazard < 0.65,
    };
  }
}

// ---------------------------------------------------------------------------
// 4. PARTICIPANT ECOLOGY (Section 3)
// ---------------------------------------------------------------------------

export type EcologicalRole =
  | 'SNIPER'
  | 'COPY_TRADER'
  | 'MEV_SANDWICH'
  | 'CABAL_MEMBER'
  | 'ORGANIC_RETAIL'
  | 'DIAMOND_HOLDER'
  | 'DEV_INSIDER';

export interface EcologicalParticipant {
  readonly wallet: string;
  readonly role: EcologicalRole;
  readonly confidence: number;
}

export class ParticipantEcologyEngine {
  public static classifyWallet(wallet: {
    firstTxAgeSeconds: number;
    avgHoldDurationSeconds: number;
    sandwichCount: number;
    isDev: boolean;
    clusterSize: number;
  }): EcologicalParticipant {
    if (wallet.isDev) {
      return { wallet: 'dev', role: 'DEV_INSIDER', confidence: 1.0 };
    }
    if (wallet.sandwichCount > 0) {
      return { wallet: 'mev', role: 'MEV_SANDWICH', confidence: 0.95 };
    }
    if (wallet.firstTxAgeSeconds <= 2) {
      return { wallet: 'sniper', role: 'SNIPER', confidence: 0.9 };
    }
    if (wallet.clusterSize >= 4) {
      return { wallet: 'cabal', role: 'CABAL_MEMBER', confidence: 0.85 };
    }
    if (wallet.avgHoldDurationSeconds > 1800) {
      return { wallet: 'diamond', role: 'DIAMOND_HOLDER', confidence: 0.8 };
    }
    return { wallet: 'retail', role: 'ORGANIC_RETAIL', confidence: 0.7 };
  }
}

// ---------------------------------------------------------------------------
// 5. CAPITAL TOURNAMENT & RESERVOIR (Sections 23, 24)
// ---------------------------------------------------------------------------

export type TournamentRank = 'LOSING' | 'STABLE' | 'CHALLENGER' | 'LEADER' | 'DOMINANT';

export interface CapitalTournamentStatus {
  readonly mint: string;
  readonly capitalSharePct: number;        // Share of total active meme SOL
  readonly capitalShareMomentum: number;   // 5m change in share
  readonly tournamentRank: TournamentRank;
  readonly externalReservoirSol: number;
  readonly winnerProfitReservoirSol: number;
}

export class CapitalTournamentEngine {
  public static evaluateRank(
    mint: string,
    tokenVolumeSol: number,
    totalUniverseVolumeSol: number,
    previousSharePct: number,
    externalReservoirSol: number,
    winnerProfitReservoirSol: number
  ): CapitalTournamentStatus {
    nonEmpty(mint, 'mint');
    nonNegativeFinite(tokenVolumeSol, 'tokenVolumeSol');
    nonNegativeFinite(totalUniverseVolumeSol, 'totalUniverseVolumeSol');
    if (tokenVolumeSol > totalUniverseVolumeSol) throw new RangeError('token volume exceeds universe volume');
    nonNegativeFinite(previousSharePct, 'previousSharePct');
    if (previousSharePct > 100) throw new RangeError('previousSharePct exceeds 100');
    nonNegativeFinite(externalReservoirSol, 'externalReservoirSol');
    nonNegativeFinite(winnerProfitReservoirSol, 'winnerProfitReservoirSol');
    const capitalSharePct = totalUniverseVolumeSol > 0 ? (tokenVolumeSol / totalUniverseVolumeSol) * 100 : 0;
    const capitalShareMomentum = capitalSharePct - previousSharePct;

    let tournamentRank: TournamentRank = 'STABLE';
    if (capitalSharePct >= 35 && capitalShareMomentum >= 0) {
      tournamentRank = 'DOMINANT';
    } else if (capitalSharePct >= 20 || capitalShareMomentum >= 5) {
      tournamentRank = 'LEADER';
    } else if (capitalSharePct >= 10 || capitalShareMomentum >= 2) {
      tournamentRank = 'CHALLENGER';
    } else if (capitalShareMomentum < -3) {
      tournamentRank = 'LOSING';
    }

    return {
      mint,
      capitalSharePct,
      capitalShareMomentum,
      tournamentRank,
      externalReservoirSol,
      winnerProfitReservoirSol,
    };
  }
}

// ---------------------------------------------------------------------------
// 6. BARRIER FATIGUE SYSTEM (Section 16)
// ---------------------------------------------------------------------------

export interface BarrierAttemptRecord {
  readonly attemptId: string;
  readonly targetBarrierMultiplier: number; // 2, 5, 10, 20, 50, 100
  readonly independentCapitalSpentSol: number;
  readonly mechanicalCapitalSpentSol: number;
  readonly durableRepricingUsd: number;
  readonly attemptEfficiency: number;       // durableRepricing / retainedCapital
  readonly trappedInventoryTokens: bigint;
  readonly isSuccess: boolean;
}

export class BarrierFatigueEngine {
  public static recordAttempt(input: {
    attemptId: string;
    targetBarrierMultiplier: number;
    independentCapitalSpentSol: number;
    mechanicalCapitalSpentSol: number;
    startPriceUsd: number;
    endPriceUsd: number;
    trappedInventoryTokens: bigint;
  }): BarrierAttemptRecord {
    nonEmpty(input.attemptId, 'attemptId');
    positiveFinite(input.targetBarrierMultiplier, 'targetBarrierMultiplier');
    nonNegativeFinite(input.independentCapitalSpentSol, 'independentCapitalSpentSol');
    nonNegativeFinite(input.mechanicalCapitalSpentSol, 'mechanicalCapitalSpentSol');
    positiveFinite(input.startPriceUsd, 'startPriceUsd');
    positiveFinite(input.endPriceUsd, 'endPriceUsd');
    nonNegativeBigint(input.trappedInventoryTokens, 'trappedInventoryTokens');
    const durableRepricingUsd = Math.max(0, input.endPriceUsd - input.startPriceUsd);
    const retainedCapital = Math.max(0.1, input.independentCapitalSpentSol);
    const attemptEfficiency = durableRepricingUsd / retainedCapital;
    const isSuccess = input.endPriceUsd >= input.startPriceUsd * input.targetBarrierMultiplier * 0.95;

    return {
      attemptId: input.attemptId,
      targetBarrierMultiplier: input.targetBarrierMultiplier,
      independentCapitalSpentSol: input.independentCapitalSpentSol,
      mechanicalCapitalSpentSol: input.mechanicalCapitalSpentSol,
      durableRepricingUsd,
      attemptEfficiency,
      trappedInventoryTokens: input.trappedInventoryTokens,
      isSuccess,
    };
  }
}

// ---------------------------------------------------------------------------
// 7. MEV CONTAMINATION (Section 30)
// ---------------------------------------------------------------------------

export interface MevContaminationReport {
  readonly mint: string;
  readonly totalVolumeSol: number;
  readonly mevVolumeSol: number;
  readonly organicVolumeSol: number;
  readonly mevContaminationRatio: number;   // mevVolume / totalVolume (0.0 to 1.0)
  readonly organicPriceDiscoveryRatio: number; // organicVolume / totalVolume
  readonly isContaminated: boolean;         // contamination >= 0.40
}

export class MevContaminationEngine {
  public static evaluateContamination(trades: readonly {
    solAmount: number;
    isMev: boolean;
  }[], mint: string): MevContaminationReport {
    nonEmpty(mint, 'mint');
    let total = 0;
    let mev = 0;

    for (const t of trades) {
      nonNegativeFinite(t.solAmount, 'solAmount');
      total += t.solAmount;
      if (t.isMev) mev += t.solAmount;
    }

    if (!Number.isFinite(total) || !Number.isFinite(mev)) throw new RangeError('volume sum overflow');

    const organic = Math.max(0, total - mev);
    const mevContaminationRatio = total > 0 ? mev / total : 0;
    const organicPriceDiscoveryRatio = total > 0 ? organic / total : 0;

    return {
      mint,
      totalVolumeSol: total,
      mevVolumeSol: mev,
      organicVolumeSol: organic,
      mevContaminationRatio,
      organicPriceDiscoveryRatio,
      isContaminated: mevContaminationRatio >= 0.40,
    };
  }
}
