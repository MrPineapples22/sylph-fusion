// Deterministic presentation fixtures. Never imported by the application runtime.
export function operatorFixture({state = 'current', version = 1, now = Date.now()} = {}) {
  const current = state !== 'historical';
  const tokens = state === 'empty' ? [] : [
    {mint:'fixture-aurora-not-a-real-mint',symbol:'AURORA',tier:'PRIME',price:0.00001234,liquidity:245000,highSignalIndex:84,pod:'Increasing',at:now-1200,pending:['QUOTE_UNAVAILABLE'],vetoes:[],venueState:'OBSERVED',safety:'CHECKS_PASSED',evidenceCoverage:{current:1,total:2},evidence:[{evidenceId:'price',type:'Price',state:'CURRENT',source:'Fixture source',ageMs:1200,authority:'Observation only',provenance:'Synthetic UI test record'}]},
    {mint:'fixture-moss-not-a-real-mint',symbol:'MOSS',tier:'DEVELOPING',price:0.0314,liquidity:84000,highSignalIndex:62,pod:'Unknown',at:now-2100,pending:['SAFETY_UNAVAILABLE'],vetoes:[],venueState:'OBSERVED',safety:'UNKNOWN',evidence:[]},
    {mint:'fixture-long-identity-not-a-real-mint',symbol:'A long token identity for wrapping',tier:'VETOED',price:1e-12,liquidity:null,highSignalIndex:null,pod:null,at:now-3000,pending:[],vetoes:['MISSING_EVIDENCE'],venueState:'UNKNOWN',safety:'UNKNOWN',evidence:[]},
  ];
  const cap = {state:'BLOCKED',reasonCodes:['REVIEW_EVIDENCE_UNAVAILABLE']};
  return {schemaVersion:1,authorityGeneration:'operator-ui-fixture',projectionVersion:version,generatedAt:current?now:now-10000,validUntil:current?now+4000:now-6000,
    environment:{mode:'SIMULATION'},system:{state:'DEGRADED',reason:'UI fixture: review evidence is unavailable.'},marketData:{state:'CURRENT',ageMs:1200},risk:{state:'UNKNOWN'},
    capabilities:Object.fromEntries(['observe','score','open','increase','reduce','close','reconcile','persist'].map(name=>[name,{...cap}])),
    capital:state==='partial'?{}:{available:132.5,reserved:17.5,digest:'fixture-ledger'},positions:state==='empty'?[]:[{mint:'fixture-aurora-not-a-real-mint',asset:'Fixture position',entryPriceUsd:.000011,markPriceUsd:.00001234,unrealizedPnlUsd:1.25,reconciliationState:'UNKNOWN'}],
    rows:tokens,tokens,executions:{},envelopes:{open:{state:'UNKNOWN',dominantConstraint:'Review evidence unavailable',constraints:[]},close:{state:'UNKNOWN',dominantConstraint:'Current close capability required',constraints:[]}},
    providers:[{id:'Fixture provider',role:'OBSERVATION',state:'CURRENT',ageMs:1200,latencyMs:25,circuit:'CLOSED',authority:false}],
    incidents:state==='empty'?[]:[{incidentId:'fixture-incident',reasonCode:'REVIEW_EVIDENCE_UNAVAILABLE',state:'WARNING',priority:'Medium',detectedAt:now-3000,operatorAction:'Inspect missing review evidence.'}],automation:{mode:'Fixture only',execution:'Unavailable'},
  };
}
