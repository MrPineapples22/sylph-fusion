export function initialWorkspace() {
  return {mode:'BOOT', workspace:'Aether Flux', investigation:null, execution:null, comparison:[], returnPoint:null, staleProjection:false, attentionOverride:null};
}
export function workspaceReducer(state, event) {
  switch(event.type) {
    case 'CONNECTED': return state.mode==='BOOT'||state.mode==='REVALIDATING'||state.mode==='STALE_PROJECTION'?workspaceReducer({...state,mode:'DISCOVERY',staleProjection:false},{type:'NAVIGATE',workspace:state.workspace}):state;
    case 'REVALIDATE': return {...state,mode:'REVALIDATING'};
    case 'STALE_PROJECTION': return {...state,mode:'STALE_PROJECTION',staleProjection:true};
    case 'ATTENTION_OVERRIDE': return {...state,attentionOverride:event.target,workspace:event.target,mode:event.target==='Incidents'?'INCIDENT_RESPONSE':'SYSTEM_DIAGNOSTIC'};
    case 'CLEAR_ATTENTION': return {...state,attentionOverride:null};
    case 'NAVIGATE': {
      const modes={Command:'COMMAND_CENTER','Aether Flux':'DISCOVERY','Token Intelligence':'INVESTIGATION',Execution:'EXECUTION_PREP',Positions:'POSITION_MANAGEMENT','Capital Command':'POSITION_MANAGEMENT',Incidents:'INCIDENT_RESPONSE',System:'SYSTEM_DIAGNOSTIC',Info:'SYSTEM_DIAGNOSTIC'};
      if(!modes[event.workspace])return state;
      if(state.staleProjection)return state; // block navigation while projection is stale
      return {...state,workspace:event.workspace,mode:state.mode==='REVALIDATING'?'REVALIDATING':state.execution?'EXECUTION_LOCKED':modes[event.workspace]};
    }
    case 'INVESTIGATE': return state.staleProjection?state:{...state,investigation:event.mint,mode:state.execution?'EXECUTION_LOCKED':'INVESTIGATION',returnPoint:state.investigation};
    case 'PREPARE': return state.execution||state.staleProjection?state:{...state,mode:'EXECUTION_LOCKED',execution:Object.freeze({...event.review})};
    case 'ABANDON': return {...state,execution:null,mode:'INVESTIGATION'};
    case 'COMPARE': return {...state,comparison:state.comparison.includes(event.mint)?state.comparison.filter(x=>x!==event.mint):state.comparison.length<4?[...state.comparison,event.mint]:state.comparison};
    default:return state;
  }
}

/** Epochs are opaque. An older generation may never return after an accepted restart. */
export function createProjectionGuard() {
  let generation=null,version=0,generatedAt=0,lastValidUntil=0;
  const retired=new Set();
  function accept(data) {
    if(!data||data.schemaVersion!==1||typeof data.authorityGeneration!=='string'||!data.authorityGeneration||
      !Number.isSafeInteger(data.projectionVersion)||data.projectionVersion<1||!Number.isFinite(data.generatedAt)||
      !Number.isFinite(data.validUntil)||data.validUntil<=data.generatedAt||!Array.isArray(data.tokens)||!Array.isArray(data.positions)||
      !data.capabilities||!data.system||!data.environment||!data.marketData||!data.risk||!data.capital||!data.executions||!data.envelopes||
      !Array.isArray(data.providers)||!Array.isArray(data.incidents)||!['SIMULATION','SHADOW','LIVE'].includes(data.environment.mode)) return false;
    if(!['observe','score','open','increase','reduce','close','reconcile','persist'].every(key=>{
      const cap=data.capabilities[key];return cap&&['READY','BLOCKED','UNKNOWN'].includes(cap.state)&&Array.isArray(cap.reasonCodes)&&cap.reasonCodes.every(x=>typeof x==='string');
    }))return false;
    // QUARANTINED is an observation-level entry restriction. It is deliberately
    // distinct from VETOED, which requires a sealed token-safety authority.
    // Rejecting it here discarded an otherwise valid whole projection.
    const validTokens=items=>Array.isArray(items)&&items.every(t=>t&&typeof t.mint==='string'&&['PRIME','DEVELOPING','QUARANTINED','VETOED','OBSERVED'].includes(t.tier)&&Array.isArray(t.pending)&&Array.isArray(t.vetoes));
    if(!validTokens(data.tokens))return false;
    // The terminal prefers rows when supplied; validate that presentation path too.
    if(data.rows!=null&&!validTokens(data.rows))return false;
    if(retired.has(data.authorityGeneration)) return false;
    if(generation===data.authorityGeneration&&(data.projectionVersion<=version||data.generatedAt<generatedAt)) return false;
    if(generation!==null&&generation!==data.authorityGeneration){
      if(data.generatedAt<generatedAt)return false;
      retired.add(generation);
      // Restart history is bounded; reaching the bound requires a fresh connection.
      if(retired.size>64)return false;
    }
    generation=data.authorityGeneration;version=data.projectionVersion;generatedAt=data.generatedAt;lastValidUntil=data.validUntil;return true;
  }
  /** Check if the last accepted projection has expired its validity window. */
  accept.isStale = (now = Date.now()) => lastValidUntil > 0 && now > lastValidUntil;
  /** Return the last accepted validUntil timestamp. */
  accept.validUntil = () => lastValidUntil;
  /** Return the current accepted projection version. */
  accept.version = () => version;
  return accept;
}

export function stableTokenOrder(previous, incoming) {
  const current=new Map(incoming.map(row=>[row.mint,row]));
  const ordered=[];
  for(const mint of previous)if(current.has(mint)){ordered.push(mint);current.delete(mint);}
  return [...ordered,...current.keys()];
}

export function isProjectionCurrent(projection, connectionState, now = Date.now()) {
  return connectionState === 'CONNECTED' && isProjectionReceiptCurrent(projection, now);
}

/** Validate a received projection before allowing its epoch/version into the guard. */
export function isProjectionReceiptCurrent(projection, now = Date.now()) {
  return !!projection && Number.isFinite(projection.generatedAt) && Number.isFinite(projection.validUntil) &&
    now >= projection.generatedAt && now <= projection.validUntil;
}

/**
 * Retain a small, session-local audit trail of accepted token observations.
 * This is presentation evidence only: it never outlives the tab, never
 * changes authority, and records only a meaningful decision/evidence change.
 */
export function appendTokenEvidenceHistory(previous, projection, limit = 24) {
  const next = new Map(previous || []);
  const rows = projection?.rows || projection?.tokens || [];
  for (const token of rows) {
    if (!token?.mint) continue;
    const evidence = Array.isArray(token.evidence) ? token.evidence.map(item => `${item.type}:${item.state}`).sort() : [];
    const fingerprint = JSON.stringify({tier:token.tier || 'UNKNOWN', safety:token.safety || 'UNKNOWN', quality:token.quality || 'UNKNOWN', opportunity:token.opportunity || 'UNKNOWN', execution:token.execution || 'UNKNOWN', pending:[...(token.pending || [])].sort(), vetoes:[...(token.vetoes || [])].sort(), evidence});
    const history = next.get(token.mint) || [];
    const newGeneration = history[0]?.generation && history[0].generation !== projection.authorityGeneration;
    if (!newGeneration && history[0]?.fingerprint === fingerprint) continue;
    const entry = Object.freeze({
      id: `${projection.authorityGeneration}:${projection.projectionVersion}:${token.mint}`,
      at: projection.generatedAt,
      generation: projection.authorityGeneration,
      version: projection.projectionVersion,
      tier: token.tier || 'UNKNOWN',
      safety: token.safety || 'UNKNOWN',
      pending: [...(token.pending || [])],
      vetoes: [...(token.vetoes || [])],
      evidence,
      fingerprint,
    });
    // A new authority generation is a new epoch, not a decision transition.
    // Refresh insertion order so bounded retention removes the least recently
    // changed token history, rather than an actively changing one.
    next.delete(token.mint);
    next.set(token.mint, newGeneration ? [entry] : [entry, ...history].slice(0, limit));
  }
  // Keep session history bounded even for high-cardinality discovery feeds.
  while (next.size > 100) next.delete(next.keys().next().value);
  return next;
}

export function startOperatorConnection({request,onSnapshot,onState,events=globalThis.window,visibility=globalThis.document,intervalMs=1000,now=()=>Date.now()}) {
  let stopped=false,active=false,queued=false,timer;
  const controller=new AbortController(),accept=createProjectionGuard();
  async function poll(){
    if(stopped)return;
    if(active){queued=true;return;}
    clearTimeout(timer);active=true;
    try{
      const data=await request(controller.signal);
      // Reject time-invalid data before accepting its version. Otherwise a
      // corrected retry at the same version would be fenced as a duplicate.
      if(!isProjectionReceiptCurrent(data,now())||!accept(data))throw Error('Projection rejected');
      if(!stopped){onSnapshot(data);onState('CONNECTED');}
    }catch{if(!stopped)onState('REVALIDATING');}
    finally{active=false;if(!stopped){timer=setTimeout(poll,queued?0:intervalMs);queued=false;}}
  }
  const wake=()=>{if(!visibility||visibility.visibilityState!=='hidden'){onState('REVALIDATING');void poll();}};
  events?.addEventListener('online',wake);events?.addEventListener('focus',wake);visibility?.addEventListener('visibilitychange',wake);
  void poll();
  return()=>{stopped=true;controller.abort();clearTimeout(timer);events?.removeEventListener('online',wake);events?.removeEventListener('focus',wake);visibility?.removeEventListener('visibilitychange',wake);};
}
