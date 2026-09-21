/**
 * SOL-SYLPH Capital & Yield Regime Research Engine
 * Specifications: Multi-Protocol Yield Regime, Opportunity Cost & Capital Allocation Benchmark
 *
 * Inputs:
 * - Exponent (Solana PT/YT, rate trading)
 * - Lulo (Solana Protected/Direct stablecoin yield)
 * - Morpho (EVM curated vault allocation & risk)
 * - Aave (EVM mature lending/borrowing benchmark)
 * - WealthVille (Solana autonomous yield architecture benchmark)
 * - Scallop (Sui lending/collateral weight benchmark)
 *
 * NON-NEGOTIABLE INVARIANTS:
 * 1. Seed/demo information may exist only under an explicitly non-production classification
 *    (ILLUSTRATIVE, FIXTURE, TEST, SIMULATION).
 * 2. Non-production quotes must NEVER satisfy freshness or opportunity gates.
 * 3. Absence of evidence must never be converted into synthetic defaults (e.g. 8% or 6.5%).
 */

export type YieldProviderId =
  | 'exponent'
  | 'lulo'
  | 'morpho_vaults'
  | 'aave'
  | 'wealthville'
  | 'scallop';

export type QuoteClassification =
  | 'LIVE_OBSERVED'
  | 'ILLUSTRATIVE'
  | 'FIXTURE'
  | 'TEST'
  | 'SIMULATION';

export interface YieldSourceQuote {
  readonly providerId: YieldProviderId;
  readonly providerName: string;
  readonly chainScope: 'SOLANA' | 'EVM' | 'SUI';
  readonly assetSymbol: string;
  readonly apyPct: number;
  readonly isProtected: boolean;
  readonly isUnaudited: boolean;
  readonly timestampMs: number;
  readonly classification?: QuoteClassification;
}

export type YieldRegimeState =
  | 'YIELD_RICH_DEFENSIVE'
  | 'BALANCED_HURDLE'
  | 'LOW_YIELD_SPECULATIVE_FAVORABLE'
  | 'EVIDENCE_UNAVAILABLE';

export interface CapitalRegimeSnapshot {
  readonly snapshotId: string;
  readonly timestampMs: number;
  readonly solanaRiskFreeRateAprPct: number | null;
  readonly crossChainReferenceAprPct: number | null;
  readonly lowerRiskOpportunityCostAprPct: number | null;
  readonly requiredMemeRiskPremiumAprPct: number | null;
  readonly activeYieldBenchmarksCount: number;
  readonly regimeState: YieldRegimeState;
  readonly opportunityCostScore: number | null; // 0.0 to 1.0; null when unverified
  readonly yieldQuotes: readonly YieldSourceQuote[];
  readonly isRestrictedToResearchAndAllocation: true; // Structural invariant assertion
  readonly hasLiveEvidence: boolean;
  readonly notes: string;
}

export interface OpportunityCostEvaluation {
  readonly mint: string;
  readonly expectedMemeReturnAnnualizedPct: number;
  readonly hurdleRateAnnualizedPct: number | null;
  readonly isMemeRiskWorthwhile: boolean;
  readonly opportunityCostDeltaPct: number | null;
  readonly recommendation:
    | 'RESEARCH_EXPANSION_PERMITTED'
    | 'ALLOCATION_UNFAVORABLE'
    | 'PREFER_YIELD_BENCHMARK'
    | 'GATING_BLOCKED_UNAVAILABLE';
  readonly explanation: string;
}

export class CapitalYieldRegimeEngine {
  private static instance: CapitalYieldRegimeEngine | null = null;
  private readonly quotes = new Map<YieldProviderId, YieldSourceQuote>();
  private readonly baselineMemePremiumMultiple = 4.0; // Meme volatility requires at least 4x safe hurdle

  public constructor() {
    // Operational state starts empty. Seed quotes are NOT loaded into live state.
  }

  /**
   * Loads non-production fixture quotes strictly for testing and illustrative research.
   */
  public loadFixtureQuotes(classification: 'FIXTURE' | 'SIMULATION' | 'ILLUSTRATIVE' = 'FIXTURE'): void {
    const now = Date.now();
    this.registerYieldQuote({
      providerId: 'exponent',
      providerName: 'Exponent Protocol',
      chainScope: 'SOLANA',
      assetSymbol: 'SOL-PT',
      apyPct: 9.5,
      isProtected: false,
      isUnaudited: false,
      timestampMs: now,
      classification,
    });
    this.registerYieldQuote({
      providerId: 'lulo',
      providerName: 'Lulo Protocol',
      chainScope: 'SOLANA',
      assetSymbol: 'USDC-Protected',
      apyPct: 8.2,
      isProtected: true,
      isUnaudited: false,
      timestampMs: now,
      classification,
    });
    this.registerYieldQuote({
      providerId: 'morpho_vaults',
      providerName: 'Morpho Vaults',
      chainScope: 'EVM',
      assetSymbol: 'USDC-Morpho',
      apyPct: 7.8,
      isProtected: true,
      isUnaudited: false,
      timestampMs: now,
      classification,
    });
    this.registerYieldQuote({
      providerId: 'aave',
      providerName: 'Aave Protocol',
      chainScope: 'EVM',
      assetSymbol: 'USDC-Aave',
      apyPct: 6.4,
      isProtected: false,
      isUnaudited: false,
      timestampMs: now,
      classification,
    });
  }

  public static getInstance(): CapitalYieldRegimeEngine {
    if (!CapitalYieldRegimeEngine.instance) {
      CapitalYieldRegimeEngine.instance = new CapitalYieldRegimeEngine();
    }
    return CapitalYieldRegimeEngine.instance;
  }

  public clearQuotes(): void {
    this.quotes.clear();
  }

  /**
   * Register or update a yield intelligence mark from a benchmark provider.
   */
  public registerYieldQuote(quote: YieldSourceQuote): void {
    const enriched: YieldSourceQuote = {
      ...quote,
      classification: quote.classification ?? 'LIVE_OBSERVED',
    };
    this.quotes.set(enriched.providerId, enriched);
  }

  /**
   * Generates an authoritative CapitalRegimeSnapshot aggregating yield intelligence
   * across Exponent, Lulo, Morpho, Aave, WealthVille, and Scallop.
   */
  public createRegimeSnapshot(): CapitalRegimeSnapshot {
    const quotesList = Array.from(this.quotes.values());
    const liveQuotes = quotesList.filter(q => q.classification === 'LIVE_OBSERVED');
    const hasLiveEvidence = liveQuotes.length > 0;

    // Use live quotes if available; otherwise use all quotes but tag as non-live
    const targetQuotes = hasLiveEvidence ? liveQuotes : quotesList;

    if (targetQuotes.length === 0) {
      return {
        snapshotId: `regime_snap_${Date.now()}`,
        timestampMs: Date.now(),
        solanaRiskFreeRateAprPct: null,
        crossChainReferenceAprPct: null,
        lowerRiskOpportunityCostAprPct: null,
        requiredMemeRiskPremiumAprPct: null,
        activeYieldBenchmarksCount: 0,
        regimeState: 'EVIDENCE_UNAVAILABLE',
        opportunityCostScore: null,
        yieldQuotes: [],
        isRestrictedToResearchAndAllocation: true,
        hasLiveEvidence: false,
        notes: 'OPERATIONAL_YIELD_DATA_UNAVAILABLE - No yield quotes registered. Gating fails closed.',
      };
    }

    // 1. Solana benchmarks (Exponent, Lulo, WealthVille)
    const solanaQuotes = targetQuotes.filter(q => q.chainScope === 'SOLANA');
    let solanaRate: number | null = null;
    if (solanaQuotes.length > 0) {
      const auditedSolana = solanaQuotes.filter(q => !q.isUnaudited);
      const targets = auditedSolana.length > 0 ? auditedSolana : solanaQuotes;
      const sum = targets.reduce((acc, q) => acc + q.apyPct, 0);
      solanaRate = Number((sum / targets.length).toFixed(2));
    }

    // 2. Cross-chain reference benchmarks (Morpho, Aave, Scallop)
    const crossChainQuotes = targetQuotes.filter(q => q.chainScope !== 'SOLANA');
    let crossChainRate: number | null = null;
    if (crossChainQuotes.length > 0) {
      const sum = crossChainQuotes.reduce((acc, q) => acc + q.apyPct, 0);
      crossChainRate = Number((sum / crossChainQuotes.length).toFixed(2));
    }

    // Blended opportunity cost
    let opportunityCostApr: number | null = null;
    if (solanaRate !== null && crossChainRate !== null) {
      opportunityCostApr = Number((solanaRate * 0.7 + crossChainRate * 0.3).toFixed(2));
    } else if (solanaRate !== null) {
      opportunityCostApr = solanaRate;
    } else if (crossChainRate !== null) {
      opportunityCostApr = crossChainRate;
    }

    const requiredMemePremium = opportunityCostApr !== null
      ? Number((opportunityCostApr * this.baselineMemePremiumMultiple).toFixed(2))
      : null;

    let regimeState: YieldRegimeState;
    let opportunityScore: number | null = null;
    let notes: string;

    if (opportunityCostApr === null) {
      regimeState = 'EVIDENCE_UNAVAILABLE';
      notes = 'Yield benchmark rate could not be computed from available quotes.';
    } else if (!hasLiveEvidence) {
      regimeState = 'BALANCED_HURDLE';
      opportunityScore = 0.55;
      notes = 'ILLUSTRATIVE_FIXTURE_DATA_ONLY - Quotes are fixtures/simulations and must not satisfy live gating.';
    } else if (opportunityCostApr >= 14.0) {
      regimeState = 'YIELD_RICH_DEFENSIVE';
      opportunityScore = 0.85;
      notes = 'Safe yields are extremely elevated across Solana and EVM. Taking meme-token volatility risk carries high opportunity cost.';
    } else if (opportunityCostApr <= 6.0) {
      regimeState = 'LOW_YIELD_SPECULATIVE_FAVORABLE';
      opportunityScore = 0.25;
      notes = 'Yield environment is suppressed. Capital allocation favors selective speculative expansion if risk parameters pass.';
    } else {
      regimeState = 'BALANCED_HURDLE';
      opportunityScore = 0.55;
      notes = 'Standard yield hurdle environment. Memes must show substantial asymmetric risk/reward to exceed baseline safe yield.';
    }

    return {
      snapshotId: `regime_snap_${Date.now()}`,
      timestampMs: Date.now(),
      solanaRiskFreeRateAprPct: solanaRate,
      crossChainReferenceAprPct: crossChainRate,
      lowerRiskOpportunityCostAprPct: opportunityCostApr,
      requiredMemeRiskPremiumAprPct: requiredMemePremium,
      activeYieldBenchmarksCount: targetQuotes.length,
      regimeState,
      opportunityCostScore: opportunityScore,
      yieldQuotes: targetQuotes,
      isRestrictedToResearchAndAllocation: true,
      hasLiveEvidence,
      notes,
    };
  }

  /**
   * Evaluates opportunity cost for a specific token thesis:
   * "Is taking meme-token risk worthwhile relative to currently available yield?"
   *
   * Invariant: Output is purely research & allocation advice. NEVER a live trade order.
   */
  public evaluateOpportunityCost(params: {
    mint: string;
    expectedAnnualizedReturnPct: number;
  }): OpportunityCostEvaluation {
    const snapshot = this.createRegimeSnapshot();
    const hurdle = snapshot.requiredMemeRiskPremiumAprPct;

    if (hurdle === null) {
      return {
        mint: params.mint,
        expectedMemeReturnAnnualizedPct: params.expectedAnnualizedReturnPct,
        hurdleRateAnnualizedPct: null,
        isMemeRiskWorthwhile: false,
        opportunityCostDeltaPct: null,
        recommendation: 'GATING_BLOCKED_UNAVAILABLE',
        explanation: 'Yield hurdle is unavailable. Fails closed: opportunity gating blocked without evidence.',
      };
    }

    const delta = Number((params.expectedAnnualizedReturnPct - hurdle).toFixed(2));
    const isWorthwhile = delta > 0 && snapshot.hasLiveEvidence;

    let recommendation: OpportunityCostEvaluation['recommendation'];
    let explanation: string;

    if (isWorthwhile && delta >= 20.0) {
      recommendation = 'RESEARCH_EXPANSION_PERMITTED';
      explanation = `Expected annualized alpha (+${params.expectedAnnualizedReturnPct}%) clearly exceeds the risk-adjusted yield hurdle (+${hurdle}%). Speculative risk is mathematically justifiable over safe yield.`;
    } else if (isWorthwhile) {
      recommendation = 'RESEARCH_EXPANSION_PERMITTED';
      explanation = `Marginally exceeds yield hurdle (+${params.expectedAnnualizedReturnPct}% vs +${hurdle}% hurdle). Worthwhile under disciplined position caps only.`;
    } else if (!snapshot.hasLiveEvidence) {
      recommendation = 'ALLOCATION_UNFAVORABLE';
      explanation = `Live yield evidence is unavailable or purely illustrative. Capital is better allocated to safe yield protocols (Lulo, Exponent, Morpho).`;
    } else {
      recommendation = 'ALLOCATION_UNFAVORABLE';
      explanation = `Meme risk is NOT worthwhile. Expected return (+${params.expectedAnnualizedReturnPct}%) fails to beat the lower-risk yield opportunity cost hurdle (+${hurdle}% APR). Capital is better allocated to safe yield protocols (Lulo, Exponent, Morpho).`;
    }

    return {
      mint: params.mint,
      expectedMemeReturnAnnualizedPct: params.expectedAnnualizedReturnPct,
      hurdleRateAnnualizedPct: hurdle,
      isMemeRiskWorthwhile: isWorthwhile,
      opportunityCostDeltaPct: delta,
      recommendation,
      explanation,
    };
  }
}

export const globalCapitalYieldRegimeEngine = CapitalYieldRegimeEngine.getInstance();
