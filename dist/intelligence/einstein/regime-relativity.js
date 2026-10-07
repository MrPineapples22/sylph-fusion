/**
 * SOL-SYLPH EINSTEIN — Reference-Frame, Regime Relativity & Context Normalization
 * Part XI — 11 Explicit Reference Frames, Raw + Normalized Storage & Relativistic Signals
 */
export class EinsteinRelativityEngine {
    normalizationVersion = 'einstein_relativity_v1.0';
    /**
     * Normalize raw token telemetry against appropriate reference frames.
     */
    normalizeContext(params) {
        if (!Number.isSafeInteger(params.decision_at_ms) || params.decision_at_ms < 0) {
            throw new RangeError('decision_at_ms must be a nonnegative safe integer');
        }
        if (typeof params.token_age_sec !== 'number' || !Number.isFinite(params.token_age_sec) || params.token_age_sec < 0) {
            throw new RangeError('token_age_sec must be a nonnegative finite number');
        }
        const velocity = params.velocity_observation;
        if (velocity && (!Number.isSafeInteger(velocity.transactionCount) || velocity.transactionCount < 0 ||
            !Number.isSafeInteger(velocity.windowStartMs) || !Number.isSafeInteger(velocity.windowEndMs) ||
            !Number.isSafeInteger(velocity.observedAtMs) || velocity.windowStartMs < 0 ||
            velocity.windowEndMs <= velocity.windowStartMs || velocity.observedAtMs < velocity.windowEndMs ||
            velocity.observedAtMs > params.decision_at_ms || typeof velocity.observationId !== 'string' || !velocity.observationId.trim())) {
            throw new RangeError('velocity_observation is invalid or unavailable at decision time');
        }
        const liquidityMarketCap = params.liquidity_market_cap_observation;
        if (liquidityMarketCap && (!Number.isFinite(liquidityMarketCap.liquiditySol) || liquidityMarketCap.liquiditySol <= 0 ||
            !Number.isFinite(liquidityMarketCap.marketCapSol) || liquidityMarketCap.marketCapSol <= 0 ||
            !Number.isSafeInteger(liquidityMarketCap.observedAtMs) || liquidityMarketCap.observedAtMs < 0 ||
            liquidityMarketCap.observedAtMs > params.decision_at_ms || typeof liquidityMarketCap.observationId !== 'string' || !liquidityMarketCap.observationId.trim())) {
            throw new RangeError('liquidity_market_cap_observation is invalid or unavailable at decision time');
        }
        const volume = params.volume_observation;
        if (volume && (!Number.isFinite(volume.volumeSol) || volume.volumeSol < 0 ||
            !Number.isSafeInteger(volume.windowStartMs) || !Number.isSafeInteger(volume.windowEndMs) ||
            !Number.isSafeInteger(volume.observedAtMs) || volume.windowStartMs < 0 ||
            volume.windowEndMs <= volume.windowStartMs || volume.observedAtMs < volume.windowEndMs ||
            volume.observedAtMs > params.decision_at_ms || typeof volume.observationId !== 'string' || !volume.observationId.trim())) {
            throw new RangeError('volume_observation is invalid or unavailable at decision time');
        }
        const relativeReturn = params.relative_return_1h;
        if (relativeReturn && (relativeReturn.returnCurrency !== 'USD' || !Number.isFinite(relativeReturn.tokenReturnPct) ||
            !Number.isFinite(relativeReturn.solReturnPct) || relativeReturn.tokenReturnPct < -100 || relativeReturn.solReturnPct <= -100 ||
            !Number.isSafeInteger(relativeReturn.windowStartMs) || !Number.isSafeInteger(relativeReturn.windowEndMs) ||
            !Number.isSafeInteger(relativeReturn.observedAtMs) || relativeReturn.windowStartMs < 0 ||
            relativeReturn.windowEndMs - relativeReturn.windowStartMs !== 3_600_000 ||
            relativeReturn.observedAtMs < relativeReturn.windowEndMs || relativeReturn.observedAtMs > params.decision_at_ms ||
            typeof relativeReturn.observationId !== 'string' || !relativeReturn.observationId.trim())) {
            throw new RangeError('relative_return_1h must be a paired one-hour observation available at decision time');
        }
        const slippage = params.slippage_quote;
        if (slippage && (!Number.isSafeInteger(slippage.slippageBps) || slippage.slippageBps < 0 || slippage.slippageBps > 10_000 ||
            typeof slippage.tradeSizeLamports !== 'string' || !/^[1-9][0-9]*$/.test(slippage.tradeSizeLamports) ||
            typeof slippage.routeId !== 'string' || !slippage.routeId.trim() || !Number.isSafeInteger(slippage.quotedAtMs) ||
            slippage.quotedAtMs < 0 || slippage.quotedAtMs > params.decision_at_ms ||
            !Number.isSafeInteger(slippage.validUntilMs) || slippage.validUntilMs < params.decision_at_ms ||
            typeof slippage.observationId !== 'string' || !slippage.observationId.trim())) {
            throw new RangeError('slippage_quote must be a size-specific quote available at decision time');
        }
        // Missing market history or executable quotes stay unknown; no liquidity-derived proxy is substituted.
        const liquiditySol = liquidityMarketCap?.liquiditySol ?? null;
        const marketCapSol = liquidityMarketCap?.marketCapSol ?? null;
        const poolRatio = liquiditySol === null || marketCapSol === null ? null : liquiditySol / marketCapSol;
        const normalizedLiqRatio = poolRatio === null ? null : Math.min(1.0, poolRatio / 0.25);
        const turnover = volume && liquiditySol !== null ? volume.volumeSol / liquiditySol : null;
        const normalizedTurnover = turnover === null ? null : Math.min(1.0, turnover / 5.0);
        const excessReturn = relativeReturn
            ? ((1 + relativeReturn.tokenReturnPct / 100) / (1 + relativeReturn.solReturnPct / 100) - 1) * 100
            : null;
        const normalizedExcess = excessReturn === null ? null : 1 / (1 + Math.exp(-excessReturn / 10));
        const expectedImpactBps = liquiditySol === null ? null : (1.0 / Math.max(0.1, liquiditySol)) * 100;
        const normalizedSlippage = slippage && expectedImpactBps !== null ? Math.min(1.0, slippage.slippageBps / Math.max(10, expectedImpactBps)) : null;
        const now = Date.now();
        return {
            mint: params.mint,
            velocity_by_age: velocity ? {
                signal_name: 'tx_velocity_by_age',
                availability: 'OBSERVED',
                absolute_value: Number((velocity.transactionCount / ((velocity.windowEndMs - velocity.windowStartMs) / 1000)).toFixed(2)),
                normalized_value: Number(Math.min(1, (velocity.transactionCount / ((velocity.windowEndMs - velocity.windowStartMs) / 1000)) / Math.max(0.1, 20 / Math.sqrt(Math.max(1, params.token_age_sec)))).toFixed(3)),
                reference_frame: 'AGE_FRAME',
                reference_population: 'Tokens_Age_Cohort_<5m',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                evidenceId: velocity.observationId,
                sourceObservedAtMs: velocity.observedAtMs,
                windowStartMs: velocity.windowStartMs,
                windowEndMs: velocity.windowEndMs,
                uncertainty: 0.1,
            } : {
                signal_name: 'tx_velocity_by_age', availability: 'UNAVAILABLE', absolute_value: null, normalized_value: null,
                reference_frame: 'AGE_FRAME', reference_population: 'Tokens_Age_Cohort_<5m',
                normalization_version: this.normalizationVersion, context_timestamp_ms: now, uncertainty: null,
            },
            liquidity_by_mcap: liquidityMarketCap ? {
                signal_name: 'liquidity_to_mcap_ratio',
                availability: 'OBSERVED',
                absolute_value: Number(poolRatio.toFixed(3)),
                normalized_value: Number(normalizedLiqRatio.toFixed(3)),
                reference_frame: 'LIQUIDITY_FRAME',
                reference_population: 'Bonding_Curve_Pairs',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                evidenceId: liquidityMarketCap.observationId,
                sourceObservedAtMs: liquidityMarketCap.observedAtMs,
                uncertainty: 0.05,
            } : {
                signal_name: 'liquidity_to_mcap_ratio', availability: 'UNAVAILABLE', absolute_value: null, normalized_value: null,
                reference_frame: 'LIQUIDITY_FRAME', reference_population: 'Bonding_Curve_Pairs',
                normalization_version: this.normalizationVersion, context_timestamp_ms: now, uncertainty: null,
            },
            volume_by_liquidity: volume && liquiditySol !== null ? {
                signal_name: 'volume_turnover_depth',
                availability: 'OBSERVED',
                absolute_value: Number(turnover.toFixed(2)),
                normalized_value: Number(normalizedTurnover.toFixed(3)),
                reference_frame: 'PAIR_FRAME',
                reference_population: 'Solana_DEX_Pools',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                evidenceId: volume.observationId,
                sourceObservedAtMs: volume.observedAtMs,
                windowStartMs: volume.windowStartMs,
                windowEndMs: volume.windowEndMs,
                uncertainty: 0.15,
            } : {
                signal_name: 'volume_turnover_depth',
                availability: 'UNAVAILABLE',
                absolute_value: null,
                normalized_value: null,
                reference_frame: 'PAIR_FRAME',
                reference_population: 'Solana_DEX_Pools',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                uncertainty: null,
            },
            price_by_sol: relativeReturn ? {
                signal_name: 'excess_return_over_sol',
                availability: 'OBSERVED',
                absolute_value: Number(excessReturn.toFixed(2)),
                normalized_value: Number(normalizedExcess.toFixed(3)),
                reference_frame: 'SOL_FRAME',
                reference_population: 'Solana_Network_Index',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                evidenceId: relativeReturn.observationId,
                sourceObservedAtMs: relativeReturn.observedAtMs,
                windowStartMs: relativeReturn.windowStartMs,
                windowEndMs: relativeReturn.windowEndMs,
                uncertainty: 0.12,
            } : {
                signal_name: 'excess_return_over_sol',
                availability: 'UNAVAILABLE',
                absolute_value: null,
                normalized_value: null,
                reference_frame: 'SOL_FRAME',
                reference_population: 'Solana_Network_Index',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                uncertainty: null,
            },
            slippage_by_depth: slippage && normalizedSlippage !== null ? {
                signal_name: 'execution_slippage_efficiency',
                availability: 'OBSERVED',
                absolute_value: slippage.slippageBps,
                normalized_value: Number(normalizedSlippage.toFixed(3)),
                reference_frame: 'EXECUTION_FRAME',
                reference_population: 'Jito_Tip_Landing_Corridor',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                evidenceId: slippage.observationId,
                sourceObservedAtMs: slippage.quotedAtMs,
                uncertainty: 0.08,
            } : {
                signal_name: 'execution_slippage_efficiency',
                availability: 'UNAVAILABLE',
                absolute_value: null,
                normalized_value: null,
                reference_frame: 'EXECUTION_FRAME',
                reference_population: 'Jito_Tip_Landing_Corridor',
                normalization_version: this.normalizationVersion,
                context_timestamp_ms: now,
                uncertainty: null,
            },
            normalized_at_ms: now,
        };
    }
}
//# sourceMappingURL=regime-relativity.js.map