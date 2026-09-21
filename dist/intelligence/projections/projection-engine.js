/**
 * SOL-SYLPH Projection Engine, Universal Why System & UI Command Bus
 * Specifications: Parts XCV, XCVI, XCVII, XCVIII, XCIX - CVI, XCIII
 *
 * Enforces:
 * 1. UI consumes dedicated Projections only (TokenTableProjection, TokenInspectorProjection, AlertProjection).
 * 2. Incremental rendering with dirty_tokens and dirty_fields.
 * 3. Universal "Why?" Engine: explains Why Pump? Why HSI? Why PoD? Why Protected? What changed? What matters? What is uncertain?
 * 4. UI Command Bus: All user actions flow through domain commands -> events -> state -> projection. Never direct state mutation from widgets.
 */
export class UniversalWhyEngine {
    explainToken(state) {
        const whatChanged = [
            `Liquidity marked at ${state.realLiquiditySol.toFixed(1)} SOL`,
            `HSI evaluated at ${state.hsi.toFixed(1)}`,
            `PoD in ${state.podState} state`,
        ];
        const whatMatters = [
            state.realLiquiditySol < 15 ? 'Critical: Real liquidity below safety floor' : 'Liquidity healthy',
            state.creatorHoldingPct > 10 ? 'Warning: Elevated creator concentration' : 'Creator holding safe',
        ];
        const whatIsUncertain = [
            state.overallUncertainty > 0.40 ? 'High model uncertainty on current curve trajectory' : 'Model confidence high',
            state.rugCheckScore > 30 ? 'Contract capability ambiguity detected' : 'Token capabilities verified',
        ];
        const whatConflicts = [];
        if (state.pumpScore > 70 && state.hsi < 35) {
            whatConflicts.push('PumpScore spike contradicts weak holder organic score (HSI)');
        }
        const whatBreaksThis = [
            'Liquidity drainage > 5.0 SOL in a single block',
            'Creator selling more than 2% of total supply',
            'PoD transition to Dump (D)',
        ];
        return {
            mint: state.mint,
            whyPump: `PumpScore ${state.pumpScore}: driven by ${state.txCount} txs and ${state.realLiquiditySol.toFixed(1)} SOL liquidity`,
            whyHsi: `HSI ${state.hsi}: calculated across 7 evidence families with ${state.independentParticipantsCount} independent participants`,
            whyPod: `PoD ${state.podState}: ${state.podState === 'P' ? 'Sustained buying momentum' : state.podState === 'D' ? 'Aggressive sniper dumping detected' : 'Neutral consolidation'}`,
            whyProtected: `Protection ${state.protectionState}: lease valid for ${Math.max(0, (state.protectionValidUntilMs - Date.now()) / 1000).toFixed(0)}s`,
            whatChanged,
            whatMatters,
            whatIsUncertain,
            whatConflicts,
            whatHappensNext: state.trajectory === 'IMPROVING' ? '↑ Strengthening' : state.trajectory === 'WEAKENING' ? '↓ Weakening' : '→ Stable consolidation',
            whatBreaksThis,
        };
    }
}
// --- Part XCVI & XCVII: Projection Engine with Incremental Rendering ---
export class ProjectionEngine {
    dirtyTokens = new Set();
    cachedTableRows = new Map();
    whyEngine = new UniversalWhyEngine();
    markDirty(mint) {
        this.dirtyTokens.add(mint);
    }
    getDirtyCount() {
        return this.dirtyTokens.size;
    }
    projectTokenRow(state) {
        const row = {
            mint: state.mint,
            symbol: state.symbol,
            timeFormatted: new Date(state.lastUpdatedMs).toLocaleTimeString(),
            txs: state.txCount,
            mcapFormatted: `$${(state.mcapUsd / 1000).toFixed(1)}K`,
            liquidityFormatted: `${state.realLiquiditySol.toFixed(1)} SOL`,
            auditsFormatted: state.isDiamondCore ? 'DIAMOND' : state.isSolarCore ? 'SOLAR' : `A${state.auditCount}`,
            rugFormatted: state.rugCheckScore > 30 ? 'WARN' : 'GOOD',
            hsiFormatted: `${state.hsi.toFixed(0)}`,
            statusBadge: state.protectionState,
            stateVersion: state.stateVersion,
        };
        this.cachedTableRows.set(state.mint, row);
        this.dirtyTokens.delete(state.mint);
        return row;
    }
    projectTable(states) {
        return states.map(s => this.projectTokenRow(s));
    }
}
export class CommandBus {
    commandHistory = [];
    handlers = new Map();
    registerHandler(type, handler) {
        this.handlers.set(type, handler);
    }
    dispatch(command) {
        this.commandHistory.push(command);
        const handler = this.handlers.get(command.type);
        if (!handler) {
            return { accepted: false, reason: `No registered handler for command ${command.type}` };
        }
        try {
            handler(command);
            return { accepted: true };
        }
        catch (err) {
            return { accepted: false, reason: err instanceof Error ? err.message : String(err) };
        }
    }
    getHistory() {
        return this.commandHistory;
    }
}
//# sourceMappingURL=projection-engine.js.map