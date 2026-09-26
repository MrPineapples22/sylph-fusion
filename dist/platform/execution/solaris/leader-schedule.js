/**
 * SOLARIS-NEXUS: Leader Schedule Tracking Engine
 * Tracks Solana's 432,000-slot epoch leader schedule, identifying Jito-Solana validators
 * and predicting block packaging characteristics 32 slots in advance.
 */
export const SLOTS_PER_EPOCH = 432_000;
export const SLOTS_PER_LEADER_CHUNK = 4;
export class LeaderScheduleTracker {
    currentEpoch = 0;
    scheduleBySlot = new Map();
    jitoValidators = new Set();
    validatorStakes = new Map();
    totalActiveStakeLamports = 100000000000000000n; // default ~100M SOL
    lastRefreshedEpoch = -1;
    constructor(initialJitoPubkeys = []) {
        for (const key of initialJitoPubkeys) {
            this.jitoValidators.add(key);
        }
    }
    registerJitoValidators(pubkeys) {
        for (const key of pubkeys) {
            this.jitoValidators.add(key);
        }
        // Update any already-cached slot records
        for (const [slot, info] of this.scheduleBySlot.entries()) {
            if (this.jitoValidators.has(info.leaderPubkey) && !info.isJitoLeader) {
                this.scheduleBySlot.set(slot, { ...info, isJitoLeader: true });
            }
        }
    }
    registerValidatorStakes(records) {
        let sum = 0n;
        for (const rec of records) {
            this.validatorStakes.set(rec.pubkey, rec.stakeLamports);
            sum += rec.stakeLamports;
            if (rec.isJito) {
                this.jitoValidators.add(rec.pubkey);
            }
        }
        if (sum > 0n) {
            this.totalActiveStakeLamports = sum;
        }
    }
    loadEpochSchedule(epoch, schedule, firstSlotOfEpoch) {
        this.currentEpoch = epoch;
        this.lastRefreshedEpoch = epoch;
        this.scheduleBySlot.clear();
        const startSlot = firstSlotOfEpoch ?? epoch * SLOTS_PER_EPOCH;
        const entries = schedule instanceof Map ? schedule.entries() : Object.entries(schedule);
        for (const [pubkey, slotIndices] of entries) {
            const isJito = this.jitoValidators.has(pubkey);
            const stake = this.validatorStakes.get(pubkey) ?? 10000000000000n;
            const stakeShareBps = this.totalActiveStakeLamports > 0n
                ? Number((stake * 10000n) / this.totalActiveStakeLamports)
                : 100;
            for (const idx of slotIndices) {
                const absoluteSlot = startSlot + idx;
                this.scheduleBySlot.set(absoluteSlot, {
                    slot: absoluteSlot,
                    leaderPubkey: pubkey,
                    isJitoLeader: isJito,
                    stakeWeightLamports: stake,
                    epochSlotIndex: idx,
                    clusterStakeShareBps: stakeShareBps,
                });
            }
        }
    }
    getSlotLeader(slot) {
        const existing = this.scheduleBySlot.get(slot);
        return existing;
    }
    getUpcomingWindow(startSlot, count = 16) {
        const window = [];
        for (let s = startSlot; s < startSlot + count; s++) {
            const leader = this.getSlotLeader(s);
            if (leader)
                window.push(leader);
        }
        return window;
    }
    isJitoLeaderAtSlot(slot) {
        return this.getSlotLeader(slot)?.isJitoLeader ?? false;
    }
    calculateChunkInfo(slot) {
        const chunkStartSlot = Math.floor(slot / SLOTS_PER_LEADER_CHUNK) * SLOTS_PER_LEADER_CHUNK;
        const chunkEndSlot = chunkStartSlot + SLOTS_PER_LEADER_CHUNK - 1;
        const remainingSlotsInChunk = chunkEndSlot - slot;
        return { chunkStartSlot, chunkEndSlot, remainingSlotsInChunk };
    }
    getStats() {
        return {
            currentEpoch: this.currentEpoch,
            cachedSlotCount: this.scheduleBySlot.size,
            knownJitoCount: this.jitoValidators.size,
            totalStakedLamports: this.totalActiveStakeLamports.toString(),
        };
    }
}
//# sourceMappingURL=leader-schedule.js.map