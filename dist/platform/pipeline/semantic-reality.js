/**
 * SYLPH FUSION — SEMANTIC REALITY & MARKET AUTHENTICITY LAYER
 * Specifications: Prompt 24 (Semantic Reality Layer),
 *                 Prompt 25 (Market Authenticity),
 *                 Prompt 26 (Point-in-Time Feature Snapshot)
 *
 * Requirements:
 * 1. Establish semantic correctness before intelligence evaluates a token/market.
 * 2. Token-2022 extensions: transfer hooks, permanent delegate, withheld fees, confidential transfers.
 * 3. Unknown or dangerous token semantics reduce authority or quarantine execution.
 * 4. Separate raw market volume from authentic market movement (wash/recirculation/Sybil detection).
 * 5. Immutable point-in-time feature snapshots strictly bound to knownAt <= decisionAt.
 */
import { hashCanonical } from './canonical-hashing.js';
export class SemanticRealityLayer {
    /**
     * Evaluates Token-2022 extensions, ALTs, program upgrade epochs, and account lifecycle.
     * Quarantines tokens with unsupported or malicious semantics.
     */
    resolveSemanticReality(tokenMint, token2022, altSpec, programEpoch, resolvedAt = new Date().toISOString()) {
        let isPermitted = true;
        let quarantineReason;
        // Safety Invariant 1: Unverified transfer hook -> Veto/Quarantine
        if (token2022.hasTransferHook && !token2022.isHookVerifiedSafe) {
            isPermitted = false;
            quarantineReason = `UNVERIFIED_TRANSFER_HOOK: Program ${token2022.hookProgramId ?? 'UNKNOWN'} is not certified`;
        }
        // Safety Invariant 2: Permanent delegate present -> Veto (centralized authority to seize/burn)
        if (token2022.hasPermanentDelegate) {
            isPermitted = false;
            quarantineReason = `PERMANENT_DELEGATE_DETECTED: Address ${token2022.permanentDelegateAddress ?? 'UNKNOWN'} has seizure authority`;
        }
        // Safety Invariant 3: Default account state frozen -> Veto
        if (token2022.isDefaultAccountStateFrozen) {
            isPermitted = false;
            quarantineReason = 'DEFAULT_ACCOUNT_FROZEN: Mint creates frozen token accounts by default';
        }
        // Safety Invariant 4: Excessive transfer fees (> 1000 bps = 10%)
        if (token2022.hasTransferFee && (token2022.transferFeeBasisPoints ?? 0) > 1000) {
            isPermitted = false;
            quarantineReason = `EXCESSIVE_TRANSFER_FEE: Fee of ${token2022.transferFeeBasisPoints} bps exceeds 1000 bps maximum`;
        }
        const tokenSemanticsRoot = hashCanonical(token2022);
        const programEpochRoot = hashCanonical(programEpoch ?? { status: 'PROGRAM_EPOCH_DEFAULT_SPL' });
        const accountResolutionRoot = hashCanonical(altSpec ?? { status: 'ALT_RESOLUTION_STANDARD_V0' });
        const semanticStatePreimage = {
            tokenMint,
            isPermittedForExecution: isPermitted,
            quarantineReason,
            tokenSemanticsRoot,
            programEpochRoot,
            accountResolutionRoot,
            resolvedAt,
        };
        const semanticStateRoot = hashCanonical(semanticStatePreimage);
        return Object.freeze({
            tokenMint,
            isPermittedForExecution: isPermitted,
            quarantineReason,
            tokenSemanticsRoot,
            programEpochRoot,
            accountResolutionRoot,
            semanticStateRoot,
            resolvedAt,
        });
    }
}
export class MarketAuthenticityEngine {
    /**
     * Distinguishes authentic market movement from coordinated Sybil recirculation.
     * Produces authenticityRoot, actorGraphRoot, and marketStateRoot.
     */
    evaluateAuthenticity(tokenMint, rawReportedVolumeLamports, actors, liquidityLamports, analyzedAt = new Date().toISOString()) {
        let recirculatedVolumeLamports = 0n;
        for (const actor of actors) {
            if (actor.isSybilClusterMember) {
                recirculatedVolumeLamports += actor.buyVolumeLamports + actor.sellVolumeLamports;
            }
        }
        const effectiveRecirculation = recirculatedVolumeLamports > rawReportedVolumeLamports
            ? rawReportedVolumeLamports
            : recirculatedVolumeLamports;
        const authenticVolumeLamports = rawReportedVolumeLamports - effectiveRecirculation;
        const recirculationRatioPct = rawReportedVolumeLamports > 0n
            ? Number((effectiveRecirculation * 100n) / rawReportedVolumeLamports)
            : 0;
        // Authenticity score: 100% minus recirculation penalties
        const authenticityScore = Math.max(0, 100 - recirculationRatioPct);
        const isAuthentic = authenticityScore >= 80 && recirculationRatioPct <= 20;
        const actorGraphRoot = hashCanonical(actors);
        const marketStatePreimage = {
            tokenMint,
            liquidityLamports,
            rawReportedVolumeLamports,
            authenticVolumeLamports,
            recirculationRatioPct,
            isAuthentic,
        };
        const marketStateRoot = hashCanonical(marketStatePreimage);
        const authenticityPreimage = {
            tokenMint,
            authenticityScore,
            isAuthentic,
            actorGraphRoot,
            marketStateRoot,
            analyzedAt,
        };
        const authenticityRoot = hashCanonical(authenticityPreimage);
        return Object.freeze({
            tokenMint,
            rawReportedVolumeLamports,
            authenticVolumeLamports,
            recirculationRatioPct,
            authenticityScore,
            isAuthentic,
            authenticityRoot,
            actorGraphRoot,
            marketStateRoot,
            analyzedAt,
        });
    }
}
export class PointInTimeFeatureCompiler {
    /**
     * Compiles an immutable point-in-time feature snapshot.
     * Strictly enforces knownAt <= decisionAt to prevent future information leakage.
     */
    compileFeatureSnapshot(input) {
        const knownAtTime = new Date(input.knownAt).getTime();
        const decisionAtTime = new Date(input.decisionAt).getTime();
        // Lookahead bias prevention invariant (Prompt 21 & Prompt 26)
        if (knownAtTime > decisionAtTime) {
            throw new Error(`LOOKAHEAD_BIAS_ERROR: Feature knownAt (${input.knownAt}) is in the future relative to decisionAt (${input.decisionAt})`);
        }
        const featureSnapshotPreimage = {
            economicFactId: input.economicFactId,
            slot: input.slot,
            knownAt: input.knownAt,
            decisionAt: input.decisionAt,
            hsiScore: input.hsiScore,
            pumpScore: input.pumpScore,
            podScore: input.podScore,
            regime: input.regime,
            authenticityScore: input.authenticityScore,
            localizedContentionBps: input.localizedContentionBps,
            leaderAffinityScore: input.leaderAffinityScore,
            featureVersions: input.featureVersions,
        };
        const featureSnapshotRoot = hashCanonical(featureSnapshotPreimage);
        const featureHash = hashCanonical({
            featureSnapshotRoot,
            economicFactId: input.economicFactId,
            slot: input.slot,
        });
        return Object.freeze({
            economicFactId: input.economicFactId,
            slot: input.slot,
            knownAt: input.knownAt,
            decisionAt: input.decisionAt,
            featureSnapshotRoot,
            featureHash,
        });
    }
}
//# sourceMappingURL=semantic-reality.js.map