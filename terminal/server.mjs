import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {createAstraFeed} from './astra-feed.mjs';
import {getSoakTelemetry, exportSessionArtifact, readSessionEvents, compareSoakSessions} from './soak-reader.mjs';
import {capitalEvidence, marketContextEvidence, tokenEvidence} from './evidence-view.mjs';
import {isLocalRequest, readCommand} from './local-request.mjs';
import {globalProviderHealthTracker} from '../dist/platform/ingestion/provider-health.js';
import {MarketHub, validMint} from '../dist/market-hub.js';
import {scanToken} from '../dist/risk.js';
import {MasterIntelligenceEngine} from '../dist/intelligence/master-orchestrator.js';
import {globalCommandGateway} from '../dist/command-gateway.js';
import {globalProjectionService} from '../dist/projection-service.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';
import {CapitalYieldRegimeEngine} from '../dist/intelligence/research/capital-regime.js';
import {globalReleaseCertificationAuthority} from '../dist/platform/certification/release-certification.js';

process.on('uncaughtException', () => {
  console.error('Terminal stopped after an uncaught exception. Error details omitted to protect credentials.');
  process.exit(1);
});
process.on('unhandledRejection', () => {
  console.error('Terminal stopped after an unhandled rejection. Error details omitted to protect credentials.');
  process.exit(1);
});
const masterEngine = new MasterIntelligenceEngine();
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const port=Number(process.env.TERMINAL_PORT||8793);
const liveOrigin='http://127.0.0.1:8788';
const livePaths=new Set(['/api/market','/api/search','/api/risk','/api/intelligence','/api/system/trust','/api/research/audit','/api/system/health','/api/capital/authority','/api/system/omega','/api/system/strip','/api/positions','/api/opportunity/best','/api/gateway/snapshot','/api/command','/api/solaris']);
const project=fileURLToPath(new URL('../',import.meta.url));
const hub=new MarketHub(resolve(project,'data/watchlist.json'),process.env.MARKET_RPC_URL||'https://api.mainnet-beta.solana.com',resolve(project,'data/kol_wallets.txt'));
await hub.start();
if (globalLifecycle.getState() === 'BOOT') {
  globalLifecycle.transition('INITIALIZING', 'Terminal startup');
  globalLifecycle.transition('CONNECTING', 'Market adapters starting; live capital unverified');
}
async function readLive(path){
 if(path.startsWith('/api/system/omega')){
  const cert = globalReleaseCertificationAuthority.getReport();
  return {evidenceStatus: 'UNAVAILABLE', releaseStatus: cert.releaseStatus, isProductionPermitted: false, gates: cert.gates, primaryBlockers: cert.primaryBlockers, reason: 'Production certification blocked: mandatory gates incomplete or unverified on mainnet.'};
 }
 if(path.startsWith('/api/capital/authority')) return capitalEvidence();
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
    evidenceStatus: 'ILLUSTRATIVE_RESEARCH',
    champion: null,
    challenger: null,
    totalHypothesesTested: masterEngine.researchLedger.getTotalHypothesesCount(),
    activeTrialsCount: trials.length,
    trials,
    graveyard,
    falsificationBenchmark: falsification,
    capitalRegime,
    timestampMs: Date.now(),
  };
 }
  if(path.startsWith('/api/system/health') || path.startsWith('/api/system/trust')) {
    const health = globalProviderHealthTracker.getReport();
    const cert = globalReleaseCertificationAuthority.getReport();
    return {
      evidenceStatus: 'PARTIAL',
      operationalState: globalLifecycle.getState(),
      liveTradingPermitted: false,
      releaseStatus: cert.releaseStatus,
      isProductionPermitted: cert.isProductionPermitted,
      certification: cert,
      providers: health.providers,
      overallStatus: health.overallSystemState,
      activeAlerts: health.activeAlerts,
      reasons: cert.primaryBlockers,
      timestampMs: Date.now()
    };
  }
 if(path.startsWith('/api/risk?')){
  const mint=new URL(path,liveOrigin).searchParams.get('mint')||'';
  return scanToken(mint,process.env.MARKET_RPC_URL||'https://api.mainnet-beta.solana.com',process.env.RUGCHECK_URL||'https://api.rugcheck.xyz/v1/tokens',process.env.SOLANA_TRACKER_API_KEY||'');
 }
 if(path.startsWith('/api/intelligence?')){
  const mint=new URL(path,liveOrigin).searchParams.get('mint')||'';
  if(!validMint(mint))throw Error('Invalid mint query parameter');
  const snap=hub.snapshot();
  const token=(snap.tokens||[]).find(t=>t.mint===mint);
  let riskData = null;
  try { riskData = await scanToken(mint, process.env.MARKET_RPC_URL || 'https://api.mainnet-beta.solana.com', process.env.RUGCHECK_URL || 'https://api.rugcheck.xyz/v1/tokens', process.env.SOLANA_TRACKER_API_KEY || ''); } catch {}
  return tokenEvidence(mint, token, riskData);
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
   const cert = globalReleaseCertificationAuthority.getReport();
   return {
    ...snap,
    systemStrip,
    positions,
    bestOpportunity,
    gatewaySnapshot,
    marketContext: marketContextEvidence(systemStrip),
    capitalAuthority: capitalEvidence(),
    systemOmega: {evidenceStatus: 'UNAVAILABLE', releaseStatus: cert.releaseStatus, reason: 'Production certification blocked: mandatory gates incomplete or unverified on mainnet.'},
    releaseCertification: cert,
    tokens: enrichedTokens
   };
  }
  if(requested.pathname==='/api/search')return hub.search(requested.searchParams.get('q')||'');
  throw Error('Unsupported live request');
}
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid terminal port');
const server=createServer((req,res)=>{
  handleRequest(req,res).catch(() => {
    if (!res.headersSent) res.writeHead(500, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'Terminal request failed'}));
  });
});
async function handleRequest(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  if (!isLocalRequest(req, port)) {res.writeHead(403);res.end('Local terminal only');return;}
  if(req.method!=='GET'&&req.method!=='HEAD'&&req.method!=='POST'){res.writeHead(405);res.end();return;}
  const reqUrl=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method==='POST'&&(reqUrl.pathname==='/api/command'||reqUrl.pathname==='/live/api/command')){
    try {
      const parsed = await readCommand(req);
      const result = await globalCommandGateway.executeCommand(parsed);
      res.writeHead(result.success ? 200 : 409, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: result.success, result}, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    } catch (e) {
      res.writeHead(e.status || 400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: false, error: e.status ? e.message : 'Command could not be processed'}));
    }
    return;
  }
  if (req.method === 'POST') {res.writeHead(405);res.end();return;}
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
  try {
    const path = decodeURIComponent(new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).pathname);
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    let data;
    try {
      if (file.startsWith(resolve(root) + sep)) {
        data = await readFile(file);
      }
    } catch {
      const fallbackRoot = resolve(project, 'ui');
      const fallbackFile = resolve(fallbackRoot, '.' + (path === '/' ? '/index.html' : path));
      if (fallbackFile.startsWith(fallbackRoot + sep)) {
        data = await readFile(fallbackFile);
        file = fallbackFile;
      }
    }
    if (!data) throw new Error('Not found');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>SYLPH Terminal</title><style>body{background:#0d131a;color:#e1e7ed;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{text-align:center;max-width:520px;padding:32px;background:#152331;border-radius:12px;border:1px solid #233547;box-shadow:0 8px 32px rgba(0,0,0,0.5);}h1{color:#14F195;margin-bottom:8px;font-size:24px;}p{color:#8ea3b7;line-height:1.6;font-size:14px;}pre{background:#0b1118;padding:12px;border-radius:6px;color:#7adfff;font-size:13px;border:1px solid #1c2b3a;}a{color:#00C2FF;text-decoration:none;font-weight:bold;display:inline-block;margin-top:10px;}</style></head><body><div><h1>SYLPH Terminal Online</h1><p>The engine and market feeds are active. To load the full UI bundle, run in your Codespace terminal:</p><pre>git fetch origin && git reset --hard origin/main && node terminal/server.mjs</pre><p><a href="/live/api/system/health">View Live System Health Telemetry &rarr;</a></p></div></body></html>`);
  }
}
const astraFeed=createAstraFeed(readLive);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const host = process.env.TERMINAL_HOST || '0.0.0.0';
server.listen(port, host,()=>console.log(`SYLPH paper terminal: http://localhost:${port} | Phone / Local LAN: http://192.168.1.155:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{hub.stop();server.close();});
