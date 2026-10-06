/**
 * SYLPH FUSION — WALLET ENTROPY & BUYER DERIVATIVES
 * Specifications: Master Blueprint Sections XXIX, XXXI
 *
 * Implements:
 * 1. Shannon Entropy over funding and economic clusters:
 *    H_wallet = - \sum p_i \log p_i
 * 2. Entropy Derivatives: H'_wallet, H''_wallet
 * 3. Buyer Derivatives: B(t), B'(t), B''(t), B'''(t) (count, velocity, acceleration, jerk)
 *
 * Principle: Rising buyer count with flat or falling entropy indicates manufactured demand / sybil loop.
 */
export class WalletEntropyCalculator {
    history = [];
    /**
     * Calculates Shannon Entropy across buyer clusters and tracks 1st, 2nd, and 3rd order derivatives.
     */
    calculateEntropy(timestampMs, slot, clusters) {
        const totalVolume = clusters.reduce((acc, c) => acc + c.volumeLamports, 0n);
        const totalBuyers = clusters.reduce((acc, c) => acc + c.buyerCount, 0);
        let entropy = 0;
        if (totalVolume > 0n && clusters.length > 0) {
            const totalVolNum = Number(totalVolume);
            for (const c of clusters) {
                const p = Number(c.volumeLamports) / totalVolNum;
                if (p > 0) {
                    entropy -= p * Math.log2(p);
                }
            }
        }
        // Historical derivatives
        const prev = this.history[this.history.length - 1];
        const prev2 = this.history[this.history.length - 2];
        const prev3 = this.history[this.history.length - 3];
        let dt = prev ? Math.max(1, (timestampMs - prev.timestampMs) / 1000) : 1;
        let buyerVelocity = prev ? (totalBuyers - prev.buyers) / dt : 0;
        let entropyVelocity = prev ? (entropy - prev.entropy) / dt : 0;
        let buyerAcceleration = 0;
        let entropyAcceleration = 0;
        if (prev && prev2) {
            const dtPrev = Math.max(1, (prev.timestampMs - prev2.timestampMs) / 1000);
            const prevBuyerVel = (prev.buyers - prev2.buyers) / dtPrev;
            const prevEntropyVel = (prev.entropy - prev2.entropy) / dtPrev;
            buyerAcceleration = (buyerVelocity - prevBuyerVel) / dt;
            entropyAcceleration = (entropyVelocity - prevEntropyVel) / dt;
        }
        let buyerJerk = 0;
        if (prev && prev2 && prev3) {
            const dtPrev2 = Math.max(1, (prev2.timestampMs - prev3.timestampMs) / 1000);
            const prev2BuyerVel = (prev2.buyers - prev3.buyers) / dtPrev2;
            const dtPrev = Math.max(1, (prev.timestampMs - prev2.timestampMs) / 1000);
            const prevBuyerVel = (prev.buyers - prev2.buyers) / dtPrev;
            const prevBuyerAcc = (prevBuyerVel - prev2BuyerVel) / dtPrev;
            buyerJerk = (buyerAcceleration - prevBuyerAcc) / dt;
        }
        this.history.push({ timestampMs, buyers: totalBuyers, entropy });
        if (this.history.length > 200)
            this.history.shift();
        // Manufactured demand detector: High buyer velocity + negative or zero entropy velocity
        let manufacturedDemandRisk = 0;
        if (buyerVelocity > 2.0 && entropy < 1.0) {
            manufacturedDemandRisk = Math.min(1.0, 0.4 + (1.0 - entropy) * 0.6);
        }
        else if (buyerVelocity > 5.0 && entropyVelocity <= 0) {
            manufacturedDemandRisk = 0.85;
        }
        else {
            manufacturedDemandRisk = Math.max(0, 0.2 - entropy * 0.1);
        }
        return {
            timestampMs,
            slot,
            buyerCount: totalBuyers,
            buyerVelocity: Number(buyerVelocity.toFixed(3)),
            buyerAcceleration: Number(buyerAcceleration.toFixed(3)),
            buyerJerk: Number(buyerJerk.toFixed(3)),
            entropy: Number(entropy.toFixed(4)),
            entropyVelocity: Number(entropyVelocity.toFixed(4)),
            entropyAcceleration: Number(entropyAcceleration.toFixed(4)),
            manufacturedDemandRiskScore: Number(manufacturedDemandRisk.toFixed(3)),
        };
    }
}
//# sourceMappingURL=wallet-entropy.js.map