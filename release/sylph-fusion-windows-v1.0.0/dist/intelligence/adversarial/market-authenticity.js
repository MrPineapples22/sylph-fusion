/**
 * SOL-SYLPH Market Authenticity Engine
 * Blueprint Part XVI
 *
 * Measures genuine economic activity vs synthetic manipulation.
 * Detects adversarial swarms, wash trading, fake distribution, and liquidity flashes.
 */
export class MarketAuthenticityEngine {
    evaluateAuthenticity(params) {
        const symptoms = [];
        const mint = params.mint;
        const actorRatio = params.rawWalletsCount > 0
            ? params.independentActorsCount / params.rawWalletsCount
            : 1.0;
        const econVolRatio = params.rawVolumeSol > 0
            ? params.economicVolumeSol / params.rawVolumeSol
            : 1.0;
        const washRatio = params.rawVolumeSol > 0
            ? params.washVolumeSol / params.rawVolumeSol
            : 0.0;
        if (actorRatio < 0.3) {
            symptoms.push({
                code: 'FRESH_WALLET_SWARM',
                severity: 'HIGH',
                description: `Sybil swarm: ${params.rawWalletsCount} wallets resolve to only ${params.independentActorsCount} economic actors (${(actorRatio * 100).toFixed(0)}%)`,
                confidence: 0.85,
            });
        }
        if (washRatio > 0.35) {
            symptoms.push({
                code: 'WASH_TRADING_SWARM',
                severity: 'CRITICAL',
                description: `High wash trading volume: ${(washRatio * 100).toFixed(0)}% of volume is self-dealing transactions`,
                confidence: 0.9,
            });
        }
        if (params.hasSingleFunderSwarm) {
            symptoms.push({
                code: 'SINGLE_FUNDER_SWARM',
                severity: 'CRITICAL',
                description: 'Multiple buyer wallets funded by single upstream treasury within short temporal window',
                confidence: 0.95,
            });
        }
        if (params.hasBundleCluster) {
            symptoms.push({
                code: 'BUNDLE_CLUSTER_SNIPER',
                severity: 'HIGH',
                description: 'Jito atomic bundle detected at genesis capturing majority supply',
                confidence: 0.9,
            });
        }
        if (params.hasLiquidityFlash) {
            symptoms.push({
                code: 'LIQUIDITY_FLASH_RISK',
                severity: 'CRITICAL',
                description: 'Liquidity addition accompanied by unlocked LP and rapid withdrawal triggers',
                confidence: 0.88,
            });
        }
        if (params.hasCoordinatedExits) {
            symptoms.push({
                code: 'COORDINATED_EXIT_SWARM',
                severity: 'CRITICAL',
                description: 'Related wallets executing simultaneous cascade sells',
                confidence: 0.92,
            });
        }
        if (params.hasDevReentry) {
            symptoms.push({
                code: 'DEV_REENTRY_DETECTED',
                severity: 'HIGH',
                description: 'Dev wallet re-accumulating supply under obfuscated alternate address',
                confidence: 0.8,
            });
        }
        const fundingDiversity = Math.min(1.0, actorRatio * 0.7 + params.freshCapitalRatio * 0.3);
        const liqPersistence = params.liquidityPersistenceMs && params.liquidityPersistenceMs > 60000 ? 0.9 : 0.6;
        const tempPersistence = 0.8;
        let penalty = 0;
        for (const s of symptoms) {
            if (s.severity === 'CRITICAL')
                penalty += 0.35;
            else if (s.severity === 'HIGH')
                penalty += 0.2;
            else
                penalty += 0.1;
        }
        const baseScore = (actorRatio * 0.3 + econVolRatio * 0.3 + fundingDiversity * 0.2 + liqPersistence * 0.2);
        const overallScore = Math.max(0.0, Math.min(1.0, baseScore - penalty));
        return {
            mint,
            overallAuthenticityScore: Number(overallScore.toFixed(3)),
            independentActorRatio: Number(actorRatio.toFixed(3)),
            economicVolumeRatio: Number(econVolRatio.toFixed(3)),
            fundingDiversityScore: Number(fundingDiversity.toFixed(3)),
            liquidityPersistenceScore: liqPersistence,
            temporalPersistenceScore: tempPersistence,
            manipulationSymptoms: symptoms,
            isOrganic: overallScore >= 0.6 && symptoms.filter(s => s.severity === 'CRITICAL').length === 0,
        };
    }
}
//# sourceMappingURL=market-authenticity.js.map