import type { AstraAgentResult, AstraConsensusResult, AstraFeatureContext, AstraVerification } from './contracts.js';
import { observationIssue } from './features.js';
import type { AstraRegistry } from './registry.js';

/** Independent structural/falsification rules; never calls a specialist/model. */
export class AstraVerifier {
  verify(context:AstraFeatureContext, results:readonly AstraAgentResult[], consensus:AstraConsensusResult,
    registry:AstraRegistry, now:number): AstraVerification {
    const reasons=[...context.rejected];
    let failed=false;
    const ids=new Set<string>();
    for (const result of results) {
      const agent=registry.get(result.agentId)?.agent;
      if (!agent || ids.has(result.agentId) || result.agentVersion!==agent.version || result.snapshotHash!==context.snapshot.snapshotHash ||
          !Number.isFinite(result.timestamp) || result.timestamp>now || result.timestamp<context.snapshot.timestampMs) {
        failed=true; reasons.push(`RESULT_BINDING_INVALID:${result.agentId}`);
      }
      ids.add(result.agentId);
      if (result.status !== 'VERIFIED') reasons.push(`AGENT_${result.status}:${result.agentId}`);
      if (result.status === 'VERIFIED') {
        for (const name of agent?.requiredFeatures ?? []) {
          const input=context.observations[name], evidence=result.evidence.find(e=>e.name===name);
          if (!input || observationIssue(input,now) || !evidence || JSON.stringify(input)!==JSON.stringify(evidence)) {
            failed=true; reasons.push(`UNSUPPORTED_VERIFIED_RESULT:${result.agentId}:${name}`);
          }
        }
        if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 ||
            !Number.isFinite(result.diagnostics.latencyMs) || result.diagnostics.latencyMs < 0) { failed=true; reasons.push('INVALID_RESULT_NUMERICS'); }
      }
    }
    if (ids.size!==registry.list().length) reasons.push('INCOMPLETE_SPECIALIST_COVERAGE');
    if (consensus.disagreement>=.5) reasons.push('HIGH_DISAGREEMENT');
    if (consensus.dataQuality!=='VERIFIED') reasons.push('UNVERIFIED_MODEL_OR_DATA_COVERAGE');
    // Coarse sign/dominance constraints independently challenge favorable scores.
    // These are falsification checks, not a second copy of specialist scoring.
    const velocity=context.observations.price_velocity;
    const flow=context.observations.liquidity_velocity;
    if (velocity && !observationIssue(velocity,now) && velocity.value! < 0 &&
        results.some(r=>r.agentId==='momentum' && (r.result.opportunity??0)>.7)) {failed=true; reasons.push('ORACLE_NEGATIVE_MOMENTUM_CONFLICT');}
    if (flow && !observationIssue(flow,now) && flow.value! < -.1 &&
        results.some(r=>r.agentId==='liquidity' && r.result.risk!==null && r.result.risk<.5)) {failed=true; reasons.push('ORACLE_LIQUIDITY_REMOVAL_CONFLICT');}
    // Full production verification additionally needs independent market/chain
    // oracle coverage and current safety certificates; never manufacture these.
    reasons.push('INDEPENDENT_CHAIN_ORACLE_NOT_CONNECTED');
    return Object.freeze({state:failed?'FAILED':reasons.length?'PARTIALLY_VERIFIED':'VERIFIED',
      reasons:Object.freeze([...new Set(reasons)]),independentOracle:'RULE_REPLAY',executionAuthorized:false});
  }
}
