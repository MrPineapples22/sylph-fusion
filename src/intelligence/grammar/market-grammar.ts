/**
 * SOL-SYLPH Intelligence Fabric - Market Grammar & Latent State Engine
 * Specifications: Master Blueprint Sections 15 & 18, Priority Item 19.
 *
 * Implements:
 * 1. Market Grammar-X:
 *    Sequential motif analysis treating event order as primary information:
 *    - EventMotif sequence extraction
 *    - SequenceSurprise & SequenceCoherence estimation
 *    - MotifOutcomeEntropy
 * 2. Latent-State Intelligence:
 *    Probabilistic distribution over unobservable hidden market states:
 *    - ORGANIC_EXPANSION
 *    - COORDINATED_PUMP
 *    - CREATOR_DISTRIBUTION
 *    - WHALE_ACCUMULATION
 *    - LIQUIDITY_TRAP
 *    - BUYER_EXHAUSTION
 *    - POST_MIGRATION_DISCOVERY
 *    - UNKNOWN
 *    Never collapses to a single binary state when multiple hypotheses remain plausible.
 */

import { createHash } from 'node:crypto';

export type GrammarEventType =
  | 'CREATOR_INIT'
  | 'INSIDER_BUY'
  | 'SYBIL_SWARM'
  | 'PRICE_SPIKE'
  | 'ORGANIC_BUY'
  | 'LIQUIDITY_ADD'
  | 'REPEAT_BUY'
  | 'WHALE_ENTRY'
  | 'CREATOR_SELL'
  | 'PANIC_SELL'
  | 'AMM_MIGRATION';

export interface GrammarEvent {
  readonly type: GrammarEventType;
  readonly entityId: string;
  readonly solAmount: number;
  readonly slot: number;
  readonly timestampMs: number;
}

export type LatentMarketState =
  | 'ORGANIC_EXPANSION'
  | 'COORDINATED_PUMP'
  | 'CREATOR_DISTRIBUTION'
  | 'WHALE_ACCUMULATION'
  | 'LIQUIDITY_TRAP'
  | 'BUYER_EXHAUSTION'
  | 'POST_MIGRATION_DISCOVERY'
  | 'UNKNOWN';

export interface LatentStateDistribution {
  readonly organicExpansion: number;
  readonly coordinatedPump: number;
  readonly creatorDistribution: number;
  readonly whaleAccumulation: number;
  readonly liquidityTrap: number;
  readonly buyerExhaustion: number;
  readonly postMigrationDiscovery: number;
  readonly unknown: number;
}

export interface MarketGrammarState {
  readonly mint: string;
  readonly recentMotif: readonly GrammarEventType[];
  readonly sequenceSurpriseScore: number; // 0.0 - 1.0 (deviation from organic canonical grammar)
  readonly sequenceCoherenceScore: number; // 0.0 - 1.0 (internal consistency of narrative)
  readonly motifOutcomeEntropy: number; // Information entropy over prospective outcomes
  readonly latentStateDistribution: LatentStateDistribution;
  readonly primaryLatentHypothesis: LatentMarketState;
  readonly grammarDigest: string;
}

export class MarketGrammarEngine {
  private readonly eventSequences = new Map<string, GrammarEvent[]>();

  // Canonical organic motif transitions vs synthetic manipulation patterns
  public static readonly SUSPICIOUS_PATTERNS: readonly GrammarEventType[][] = [
    ['INSIDER_BUY', 'PRICE_SPIKE', 'SYBIL_SWARM', 'CREATOR_SELL'],
    ['CREATOR_INIT', 'INSIDER_BUY', 'PRICE_SPIKE', 'CREATOR_SELL'],
    ['SYBIL_SWARM', 'PRICE_SPIKE', 'PANIC_SELL'],
  ];

  public recordEvent(mint: string, event: GrammarEvent): void {
    let list = this.eventSequences.get(mint);
    if (!list) {
      list = [];
      this.eventSequences.set(mint, list);
    }
    list.push(event);
    if (list.length > 50) list.shift();
  }

  /**
   * Analyzes sequential event grammar and computes the latent state probability distribution.
   */
  public evaluateGrammar(mint: string): MarketGrammarState {
    const events = this.eventSequences.get(mint) ?? [];
    const recentMotif = events.slice(-8).map(e => e.type);

    let surprise = 0.20;
    let coherence = 0.80;

    // Check for suspicious hostile motifs
    const motifStr = recentMotif.join('->');
    let matchedHostile = false;

    for (const pattern of MarketGrammarEngine.SUSPICIOUS_PATTERNS) {
      if (motifStr.includes(pattern.join('->'))) {
        matchedHostile = true;
        surprise += 0.50;
        coherence -= 0.30;
        break;
      }
    }

    // Evaluate organic buyer sequences: ORGANIC_BUY -> REPEAT_BUY -> LIQUIDITY_ADD
    const organicScore = recentMotif.filter(t => t === 'ORGANIC_BUY' || t === 'REPEAT_BUY' || t === 'LIQUIDITY_ADD').length / Math.max(1, recentMotif.length);
    const insiderScore = recentMotif.filter(t => t === 'INSIDER_BUY' || t === 'SYBIL_SWARM' || t === 'CREATOR_SELL').length / Math.max(1, recentMotif.length);

    // Compute Latent State Probabilities
    let pOrganic = Math.min(0.95, organicScore * 1.2);
    let pPump = matchedHostile ? 0.70 : Math.min(0.85, insiderScore * 1.1);
    let pCreatorDist = recentMotif.includes('CREATOR_SELL') ? 0.75 : 0.05;
    let pWhale = recentMotif.filter(t => t === 'WHALE_ENTRY').length > 0 ? 0.45 : 0.05;
    let pTrap = matchedHostile && recentMotif.includes('LIQUIDITY_ADD') ? 0.55 : 0.10;
    let pExhaustion = recentMotif.filter(t => t === 'PANIC_SELL').length > 0 ? 0.50 : 0.08;
    let pPostMig = recentMotif.includes('AMM_MIGRATION') ? 0.80 : 0.02;
    let pUnknown = events.length < 5 ? 0.60 : 0.10;

    // Normalize distribution
    const sum = pOrganic + pPump + pCreatorDist + pWhale + pTrap + pExhaustion + pPostMig + pUnknown;
    const latentDistribution: LatentStateDistribution = {
      organicExpansion: Number((pOrganic / sum).toFixed(3)),
      coordinatedPump: Number((pPump / sum).toFixed(3)),
      creatorDistribution: Number((pCreatorDist / sum).toFixed(3)),
      whaleAccumulation: Number((pWhale / sum).toFixed(3)),
      liquidityTrap: Number((pTrap / sum).toFixed(3)),
      buyerExhaustion: Number((pExhaustion / sum).toFixed(3)),
      postMigrationDiscovery: Number((pPostMig / sum).toFixed(3)),
      unknown: Number((pUnknown / sum).toFixed(3)),
    };

    // Calculate outcome entropy: H = - sum(p * log2(p))
    let entropy = 0;
    for (const val of Object.values(latentDistribution)) {
      if (val > 0.001) entropy -= val * Math.log2(val);
    }
    const motifOutcomeEntropy = Number(entropy.toFixed(3));

    // Determine primary hypothesis
    let primaryLatentHypothesis: LatentMarketState = 'UNKNOWN';
    let maxP = 0;
    const entries: [LatentMarketState, number][] = [
      ['ORGANIC_EXPANSION', latentDistribution.organicExpansion],
      ['COORDINATED_PUMP', latentDistribution.coordinatedPump],
      ['CREATOR_DISTRIBUTION', latentDistribution.creatorDistribution],
      ['WHALE_ACCUMULATION', latentDistribution.whaleAccumulation],
      ['LIQUIDITY_TRAP', latentDistribution.liquidityTrap],
      ['BUYER_EXHAUSTION', latentDistribution.buyerExhaustion],
      ['POST_MIGRATION_DISCOVERY', latentDistribution.postMigrationDiscovery],
      ['UNKNOWN', latentDistribution.unknown],
    ];

    for (const [state, p] of entries) {
      if (p > maxP) {
        maxP = p;
        primaryLatentHypothesis = state;
      }
    }

    const sequenceSurpriseScore = Number(Math.min(1.0, Math.max(0.0, surprise)).toFixed(3));
    const sequenceCoherenceScore = Number(Math.min(1.0, Math.max(0.0, coherence)).toFixed(3));

    const grammarDigest = createHash('sha256')
      .update('MARKET_GRAMMAR:')
      .update(mint)
      .update(recentMotif.join(','))
      .update(primaryLatentHypothesis)
      .update(motifOutcomeEntropy.toString())
      .digest('hex');

    return {
      mint,
      recentMotif: Object.freeze(recentMotif),
      sequenceSurpriseScore,
      sequenceCoherenceScore,
      motifOutcomeEntropy,
      latentStateDistribution: latentDistribution,
      primaryLatentHypothesis,
      grammarDigest,
    };
  }
}
