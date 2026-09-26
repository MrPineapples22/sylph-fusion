import type { AstraAgentResult, AstraConsensusResult } from './contracts.js';
import type { AstraRegistry } from './registry.js';

const unit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
export class AstraConsensus {
  evaluate(results: readonly AstraAgentResult[], registry: AstraRegistry, now: number): AstraConsensusResult {
    const warnings: string[] = [];
    const ids = new Set<string>();
    const eligible: {result:AstraAgentResult; weight:number; groups:Set<string>}[] = [];
    for (const result of results) {
      const entry = registry.get(result.agentId), model = entry?.model;
      if (ids.has(result.agentId)) { warnings.push(`DUPLICATE_AGENT:${result.agentId}`); continue; }
      ids.add(result.agentId);
      if (!model || result.agentVersion !== model.modelVersion || result.status !== 'VERIFIED' ||
        !unit(result.confidence) || result.confidence === 0 || result.timestamp > now || now - result.timestamp > 5000 ||
        result.diagnostics.staleInput || result.diagnostics.driftDetected ||
        (result.result.opportunity !== null && !unit(result.result.opportunity)) ||
        (result.result.risk !== null && !unit(result.result.risk))) {
        warnings.push(`INELIGIBLE_RESULT:${result.agentId}`); continue;
      }
      if (model.activeStatus !== 'ACTIVE' || model.health !== 'HEALTHY' || model.calibration === null ||
          model.reliability === null || !model.validationResults || model.validationResults.asOf > now ||
          now-model.validationResults.asOf > 30*86400000 ||
          result.result.regime !== 'UNKNOWN' && !model.supportedRegimes.includes(result.result.regime)) {
        warnings.push(`UNCERTIFIED_MODEL:${result.agentId}`); continue;
      }
      const groups = new Set(result.evidence.map(e => e.correlationGroup));
      if (!groups.size || groups.has('')) { warnings.push(`MISSING_INDEPENDENCE:${result.agentId}`); continue; }
      eligible.push({result, groups, weight:result.confidence * model.calibration * model.reliability * model.validationResults.accuracy});
    }
    // Connected evidence groups collapse correlated votes, including transitive
    // overlap. Conservative component aggregation prevents cloned agents voting.
    const components: typeof eligible[] = [];
    for (const item of eligible) {
      const matches = components.filter(c => c.some(x => [...x.groups].some(g => item.groups.has(g))));
      const merged = [item, ...matches.flat()];
      for (const c of matches) components.splice(components.indexOf(c),1);
      components.push(merged);
    }
    const values = components.map(c => ({
      opportunity: c.flatMap(x => x.result.result.opportunity === null ? [] : [x.result.result.opportunity]),
      risk:c.flatMap(x => x.result.result.risk === null ? [] : [x.result.result.risk]),
      weight:Math.min(...c.map(x=>x.weight)),
    }));
    const aggregate = (kind:'opportunity'|'risk') => {
      const rows=values.filter(x=>x[kind].length && x.weight > 0);
      if (!rows.length) return null;
      return 100*rows.reduce((n,x)=>n+(kind==='risk'?Math.max(...x[kind]):Math.min(...x[kind]))*x.weight,0)/rows.reduce((n,x)=>n+x.weight,0);
    };
    // Disagreement remains visible even when a model is excluded from voting.
    const validResults=results.filter(x=>x.status==='VERIFIED' && unit(x.confidence) && !x.diagnostics.staleInput);
    const spread=(key:'risk'|'opportunity')=>{
      const v=validResults.map(x=>x.result[key]).filter(unit); return v.length>1?Math.max(...v)-Math.min(...v):0;
    };
    const crossConflict=validResults.some(x=>(x.result.opportunity??0)>=.7) && validResults.some(x=>(x.result.risk??0)>=.7);
    const disagreement=Math.max(spread('risk'),spread('opportunity'),crossConflict?.7:0);
    if (disagreement>=.5) warnings.push('HIGH_DISAGREEMENT_DEEP_ANALYSIS_REQUIRED');
    if (eligible.length > components.length) warnings.push('CORRELATED_EVIDENCE_COLLAPSED');
    const confidence=values.length ? Math.min(...values.map(x=>x.weight))*(1-disagreement)*Math.min(1,components.length/3):0;
    const regimes=[...new Set(eligible.map(x=>x.result.result.regime).filter(x=>x!=='UNKNOWN'))];
    return Object.freeze({opportunityScore:aggregate('opportunity'),riskScore:aggregate('risk'),confidence,
      disagreement,signalConflict:crossConflict,uncertainty:1-confidence,
      dataQuality:eligible.length===registry.list().length && eligible.length>0?'VERIFIED':validResults.length?'PARTIAL':'UNKNOWN',
      marketRegime:regimes.length===1?regimes[0]:'UNKNOWN',warnings:Object.freeze(warnings),
      contributingAgents:Object.freeze(eligible.map(x=>x.result.agentId)),verificationState:'UNVERIFIED',agentEvidence:Object.freeze([...results])});
  }
}
