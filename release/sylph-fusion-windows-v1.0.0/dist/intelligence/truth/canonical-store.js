/**
 * SOL-SYLPH Authoritative Canonical Token Store & Atomic State Transaction Manager
 * Specifications: Parts XI, XII
 *
 * Enforces:
 * 1. Single authoritative CanonicalTokenState structure.
 * 2. Atomic State Transactions (StateTransaction -> affected dependency recomputation -> StateVersion++ -> publish).
 * 3. Elimination of asynchronous torn state where UI or downstream systems observe contradictory state slices.
 */
export class CanonicalTokenStore {
    tokens = new Map();
    subscribers = [];
    get(mint) {
        return this.tokens.get(mint);
    }
    getAll() {
        return Array.from(this.tokens.values());
    }
    registerToken(initial) {
        const now = initial.now ?? Date.now();
        const priceSol = initial.initialPriceSol ?? 0.000001;
        const supply = initial.initialSupply ?? 1000000000n * 1000000n;
        const mcapSol = priceSol * Number(supply / 1000000n);
        const state = {
            mint: initial.mint,
            symbol: initial.symbol,
            name: initial.name,
            stateVersion: 1,
            lastUpdatedMs: now,
            venueLifecycle: 'PUMP_CURVE',
            priceSol,
            priceUsd: priceSol * 180,
            supply,
            mcapSol,
            mcapUsd: mcapSol * 180,
            realLiquiditySol: initial.initialLiquiditySol ?? 30.0,
            executableLiquiditySol: (initial.initialLiquiditySol ?? 30.0) * 0.85,
            txCount: 0,
            buyCount: 0,
            sellCount: 0,
            volumeSol: 0,
            uniqueWalletsCount: 1,
            independentParticipantsCount: 1,
            isMintable: false,
            isFreezable: false,
            hasPermanentDelegate: false,
            isBackdoorFree: true,
            creatorAddress: initial.creatorAddress,
            creatorHoldingPct: 0.0,
            rugCheckScore: 0,
            hsi: 50,
            pumpScore: 50,
            podState: 'P',
            podTransitionTimeMs: now,
            protectionState: 'ACTIVE',
            protectionStartedMs: now,
            protectionValidUntilMs: now + 300_000,
            isGhostTown: false,
            ghostTownSafeAppearances: 0,
            auditCount: 0,
            isSolarCore: false,
            isDiamondCore: false,
            trajectory: 'STABLE',
            expectedReturn1m: 0.0,
            calibratedConfidence: 0.85,
            overallUncertainty: 0.15,
            activeEvidenceIds: [],
            explanationSummary: 'Initial token state initialized.',
        };
        this.tokens.set(initial.mint, state);
        return state;
    }
    /**
     * Part XII: Atomic State Transaction.
     * Modifies state atomically, updates StateVersion, and broadcasts consistent snapshot.
     */
    commitTransaction(tx) {
        const current = this.tokens.get(tx.mint);
        if (!current) {
            throw new Error(`Cannot commit transaction on untracked token: ${tx.mint}`);
        }
        const partial = tx.mutation(current);
        const newVersion = current.stateVersion + 1;
        // Enforce Invariant: PoD=D with ACTIVE protection is automatically resolved or flagged
        let protectionState = partial.protectionState ?? current.protectionState;
        const podState = partial.podState ?? current.podState;
        if (podState === 'D' && protectionState === 'ACTIVE') {
            protectionState = 'REVIEW';
        }
        const updated = {
            ...current,
            ...partial,
            protectionState,
            stateVersion: newVersion,
            lastUpdatedMs: tx.timestampMs,
            activeEvidenceIds: tx.evidenceIds ?? current.activeEvidenceIds,
            explanationSummary: tx.reason,
        };
        this.tokens.set(tx.mint, updated);
        // Notify projections
        for (const sub of this.subscribers) {
            try {
                sub(updated, tx);
            }
            catch (err) {
                // Bulkhead: subscriber error does not corrupt state commit
            }
        }
        return updated;
    }
    subscribe(handler) {
        this.subscribers.push(handler);
        return () => {
            const idx = this.subscribers.indexOf(handler);
            if (idx >= 0)
                this.subscribers.splice(idx, 1);
        };
    }
}
//# sourceMappingURL=canonical-store.js.map