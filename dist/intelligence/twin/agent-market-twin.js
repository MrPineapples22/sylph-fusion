/**
 * SOL-SYLPH Agent-Based Market Twin
 * Blueprint Part XXVIII
 *
 * Models reactive behavioral agents on top of protocol mechanics:
 * organic participant, sniper, arbitrageur, market maker,
 * LP provider, dev-related cluster, momentum bot, whale.
 */
export class AgentMarketTwinEngine {
    simulateAgents(mint, agents, currentPriceSol) {
        let sniperTokens = 0;
        let organicSol = 0;
        let panicVulnerability = 0;
        for (const a of agents) {
            if (a.role === 'SNIPER' || a.role === 'FRESH_WALLET_CLUSTER') {
                sniperTokens += a.holdingsTokens;
            }
            if (a.role === 'ORGANIC_PARTICIPANT' || a.role === 'MARKET_MAKER') {
                organicSol += a.balanceSol;
            }
            if (a.panicExitLossPct < 25) {
                panicVulnerability += 1;
            }
        }
        const cascadeSusceptibility = agents.length > 0
            ? Math.min(1.0, (panicVulnerability / agents.length) * 1.5)
            : 0.2;
        const expectedSniperDumpTimingSec = agents.some(a => a.role === 'SNIPER') ? 15 : 120;
        return {
            mint,
            simulatedAgents: agents,
            agentCascadeSusceptibility: Number(cascadeSusceptibility.toFixed(2)),
            expectedSniperDumpTimingSec,
            organicAbsorptionCapacitySol: Number(organicSol.toFixed(2)),
        };
    }
}
//# sourceMappingURL=agent-market-twin.js.map