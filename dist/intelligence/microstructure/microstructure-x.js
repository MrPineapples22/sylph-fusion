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
function nonNegativeFinite(value, name) {
    if (!Number.isFinite(value) || value < 0)
        throw new RangeError(`${name} must be finite and nonnegative`);
}
function positiveFinite(value, name) {
    if (!Number.isFinite(value) || value <= 0)
        throw new RangeError(`${name} must be finite and positive`);
}
function nonNegativeBigint(value, name) {
    if (typeof value !== 'bigint' || value < 0n)
        throw new RangeError(`${name} must be a nonnegative bigint`);
}
function nonEmpty(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new TypeError(`${name} must be nonempty`);
}
function ratio(numerator, denominator) {
    return Number((numerator * 1000000000n) / denominator) / 1_000_000_000;
}
export class AuthenticDemandEngine {
    static evaluateDemand(mint, ageSeconds, buyers, sellers) {
        nonEmpty(mint, 'mint');
        nonNegativeFinite(ageSeconds, 'ageSeconds');
        for (const p of [...buyers, ...sellers]) {
            nonEmpty(p.wallet, 'participant wallet');
            if (p.fundingRoot !== undefined)
                nonEmpty(p.fundingRoot, 'fundingRoot');
            nonNegativeFinite(p.solAmount, 'participant solAmount');
        }
        // Sybil clustering by funding root
        const independentBuyerEntities = new Set();
        let freshSol = 0;
        let recirculatedSol = 0;
        for (const b of buyers) {
            if (b.isWashSuspect || b.isSubDust)
                continue;
            const entityKey = b.fundingRoot && b.fundingRoot.length > 0 ? b.fundingRoot : b.wallet;
            independentBuyerEntities.add(entityKey);
            if (b.isSniper) {
                recirculatedSol += b.solAmount;
            }
            else {
                freshSol += b.solAmount;
            }
        }
        const independentSellerEntities = new Set();
        for (const s of sellers) {
            if (s.isWashSuspect || s.isSubDust)
                continue;
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
export class MetaorderIntelligenceEngine {
    static inferMetaorder(trades) {
        if (trades.length < 3)
            return null;
        const first = trades[0];
        nonEmpty(first.wallet, 'wallet');
        for (const trade of trades) {
            nonEmpty(trade.wallet, 'wallet');
            nonNegativeFinite(trade.timestampMs, 'timestampMs');
            positiveFinite(trade.solAmount, 'solAmount');
            if (trade.wallet !== first.wallet || trade.isBuy !== first.isBuy)
                return null;
        }
        for (let i = 1; i < trades.length; i++) {
            if (trades[i].timestampMs <= trades[i - 1].timestampMs)
                return null;
        }
        // Check cadence regularity (interval variance)
        const intervals = [];
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
export class SellHazardEngine {
    static evaluateSellHazard(mint, currentPriceUsd, holders, devWallet) {
        nonEmpty(mint, 'mint');
        positiveFinite(currentPriceUsd, 'currentPriceUsd');
        if (devWallet !== undefined)
            nonEmpty(devWallet, 'devWallet');
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
            }
            else if (gain >= -0.1 && gain < 0.5) {
                breakEvenTokens += h.balanceTokens;
            }
            else {
                underwaterTokens += h.balanceTokens;
            }
            if (h.wallet === devWallet) {
                devTokens += h.balanceTokens;
            }
            else if (h.isDevOrCabal) {
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
        const totalSellHazard = Math.min(1.0, 0.15 + (profitPct * 0.35) + (devDumpHazard * 0.35) + (cabalDumpHazard * 0.25));
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
export class ParticipantEcologyEngine {
    static classifyWallet(wallet) {
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
export class CapitalTournamentEngine {
    static evaluateRank(mint, tokenVolumeSol, totalUniverseVolumeSol, previousSharePct, externalReservoirSol, winnerProfitReservoirSol) {
        nonEmpty(mint, 'mint');
        nonNegativeFinite(tokenVolumeSol, 'tokenVolumeSol');
        nonNegativeFinite(totalUniverseVolumeSol, 'totalUniverseVolumeSol');
        if (tokenVolumeSol > totalUniverseVolumeSol)
            throw new RangeError('token volume exceeds universe volume');
        nonNegativeFinite(previousSharePct, 'previousSharePct');
        if (previousSharePct > 100)
            throw new RangeError('previousSharePct exceeds 100');
        nonNegativeFinite(externalReservoirSol, 'externalReservoirSol');
        nonNegativeFinite(winnerProfitReservoirSol, 'winnerProfitReservoirSol');
        const capitalSharePct = totalUniverseVolumeSol > 0 ? (tokenVolumeSol / totalUniverseVolumeSol) * 100 : 0;
        const capitalShareMomentum = capitalSharePct - previousSharePct;
        let tournamentRank = 'STABLE';
        if (capitalSharePct >= 35 && capitalShareMomentum >= 0) {
            tournamentRank = 'DOMINANT';
        }
        else if (capitalSharePct >= 20 || capitalShareMomentum >= 5) {
            tournamentRank = 'LEADER';
        }
        else if (capitalSharePct >= 10 || capitalShareMomentum >= 2) {
            tournamentRank = 'CHALLENGER';
        }
        else if (capitalShareMomentum < -3) {
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
export class BarrierFatigueEngine {
    static recordAttempt(input) {
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
export class MevContaminationEngine {
    static evaluateContamination(trades, mint) {
        nonEmpty(mint, 'mint');
        let total = 0;
        let mev = 0;
        for (const t of trades) {
            nonNegativeFinite(t.solAmount, 'solAmount');
            total += t.solAmount;
            if (t.isMev)
                mev += t.solAmount;
        }
        if (!Number.isFinite(total) || !Number.isFinite(mev))
            throw new RangeError('volume sum overflow');
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
//# sourceMappingURL=microstructure-x.js.map