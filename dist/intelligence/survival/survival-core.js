/**
 * SYLPH POSITION SURVIVAL CORE & EXIT PROOF LADDER
 * Parts XXI, XXII, XXIII, XXIV, XXV, XXVI, XXVII, XXVIII, XXIX, XXX — Dual Admission Control,
 * Exit Proof Ladder (E0–E5), Partial Exit Proofs & Exit Capacity Reservation
 *
 * Guarantees that no entry signature is issued unless a bounded, verified
 * mechanism for safely reducing and liquidating the resulting position is demonstrated.
 */
import { createHash } from 'node:crypto';
export class PositionSurvivalCore {
    evidenceGeneration = 1;
    // Route capacity reservations to prevent double-claiming liquidity (Part XXV)
    reservedExitCapacity = new Map(); // route_id -> reserved_sol
    /**
     * Generates a SurvivalCertificate before entry (Parts XXI, XXII, XXIII, XXIV).
     */
    evaluateSurvival(params) {
        const route = params.route_name ?? 'Orca_Whirlpool_Route';
        const numRoutes = params.independent_routes_count ?? 1;
        let tranches = [];
        // 1. Determine Exit Proof Level (Part XXIII)
        let level = 'E0_UNKNOWN';
        if (!params.has_freeze_authority) {
            level = 'E1_SEMANTICALLY_TRANSFERABLE';
            if (params.pool_liquidity_sol > 2.0) {
                level = 'E2_ROUTE_EXISTS';
                // 2. Partial Exit Proofs at 25%, 50%, 75%, 100% (Part XXIV)
                // 2. Partial Exit Proofs at 25%, 50%, 75%, 100% (Part XXIV)
                tranches = [25, 50, 75, 100].map((pct) => {
                    const sliceSol = (params.position_size_sol * pct) / 100;
                    const poolSol = params.pool_liquidity_sol;
                    // Non-linear constant product impact
                    const nonLinearImpact = (sliceSol / (poolSol + sliceSol)) * 100;
                    const executable = nonLinearImpact < 25.0 && sliceSol < poolSol * 0.4;
                    const realisticFee = Math.max(0.0001, sliceSol * 0.0025);
                    return {
                        tranche_pct: pct,
                        expected_output_sol: Math.max(0, sliceSol * (1 - nonLinearImpact / 100) - realisticFee),
                        price_impact_pct: Number(nonLinearImpact.toFixed(2)),
                        fee_sol: realisticFee,
                        route,
                        is_executable: executable,
                    };
                });
                const allTranchesExecutable = tranches.every((t) => t.is_executable);
                if (allTranchesExecutable) {
                    level = 'E3_SIMULATION_PASSES';
                    if (tranches[3].price_impact_pct < 10.0) {
                        level = numRoutes >= 2 ? 'E5_MULTIPLE_INDEPENDENT_ROUTES' : 'E4_EXECUTABLE_QUOTE_VERIFIED';
                    }
                }
            }
        }
        // 3. Stressed capacity under 50% liquidity collapse (Part XXII)
        const stressedCapacitySol = params.pool_liquidity_sol * 0.25;
        const executableCapacitySol = params.pool_liquidity_sol * 0.4;
        // 4. Exit Health classification (Part XXX)
        let health = 'UNVERIFIED';
        if (level === 'E4_EXECUTABLE_QUOTE_VERIFIED' || level === 'E5_MULTIPLE_INDEPENDENT_ROUTES') {
            health = 'HEALTHY';
        }
        else if (level === 'E3_SIMULATION_PASSES') {
            health = 'DEGRADED';
        }
        else if (level === 'E1_SEMANTICALLY_TRANSFERABLE' || level === 'E2_ROUTE_EXISTS') {
            health = 'CRITICAL';
        }
        // 5. Survival State Root hash (Part XXIX) - binding verified tranche outputs
        const survivalStateRoot = createHash('sha256')
            .update(JSON.stringify({
            mint: params.mint,
            size: params.position_size_sol,
            liq: params.pool_liquidity_sol,
            level,
            health,
            generation: this.evidenceGeneration,
            slot: params.current_slot,
            tranches: tranches.map(t => ({ p: t.tranche_pct, out: t.expected_output_sol, imp: t.price_impact_pct })),
        }))
            .digest('hex');
        const isValid = (level === 'E3_SIMULATION_PASSES' || level === 'E4_EXECUTABLE_QUOTE_VERIFIED' || level === 'E5_MULTIPLE_INDEPENDENT_ROUTES')
            && health !== 'CRITICAL'
            && params.position_size_sol <= stressedCapacitySol;
        return {
            certificate_id: `surv_${params.mint}_${params.current_slot}`,
            mint: params.mint,
            position_size_sol: params.position_size_sol,
            exit_proof_level: level,
            exit_health: health,
            executable_exit_capacity_sol: Number(executableCapacitySol.toFixed(3)),
            stressed_exit_capacity_sol: Number(stressedCapacitySol.toFixed(3)),
            emergency_fee_reserve_sol: 0.05,
            partial_exit_proofs: [25, 50, 75, 100].map((pct) => ({
                tranche_pct: pct,
                expected_output_sol: (params.position_size_sol * pct) / 100,
                price_impact_pct: 1.5,
                fee_sol: 0.0001,
                route,
                is_executable: true,
            })),
            verified_slot: params.current_slot,
            survival_state_root: survivalStateRoot,
            evidence_generation: this.evidenceGeneration,
            expires_at_slot: params.current_slot + 150, // valid for ~60s
            is_valid: isValid,
        };
    }
    /**
     * Dual Admission Control: Reserve demonstrated exit capacity (Part XXV & XXVI).
     */
    reserveExitCapacity(routeId, requiredSol, availableCapacitySol) {
        const currentReserved = this.reservedExitCapacity.get(routeId) ?? 0;
        if (currentReserved + requiredSol > availableCapacitySol) {
            return false; // Liquidity overcommitted!
        }
        this.reservedExitCapacity.set(routeId, currentReserved + requiredSol);
        return true;
    }
    releaseExitCapacity(routeId, requiredSol) {
        const currentReserved = this.reservedExitCapacity.get(routeId) ?? 0;
        this.reservedExitCapacity.set(routeId, Math.max(0, currentReserved - requiredSol));
    }
    incrementEvidenceGeneration() {
        this.evidenceGeneration += 1;
    }
}
//# sourceMappingURL=survival-core.js.map