/**
 * SOL-SYLPH Structural Divergence Engine
 * Blueprint Part XX
 *
 * Detects structural decouplings where price contradicts fundamental market mechanics:
 * - PRICE ↑ / STRUCTURE ↓
 * - PRICE ↓ / STRUCTURE ↑
 * - PRICE ↑ / FRESH CAPITAL ↓
 * - PRICE ↑ / EXIT CAPACITY ↓
 * - PRICE ↑ / INDEPENDENT ACTORS ↓
 * - PRICE FLAT / STRUCTURE ↑
 */

export type DivergenceType =
  | 'PRICE_UP_STRUCTURE_DOWN'
  | 'PRICE_DOWN_STRUCTURE_UP'
  | 'PRICE_UP_FRESH_CAPITAL_DOWN'
  | 'PRICE_UP_EXIT_CAPACITY_DOWN'
  | 'PRICE_UP_INDEPENDENT_ACTORS_DOWN'
  | 'PRICE_FLAT_STRUCTURE_UP';

export interface DivergenceObservation {
  readonly type: DivergenceType;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  readonly description: string;
  readonly priceVelocity: number;
  readonly structuralVelocity: number;
  readonly detectedAtMs: number;
}

export interface DivergenceReport {
  readonly mint: string;
  readonly divergences: readonly DivergenceObservation[];
  readonly hasBearishDivergence: boolean;
  readonly hasBullishDivergence: boolean;
  readonly highestSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'NONE';
  readonly summary: string;
}

export class StructuralDivergenceEngine {
  public evaluateDivergence(params: {
    mint: string;
    priceVelocity: number;           // % change/s
    structuralHealthVelocity: number; // rate of change of structural score
    freshCapitalVelocity: number;
    exitCapacityVelocity: number;
    independentActorsVelocity: number;
  }): DivergenceReport {
    const divergences: DivergenceObservation[] = [];
    const now = Date.now();
    const mint = params.mint;

    // 1. PRICE ↑ / STRUCTURE ↓ (Classic Exit Pump / Trap)
    if (params.priceVelocity > 0.1 && params.structuralHealthVelocity < -0.1) {
      divergences.push({
        type: 'PRICE_UP_STRUCTURE_DOWN',
        severity: 'CRITICAL',
        description: 'Price rising while underlying structure deteriorating (Exit liquidity trap)',
        priceVelocity: params.priceVelocity,
        structuralVelocity: params.structuralHealthVelocity,
        detectedAtMs: now,
      });
    }

    // 2. PRICE ↑ / FRESH CAPITAL ↓ (Recycled Wash / Insider Markup)
    if (params.priceVelocity > 0.1 && params.freshCapitalVelocity < -0.05) {
      divergences.push({
        type: 'PRICE_UP_FRESH_CAPITAL_DOWN',
        severity: 'HIGH',
        description: 'Price rising on negative fresh capital (Recycled capital pump)',
        priceVelocity: params.priceVelocity,
        structuralVelocity: params.freshCapitalVelocity,
        detectedAtMs: now,
      });
    }

    // 3. PRICE ↑ / EXIT CAPACITY ↓ (Liquidity Trap)
    if (params.priceVelocity > 0.05 && params.exitCapacityVelocity < -0.1) {
      divergences.push({
        type: 'PRICE_UP_EXIT_CAPACITY_DOWN',
        severity: 'CRITICAL',
        description: 'Price rising while executable exit capacity shrinking rapidly',
        priceVelocity: params.priceVelocity,
        structuralVelocity: params.exitCapacityVelocity,
        detectedAtMs: now,
      });
    }

    // 4. PRICE ↑ / INDEPENDENT ACTORS ↓ (Concentration Pump)
    if (params.priceVelocity > 0.05 && params.independentActorsVelocity < -0.05) {
      divergences.push({
        type: 'PRICE_UP_INDEPENDENT_ACTORS_DOWN',
        severity: 'HIGH',
        description: 'Price rising while retail participants exiting and supply concentrating',
        priceVelocity: params.priceVelocity,
        structuralVelocity: params.independentActorsVelocity,
        detectedAtMs: now,
      });
    }

    // 5. PRICE ↓ / STRUCTURE ↑ (Capitulation Absorption / Value Compression)
    if (params.priceVelocity < -0.1 && params.structuralHealthVelocity > 0.1) {
      divergences.push({
        type: 'PRICE_DOWN_STRUCTURE_UP',
        severity: 'MEDIUM',
        description: 'Price falling while structural authenticity and decentralization improving (Whale dump absorbed)',
        priceVelocity: params.priceVelocity,
        structuralVelocity: params.structuralHealthVelocity,
        detectedAtMs: now,
      });
    }

    // 6. PRICE FLAT / STRUCTURE ↑ (Stealth Accumulation)
    if (Math.abs(params.priceVelocity) <= 0.05 && params.structuralHealthVelocity > 0.15) {
      divergences.push({
        type: 'PRICE_FLAT_STRUCTURE_UP',
        severity: 'MEDIUM',
        description: 'Price flat while independent actors and fresh liquidity expanding (Stealth accumulation)',
        priceVelocity: params.priceVelocity,
        structuralVelocity: params.structuralHealthVelocity,
        detectedAtMs: now,
      });
    }

    const hasBearish = divergences.some(d =>
      d.type === 'PRICE_UP_STRUCTURE_DOWN' ||
      d.type === 'PRICE_UP_FRESH_CAPITAL_DOWN' ||
      d.type === 'PRICE_UP_EXIT_CAPACITY_DOWN' ||
      d.type === 'PRICE_UP_INDEPENDENT_ACTORS_DOWN'
    );
    const hasBullish = divergences.some(d =>
      d.type === 'PRICE_DOWN_STRUCTURE_UP' ||
      d.type === 'PRICE_FLAT_STRUCTURE_UP'
    );

    let highestSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'NONE' = 'NONE';
    if (divergences.some(d => d.severity === 'CRITICAL')) highestSeverity = 'CRITICAL';
    else if (divergences.some(d => d.severity === 'HIGH')) highestSeverity = 'HIGH';
    else if (divergences.some(d => d.severity === 'MEDIUM')) highestSeverity = 'MEDIUM';

    const summary = divergences.length > 0
      ? divergences.map(d => `${d.type} (${d.severity})`).join('; ')
      : 'No structural divergences detected; price moving in harmony with evidence.';

    return {
      mint,
      divergences,
      hasBearishDivergence: hasBearish,
      hasBullishDivergence: hasBullish,
      highestSeverity,
      summary,
    };
  }
}
