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
 * Function:
 * Computes CapitalRegimeSnapshot to evaluate the risk-free-ish / lower-risk opportunity cost.
 * Evaluates: "Is taking meme-token risk worthwhile relative to currently available yield?"
 *
 * NON-NEGOTIABLE INVARIANT:
 * This analysis belongs strictly in research and future portfolio allocation—
 * NEVER as an automated reason to trade in production.
 */
export class CapitalYieldRegimeEngine {
    static instance = null;
    quotes = new Map();
    baselineMemePremiumMultiple = 4.0; // Meme volatility requires at least 4x safe hurdle
    constructor() {
        this.seedDefaultQuotes();
    }
    seedDefaultQuotes() {
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
        });
    }
    static getInstance() {
        if (!CapitalYieldRegimeEngine.instance) {
            CapitalYieldRegimeEngine.instance = new CapitalYieldRegimeEngine();
        }
        return CapitalYieldRegimeEngine.instance;
    }
    /**
     * Register or update a yield intelligence mark from a benchmark provider.
     */
    registerYieldQuote(quote) {
        this.quotes.set(quote.providerId, quote);
    }
    /**
     * Generates an authoritative CapitalRegimeSnapshot aggregating yield intelligence
     * across Exponent, Lulo, Morpho, Aave, WealthVille, and Scallop.
     */
    createRegimeSnapshot() {
        const quotesList = Array.from(this.quotes.values());
        // 1. Solana benchmarks (Exponent, Lulo, WealthVille)
        const solanaQuotes = quotesList.filter(q => q.chainScope === 'SOLANA');
        let solanaRate = 8.0; // Default 8% staking/lending baseline if no quotes
        if (solanaQuotes.length > 0) {
            // Exclude un-audited programs from authoritative rate calculation (e.g. WealthVille un-audited warning)
            const auditedSolana = solanaQuotes.filter(q => !q.isUnaudited);
            const targets = auditedSolana.length > 0 ? auditedSolana : solanaQuotes;
            const sum = targets.reduce((acc, q) => acc + q.apyPct, 0);
            solanaRate = Number((sum / targets.length).toFixed(2));
        }
        // 2. Cross-chain reference benchmarks (Morpho, Aave, Scallop)
        const crossChainQuotes = quotesList.filter(q => q.chainScope !== 'SOLANA');
        let crossChainRate = 6.5; // Default reference
        if (crossChainQuotes.length > 0) {
            const sum = crossChainQuotes.reduce((acc, q) => acc + q.apyPct, 0);
            crossChainRate = Number((sum / crossChainQuotes.length).toFixed(2));
        }
        // Blended opportunity cost (weighted 70% Solana native, 30% cross-chain macro)
        const opportunityCostApr = Number((solanaRate * 0.7 + crossChainRate * 0.3).toFixed(2));
        // Minimum hurdle for taking meme-token risk
        const requiredMemePremium = Number((opportunityCostApr * this.baselineMemePremiumMultiple).toFixed(2));
        let regimeState;
        let opportunityScore;
        let notes;
        if (opportunityCostApr >= 14.0) {
            regimeState = 'YIELD_RICH_DEFENSIVE';
            opportunityScore = 0.85;
            notes = 'Safe yields are extremely elevated across Solana and EVM. Taking meme-token volatility risk carries high opportunity cost.';
        }
        else if (opportunityCostApr <= 6.0) {
            regimeState = 'LOW_YIELD_SPECULATIVE_FAVORABLE';
            opportunityScore = 0.25;
            notes = 'Yield environment is suppressed. Capital allocation favors selective speculative expansion if risk parameters pass.';
        }
        else {
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
            activeYieldBenchmarksCount: quotesList.length,
            regimeState,
            opportunityCostScore: opportunityScore,
            yieldQuotes: quotesList,
            isRestrictedToResearchAndAllocation: true,
            notes,
        };
    }
    /**
     * Evaluates opportunity cost for a specific token thesis:
     * "Is taking meme-token risk worthwhile relative to currently available yield?"
     *
     * Invariant: Output is purely research & allocation advice. NEVER a live trade order.
     */
    evaluateOpportunityCost(params) {
        const snapshot = this.createRegimeSnapshot();
        const hurdle = snapshot.requiredMemeRiskPremiumAprPct;
        const delta = Number((params.expectedAnnualizedReturnPct - hurdle).toFixed(2));
        const isWorthwhile = delta > 0;
        let recommendation;
        let explanation;
        if (isWorthwhile && delta >= 20.0) {
            recommendation = 'RESEARCH_EXPANSION_PERMITTED';
            explanation = `Expected annualized alpha (+${params.expectedAnnualizedReturnPct}%) clearly exceeds the risk-adjusted yield hurdle (+${hurdle}%). Speculative risk is mathematically justifiable over safe yield.`;
        }
        else if (isWorthwhile) {
            recommendation = 'RESEARCH_EXPANSION_PERMITTED';
            explanation = `Marginally exceeds yield hurdle (+${params.expectedAnnualizedReturnPct}% vs +${hurdle}% hurdle). Worthwhile under disciplined position caps only.`;
        }
        else {
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
//# sourceMappingURL=capital-regime.js.map