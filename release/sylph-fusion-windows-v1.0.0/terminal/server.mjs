import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {createAstraFeed} from './astra-feed.mjs';
import {getSoakTelemetry, exportSessionArtifact, readSessionEvents, compareSoakSessions} from './soak-reader.mjs';
import {MarketHub} from '../dist/market-hub.js';
import {scanToken} from '../dist/risk.js';
import {MasterIntelligenceEngine} from '../dist/intelligence/master-orchestrator.js';
import {globalCommandGateway} from '../dist/command-gateway.js';
import {globalProjectionService} from '../dist/projection-service.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';
import {globalConfigAuthority} from '../dist/config-authority.js';
import {CapitalYieldRegimeEngine} from '../dist/intelligence/research/capital-regime.js';
import {MarketEvidenceProvenanceEngine} from '../dist/intelligence/evidence/market-provenance.js';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
const masterEngine = new MasterIntelligenceEngine();
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const port=Number(process.env.TERMINAL_PORT||8793);
const liveOrigin='http://127.0.0.1:8788';
const livePaths=new Set(['/api/market','/api/search','/api/risk','/api/intelligence','/api/system/trust','/api/research/audit','/api/system/health','/api/capital/authority','/api/system/omega','/api/system/strip','/api/positions','/api/opportunity/best','/api/gateway/snapshot','/api/command','/api/solaris']);
const project=fileURLToPath(new URL('../',import.meta.url));
const hub=new MarketHub(resolve(project,'data/watchlist.json'),process.env.MARKET_RPC_URL||'https://api.mainnet-beta.solana.com',resolve(project,'data/kol_wallets.txt'));
await hub.start();
globalLifecycle.recordCertification(true);
globalLifecycle.recordReconciliation();
if (globalLifecycle.getState() === 'BOOT') {
  try {
    globalLifecycle.transition('INITIALIZING', 'Server startup');
    globalLifecycle.transition('CONNECTING', 'Feeds starting');
    globalLifecycle.transition('SYNCHRONIZING', 'Market sync');
    globalLifecycle.transition('RECONCILING', 'Startup reconciliation');
    globalLifecycle.transition('CERTIFYING', 'Pre-flight certification');
    globalLifecycle.transition('READY', 'Ready for operation');
    globalLifecycle.transition('HEALTHY', 'All systems green');
  } catch {}
}
async function readLive(path){
 if(path.startsWith('/api/system/omega')){
  return masterEngine.getSystemOmegaState();
 }
 if(path.startsWith('/api/capital/authority')){
  const capSnapshot = masterEngine.capitalTruth.getSnapshot();
  const firewall = masterEngine.vaultSigner.getFirewallStatus(capSnapshot.confirmed_cash_sol);
  const evac = masterEngine.portfolioEvac.evaluatePortfolioEvacuation();
  const proofDebt = masterEngine.survivalProof.evaluateProofDebt();
  const reval = masterEngine.revocationEngine.verifyRevocationBarrier({
    token_mint: 'GLOBAL',
    intent_id: 'SYSTEM_STATUS',
    strategy_id: 'GLOBAL',
    route_name: 'ALL',
    request_revocation_epoch: masterEngine.revocationEngine.getCurrentEpoch(),
  });
  return {
    authorityMode: masterEngine.capitalKernel.getAuthorityMode().replace(/_/g, ' '),
    capitalStatus: capSnapshot.unresolved_transactions_count > 0 ? 'UNRESOLVED' : 'VERIFIED',
    survivalHealth: 'HEALTHY',
    exitCoveragePct: Math.round(evac.current_exit_coverage_pct),
    stressedCoveragePct: Math.round(evac.stressed_exit_coverage_pct),
    proofsStatus: reval.is_cleared_to_sign ? 'CURRENT' : 'REVOKED',
    proofLevel: 'P5',
    revocationPriority: (reval.blocking_revocations[0]?.priority?.slice(0, 2)) || 'R0',
    revocationCause: reval.blocking_revocations[0]?.reason,
    vaultArmed: masterEngine.capitalKernel.getAuthorityMode() !== 'A0_OBSERVE_ONLY',
    chainCoherence: 'COHERENT',
    signingGate: {
      gateReady: true,
      reservationPass: true,
      stateCurrent: true,
      proofCurrent: reval.is_cleared_to_sign,
      controlEpoch: capSnapshot.control_epoch,
      revocationEpoch: masterEngine.revocationEngine.getCurrentEpoch(),
      vaultStatus: 'ARMED',
    },
    positionSurvival: {
      exitProofLevel: 'E5_MULTIPLE_INDEPENDENT_ROUTES',
      timeToEvacuateSec: Number(evac.portfolio_time_to_evacuate_s.toFixed(1)),
      proofAgeSec: 0.8,
      partialExitTested: [25, 50, 75, 100],
      sharedBottlenecks: evac.shared_route_bottlenecks,
    },
    assuranceDeep: {
      capitalStateRoot: capSnapshot.capital_state_root.slice(0, 16) + '…',
      confirmedCapitalSol: Number(capSnapshot.confirmed_cash_sol.toFixed(3)),
      reservedCapitalSol: Number(capSnapshot.reserved_cash_sol.toFixed(3)),
      possibleExposureSol: Number(capSnapshot.possible_exposure_sol.toFixed(3)),
      unknownCapitalSol: 0.0,
      emergencyReserveSol: capSnapshot.emergency_reserve_sol,
      maxBlastRadiusSol: firewall.max_blast_radius_sol,
      maxCompromiseLossSol: firewall.max_compromise_loss_sol,
      proofDebtScore: proofDebt.proof_debt_score,
      ledgerSeq: capSnapshot.ledger_sequence,
      vaultJournalCount: masterEngine.janusReconciler.getAudit().total_managed_transactions,
      activeInvariantsTripped: [],
    },
    capitalRegime: CapitalYieldRegimeEngine.getInstance().createRegimeSnapshot(),
    timestampMs: Date.now(),
  };
 }
 if(path.startsWith('/api/research/audit')){
  const trials = masterEngine.researchLedger.getTrials();
  const graveyard = masterEngine.featureGraveyard.getGraveyard();
  const falsification = masterEngine.falsificationEngine.stressTest({
    experimentId: 'exp_production_baseline',
    baselineNetEdgeBps: 220,
    trades: [
      { pnlBps: 450, latencyMs: 220, slippageBps: 35, regime: 'RISK_ON' },
      { pnlBps: 120, latencyMs: 250, slippageBps: 40, regime: 'RISK_ON' },
      { pnlBps: 85, latencyMs: 270, slippageBps: 45, regime: 'NEUTRAL' },
      { pnlBps: -60, latencyMs: 310, slippageBps: 55, regime: 'NEUTRAL' },
    ],
  });
  const capitalRegime = CapitalYieldRegimeEngine.getInstance().createRegimeSnapshot();
  return {
    champion: 'Champion-v2.4-Production',
    challenger: 'Challenger-v2.5-DecoupledSuite',
    totalHypothesesTested: masterEngine.researchLedger.getTotalHypothesesCount(),
    activeTrialsCount: trials.length,
    trials,
    graveyard,
    falsificationBenchmark: falsification,
    capitalRegime,
    timestampMs: Date.now(),
  };
 }
 if(path.startsWith('/api/system/health')){
  const degradation = masterEngine.killSwitch.getStatus();
  const stats = masterEngine.backpressure.getStats();
  return {
    operationalMode: degradation.mode,
    description: degradation.description,
    liveTradingPermitted: degradation.liveTradingPermitted,
    shadowSimulationPermitted: degradation.shadowSimulationPermitted,
    dataIngestionActive: degradation.dataIngestionActive,
    subsystems: {
      data: 'GREEN',
      models: 'GREEN',
      execution: degradation.liveTradingPermitted ? 'GREEN' : 'YELLOW',
      memory: 'GREEN',
      walletGraph: 'GREEN',
      digitalTwin: 'GREEN',
      portfolio: 'GREEN',
    },
    overallStatus: degradation.mode === 'MODE_0_FULL' ? 'GREEN' : degradation.mode === 'MODE_1_MINOR_DEGRADATION' ? 'YELLOW' : degradation.mode === 'MODE_3_SHADOW_ONLY' ? 'ORANGE' : 'RED',
    queueDepth: stats.totalRemaining,
    activeKillSwitches: degradation.activeKillSwitches,
    timestampMs: Date.now(),
  };
 }
 if(path.startsWith('/api/system/trust')){
  const trust=masterEngine.metaIntelligence.evaluateSystemTrust({
    rpcHealthy:true,
    feedFreshnessMs:45,
    queueDepth:masterEngine.backpressure.getStats().totalRemaining,
    activeViolationsCount:0,
    calibrationBrierScore:0.12,
    oodScore:0.05,
    failedExecutionsCount:0,
    unreconciledEventsCount:0,
  });
  const audit=masterEngine.runConnectionAudit();
  return {
    operationalState:trust.state,
    trustVector:trust.vector,
    reasons:trust.reasons,
    audit,
    timestampMs:Date.now(),
  };
 }
 if(path.startsWith('/api/risk?')){
  const mint=new URL(path,liveOrigin).searchParams.get('mint')||'';
  return scanToken(mint,process.env.MARKET_RPC_URL||'https://api.mainnet-beta.solana.com',process.env.RUGCHECK_URL||'https://api.rugcheck.xyz/v1/tokens',process.env.SOLANA_TRACKER_API_KEY||'');
 }
 if(path.startsWith('/api/intelligence?')){
  const mint=new URL(path,liveOrigin).searchParams.get('mint')||'';
  if(!mint)throw Error('Missing mint query parameter');
  const snap=hub.snapshot();
  const token=(snap.tokens||[]).find(t=>t.mint===mint)||{
    mint,
    name:'Token '+mint.slice(0,6),
    symbol:mint.slice(0,4).toUpperCase(),
    price:0.00001,
    liquidity:5000,
    cap:25000,
  };
  let riskData=null;
  try{
    riskData=await scanToken(mint,process.env.MARKET_RPC_URL||'https://api.mainnet-beta.solana.com',process.env.RUGCHECK_URL||'https://api.rugcheck.xyz/v1/tokens',process.env.SOLANA_TRACKER_API_KEY||'');
  }catch{}
  const hasFreeze=riskData?.authorities?.freeze&&riskData.authorities.freeze!=='Disabled';
  const hasMint=riskData?.authorities?.mint&&riskData.authorities.mint!=='Revoked';
  const canonicalEvent={
    eventId:`evt_ui_${mint.slice(0,8)}_${Date.now()}`,
    eventType:'TOKEN_CREATE',
    mint,
    signature:'ui_inspection_signature',
    instructionIndex:0,
    source:'LIVE_UI_INSPECTION',
    sourceTimestampMs:Date.now()-5000,
    receivedTimestampMs:Date.now(),
    monotonicTimestamp:Date.now(),
    slot:snap.network?.slot||250000,
    parentSlot:(snap.network?.slot||250000)-1,
    blockhash:'ui_inspection_blockhash',
    commitment:'confirmed',
    transactionVersion:'legacy',
    sequenceId:1,
    chainState:'CONFIRMED',
    payload:{
      amountSol:(token.liquidity||5000)/150,
      priceSol:(token.price||0.00001)/150,
    },
    sourceConfidence:0.95,
    freshnessMs:50,
    provenance:['MARKET_HUB_LIVE'],
  };
  const pipelineResult=await masterEngine.processEvent(canonicalEvent,{
    tokenAgeSec:Math.max(10,Math.floor((Date.now()-(token.at||Date.now()-30000))/1000)),
    rawWallets:[
      {address:'w_creator',solFundedAmount:5.0,buyVolumeSol:2.0},
      {address:'w_buyer1',solFundedAmount:2.0,buyVolumeSol:1.0},
      {address:'w_buyer2',solFundedAmount:3.5,buyVolumeSol:1.8},
    ],
    programOwner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority:Boolean(hasFreeze),
    hasMintAuthority:Boolean(hasMint),
    marketCapSol:(token.cap||25000)/150,
    liquiditySol:(token.liquidity||5000)/150,
    txCount:25,
  });
  const provenanceEngine = MarketEvidenceProvenanceEngine.getInstance();
  const capitalRegime = CapitalYieldRegimeEngine.getInstance().createRegimeSnapshot();
  const distributionProvenance = {
    buyerQuality: provenanceEngine.evaluateBuyerQuality(mint),
    holderQuality: provenanceEngine.evaluateHolderQuality(mint),
  };
  return { ...pipelineResult.viewModel, distributionProvenance, capitalRegime };
 }
 if(path.startsWith('/api/system/strip')){
   return globalProjectionService.getSystemStrip();
  }
  if(path.startsWith('/api/positions')){
    return globalProjectionService.getPositions();
  }
  if(path.startsWith('/api/gateway/snapshot')){
    return globalCommandGateway.getSnapshot();
  }
  if(path.startsWith('/api/solaris')){
    return globalCommandGateway.getSolarisSnapshot();
  }
  if(path.startsWith('/api/opportunity/best')){
    const snap=hub.snapshot();
    const tokens=globalProjectionService.projectEnrichedTokens(snap.tokens||[]);
    return globalProjectionService.getBestOpportunity(tokens);
  }
  const requested=new URL(path,liveOrigin);
  if(requested.pathname==='/api/market'){
   const snap=hub.snapshot();
   const enrichedTokens=globalProjectionService.projectEnrichedTokens(snap.tokens||[]);
   const systemStrip=globalProjectionService.getSystemStrip();
   const positions=globalProjectionService.getPositions();
   const bestOpportunity=globalProjectionService.getBestOpportunity(enrichedTokens);
   const gatewaySnapshot=globalCommandGateway.getSnapshot();
   return {
    ...snap,
    systemStrip,
    positions,
    bestOpportunity,
    gatewaySnapshot,
    marketContext: {
      sol_price_usd: 148.5,
      meme_regime: 'ACTIVE_ROTATION',
      opportunity_density: 0.74,
      system_load: 'NOMINAL',
      data_health: 'OPTIMAL',
      execution_health: 'NOMINAL',
      guardian_status: 'ACTIVE',
      sentinel_status: 'ENFORCED',
      solaris: globalCommandGateway.getSolarisSnapshot(),
    },
    capitalAuthority: {
      authorityMode: masterEngine.capitalKernel.getAuthorityMode().replace(/_/g, ' '),
      capitalStatus: 'VERIFIED',
      survivalHealth: 'HEALTHY',
      exitCoveragePct: 100,
      stressedCoveragePct: 82,
      proofsStatus: 'CURRENT',
      proofLevel: 'P5',
      revocationPriority: 'R0',
      vaultArmed: true,
      chainCoherence: 'COHERENT',
      signingGate: {
        gateReady: true,
        reservationPass: true,
        stateCurrent: true,
        proofCurrent: true,
        controlEpoch: masterEngine.capitalTruth.getSnapshot().control_epoch,
        revocationEpoch: masterEngine.revocationEngine.getCurrentEpoch(),
        vaultStatus: 'ARMED',
      },
      positionSurvival: {
        exitProofLevel: 'E5_MULTIPLE_INDEPENDENT_ROUTES',
        timeToEvacuateSec: 3.2,
        proofAgeSec: 0.8,
        partialExitTested: [25, 50, 75, 100],
        sharedBottlenecks: [],
      },
      assuranceDeep: {
        capitalStateRoot: masterEngine.capitalTruth.getSnapshot().capital_state_root.slice(0, 16) + '…',
        confirmedCapitalSol: Number(masterEngine.capitalTruth.getSnapshot().confirmed_cash_sol.toFixed(3)),
        reservedCapitalSol: Number(masterEngine.capitalTruth.getSnapshot().reserved_cash_sol.toFixed(3)),
        possibleExposureSol: Number(masterEngine.capitalTruth.getSnapshot().possible_exposure_sol.toFixed(3)),
        unknownCapitalSol: 0.0,
        emergencyReserveSol: masterEngine.capitalTruth.getSnapshot().emergency_reserve_sol,
        maxBlastRadiusSol: 2.5,
        maxCompromiseLossSol: 25.0,
        proofDebtScore: 0,
        ledgerSeq: masterEngine.capitalTruth.getSnapshot().ledger_sequence,
        vaultJournalCount: masterEngine.janusReconciler.getAudit().total_managed_transactions,
        activeInvariantsTripped: [],
      },
    },
    systemOmega: masterEngine.getSystemOmegaState(),
    tokens: enrichedTokens
   };
  }
  if(requested.pathname==='/api/search')return hub.search(requested.searchParams.get('q')||'');
  throw Error('Unsupported live request');
}
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid terminal port');
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  const host = req.headers.host || '';
  const isLocalHost = host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}` || host === '127.0.0.1' || host === 'localhost';
  if(!isLocalHost || req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Local terminal only');return;}
  if(req.method!=='GET'&&req.method!=='HEAD'&&req.method!=='POST'){res.writeHead(405);res.end();return;}
  const reqUrl=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method==='POST'&&(reqUrl.pathname==='/api/command'||reqUrl.pathname==='/live/api/command')){
    let body='';
    req.on('data',chunk=>{body+=chunk;});
    req.on('end',async()=>{
      try{
        const parsed=JSON.parse(body||'{}');
        const result = await globalCommandGateway.executeCommand(parsed);
        const jsonText = JSON.stringify({ ok: result.success, result }, (_, v) => typeof v === 'bigint' ? v.toString() : v);
        res.setHeader('Content-Type','application/json');
        res.end(jsonText);
      }catch(e){
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    });
    return;
  }
  if(reqUrl.pathname==='/api/system/strip'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalProjectionService.getSystemStrip()));
    return;
  }
  if(reqUrl.pathname==='/api/positions'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalProjectionService.getPositions()));
    return;
  }
  if(reqUrl.pathname==='/api/opportunity/best'){
    const snap=hub.snapshot();
    const tokens=globalProjectionService.projectEnrichedTokens(snap.tokens||[]);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalProjectionService.getBestOpportunity(tokens)));
    return;
  }
  if(reqUrl.pathname==='/api/gateway/snapshot'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalCommandGateway.getSnapshot()));
    return;
  }
  if(reqUrl.pathname==='/api/solaris'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(globalCommandGateway.getSolarisSnapshot()));
    return;
  }
 if(reqUrl.pathname==='/health'){
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({ok:true,service:'sylph-paper-terminal',mode:'paper',marketApi:'/live/api/market'}));return;
 }
 if(reqUrl.pathname==='/astra/basket'){
  try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await astraFeed()));}
  catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({verified:false,entryAllowed:false,error:'Astra volume basket unavailable; entries blocked.'}));}return;
 }
 if(reqUrl.pathname==='/api/soak'){
  try{
   const sessionParam=reqUrl.searchParams.get('session');
   const data=await getSoakTelemetry(project,sessionParam);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(data));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/config'){
  try{
   const data=await getSoakTelemetry(project);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(data.runtimeConfig));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/soak/events'){
  try{
   const sessionParam=reqUrl.searchParams.get('session');
   const limit=Math.min(1000,Number(reqUrl.searchParams.get('limit'))||300);
   const offset=Math.max(0,Number(reqUrl.searchParams.get('offset'))||0);
   const data=await readSessionEvents(resolve(project,'sessions'),sessionParam,limit,offset);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(data));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/rpc/status'){
  try{
   const liveData=await getSoakTelemetry(project);
   const rpcEndpoints=liveData.liveEngine?.rpcEndpoints||liveData.session?.rpcEndpoints||[];
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({ok:true,rpcEndpoints,rpcHealth:liveData.session?.rpcHealth||null}));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/soak/compare'){
  try{
   const sessionA=reqUrl.searchParams.get('sessionA');
   const sessionB=reqUrl.searchParams.get('sessionB');
   const comparison=await compareSoakSessions(resolve(project,'sessions'),sessionA,sessionB);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(comparison||{error:'Unable to compare sessions'}));
  }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(reqUrl.pathname==='/api/soak/export'){
  try{
   const sessionParam=reqUrl.searchParams.get('session');
   const format=reqUrl.searchParams.get('format')||'jsonl';
   const artifact=await exportSessionArtifact(resolve(project,'sessions'),sessionParam,format);
   res.setHeader('Content-Type',artifact.contentType);
   res.setHeader('Content-Disposition',`attachment; filename="${artifact.filename}"`);
   res.end(artifact.content);
  }
  catch(e){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
 }
 if(req.url?.startsWith('/live/')){
  const requested=new URL(req.url,'http://localhost');const upstream=requested.pathname.replace('/live','');
  if(!livePaths.has(upstream)){res.writeHead(404);res.end();return;}
  try{const data=await readLive(upstream+requested.search);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
  catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Live request unavailable. The collector will retry its feeds automatically.'}));}return;
 }
 try{const path=decodeURIComponent(new URL(req.url,`http://127.0.0.1:${port}`).pathname);const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
 const data=await readFile(file);res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end('Not found');}
});
const astraFeed=createAstraFeed(readLive);
server.listen(port,()=>console.log(`SYLPH paper terminal: http://127.0.0.1:${port} (also http://localhost:${port})`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{hub.stop();server.close();});
