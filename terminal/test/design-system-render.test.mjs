import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, relative, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const directory=resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const temp=mkdtempSync(join(tmpdir(),'sylph-render-'));
const files=['components/CapitalCommandView.jsx','components/IncidentCommandView.jsx','components/AetherFlux.jsx','design-system/primitives.jsx','design-system/format.js','components/CommandCenterView.jsx','components/discovery-view.js','components/TokenClassification.jsx','position-sizer.js'];
const output=path=>join(temp,path.replaceAll('/','_').replace(/\.(jsx|js)$/,'')+'.cjs');
for(const file of files){
 let source=readFileSync(join(directory,'src',file),'utf8');
 source=source.replace(/from ['"]([^'"]+)['"]/g,(_,specifier)=>{
  const resolved=specifier.startsWith('.')?output(relative(join(directory,'src'),resolve(dirname(join(directory,'src',file)),specifier)).replaceAll('\\','/')):require.resolve(specifier);
  return 'from '+JSON.stringify(resolved);
 });
 writeFileSync(output(file),ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText);
}
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const components={capital:require(output(files[0])).CapitalCommandView,incidents:require(output(files[1])).IncidentCommandView,discovery:require(output(files[2])).AetherFlux,command:require(output(files[5])).CommandCenterView};
components.classification=require(output('components/TokenClassification.jsx')).TokenClassification;
const render=(name,props)=>renderToStaticMarkup(React.createElement(components[name],props));
after(()=>rmSync(temp,{recursive:true,force:true}));
const position={mint:'test-mint',asset:'test-pool',entryPriceUsd:.00001234};
test('missing and expired capability never renders an enabled paper close',()=>{
 for(const props of [{},{current:false,mode:'SIMULATION',capabilities:{close:{state:'READY'}}},{current:true,mode:'SIMULATION',capabilities:{}},{current:true,mode:'LIVE',capabilities:{close:{state:'READY'}}}]) {
   const html=render('capital',{...props,positions:[position]});
   assert.match(html,/<button[^>]*disabled=""[^>]*>Review paper close/);
 }
});
test('paper close requires both mint and pool identity',()=>{
 const props={current:true,mode:'SIMULATION',capabilities:{close:{state:'READY'}}};
 assert.match(render('capital',{...props,positions:[{mint:'mint'}]}),/<button[^>]*disabled=""/);
 assert.doesNotMatch(render('capital',{...props,positions:[position]}),/<button[^>]*disabled=""/);
});
test('missing capital and incident records never imply reconciliation or health',()=>{
 const capital=render('capital',{current:true});
 assert.doesNotMatch(capital,/AUTHORITATIVE|LOCKED \(10%\)|Ledger is reconciled/);
 assert.match(capital,/Unknown/);
 const incident=render('incidents',{current:true});
 assert.match(incident,/No incidents reported/);
 assert.doesNotMatch(incident,/operating within nominal bounds/);
});
test('command missing evidence has no fabricated financial or verification facts',()=>{
 const html=render('command',{});
 assert.match(html,/Current capability is unknown|Waiting for backend evidence/);
 assert.match(html,/Available · USD<\/dt><dd>Unknown/);
 assert.match(html,/Reserved · USD<\/dt><dd>Unknown/);
 assert.match(html,/Exposure: Unknown/);
 assert.doesNotMatch(html,/\$150\.00|\$0\.00|RECONCILED|CERTIFIED|VERIFIED CURRENT|HEALTHY|4 \/ 4 signed rules active|11 \/ 11 synthetic on-chain replay probes passing|tombstone ledger active/);
 assert.match(html,/Registry signature, rule count, and epoch are not present/);
 assert.match(html,/Verification Evidence Availability/);
 assert.doesNotMatch(html,/Active Certified Rules|Formal Safety/);
});
test('command reports current projection facts without inventing exposure',()=>{
 const html=render('command',{current:true,projection:{capital:{available:81.25,reserved:12},positions:[],rows:[],system:{state:'OPERATIONAL'},marketData:{state:'CURRENT'},capabilities:{open:{state:'BLOCKED',reasonCodes:['RISK_UNKNOWN']}}}});
 assert.match(html,/\$81\.25/);
 assert.match(html,/\$12\.00/);
 assert.match(html,/0 reported/);
 assert.match(html,/Exposure: Unknown/);
 assert.match(html,/risk unknown/);
 assert.doesNotMatch(html,/RECONCILED|\$150\.00/);
});
test('expired command projection marks candidate tier historical and capability unknown',()=>{
 const token={mint:'fixture-mint',symbol:'FIX',tier:'PRIME',price:.00001234};
 const html=render('command',{current:false,projection:{rows:[token],capabilities:{open:{state:'READY'}},capital:{available:7}}});
 assert.match(html,/Historical Prime tier/);
 assert.match(html,/Current capability is unknown/);
 assert.doesNotMatch(html,/Prime at current projection|capabilities need inspection/);
 assert.match(html,/Investigate FIX/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Investigate FIX/);
});
test('command candidate investigation is a named native control with full token context',()=>{
 const token={mint:'fixture-mint',symbol:'FIX',tier:'PRIME',price:.00001234};
 const html=render('command',{current:true,projection:{rows:[token]},onInvestigate:()=>{}});
 assert.match(html,/<button[^>]*>Investigate FIX<\/button>/);
 assert.doesNotMatch(html,/onClick="|cursor: ?pointer/);
 assert.match(html,/\$0\.00001234/);
});
test('discovery empty state is outside breakpoint-hidden table/card containers',()=>{
 const html=render('discovery',{});
 assert.match(html,/No observed candidates/);
 assert.doesNotMatch(html,/class="op-grid-scroll"|class="op-mobile-candidates"/);
});
test('populated discovery provides the same identity on desktop and mobile',()=>{
 const token={mint:'mint-fixture',symbol:'FIXTURE',tier:'DEVELOPING',pending:[],vetoes:[]};
 const html=render('discovery',{tokens:[token],stableOrder:[token.mint],comparison:[token.mint]});
 assert.match(html,/class="op-grid-scroll"/);assert.match(html,/class="op-mobile-candidates"/);
 assert.equal((html.match(/data-token="mint-fixture"/g)||[]).length,3); // table, card, comparison
 assert.match(html,/Remove FIXTURE from comparison/);
});
test('small token prices retain meaningful precision',async()=>{
 const {formatPrice}=await import('../src/design-system/format.js');
 assert.notEqual(formatPrice(.00001234),'$0.00');
 assert.match(formatPrice(1e-12),/e-12/);assert.equal(formatPrice(null),'Unknown');
});

test('expired discovery never renders a successful safety badge',()=>{const token={mint:'fixture',symbol:'FIX',safety:'CHECKS_PASSED',tier:'DEVELOPING',pending:[],vetoes:[]};const html=render('discovery',{tokens:[token],stableOrder:[token.mint],comparison:[token.mint],current:false});assert.doesNotMatch(html,/op-status-success/);assert.match(html,/Historical safety/);});


test('discovery shows display sort and accessible counted evidence filters',()=>{
 const html=render('discovery',{tokens:[{mint:'alpha',symbol:'ALPHA',tier:'PRIME'}],stableOrder:['alpha'],comparison:['alpha']});
 assert.match(html,/Sort observations/);
 assert.match(html,/Liquidity: high to low/);
 assert.match(html,/aria-label="Discovery evidence views"/);
 assert.match(html,/Prime · 1/);
 assert.match(html,/aria-label="Remove ALPHA from comparison"/);
});
test('discovery directs an empty ranking snapshot to refresh instead of clearing filters',()=>{
 const html=render('discovery',{tokens:[{mint:'alpha',symbol:'ALPHA'}],stableOrder:[]});
 assert.match(html,/Refresh the discovery snapshot/);
 assert.match(html,/none belong to the current ranking snapshot/);
 assert.doesNotMatch(html,/Clear filters/);
});

test('token classification never infers quality or eligibility from ranking tier',()=>{
 const html=render('classification',{current:true,token:{tier:'PRIME'}});
 assert.equal((html.match(/<dd>UNKNOWN<\/dd>/g)||[]).length,3);
 assert.doesNotMatch(html,/>PASS<|>ELIGIBLE<|Permit granted|Security clean/);
});

test('expired token classifications preserve history without current positive claims',()=>{
 const html=render('classification',{current:false,token:{quality:'PASS',opportunity:'ELIGIBLE',execution:'AVAILABLE',decision:{summary:'Safe to execute'}}});
 assert.equal((html.match(/<dd>UNKNOWN<\/dd>/g)||[]).length,3);
 assert.match(html,/Historical observation: PASS/);
 assert.doesNotMatch(html,/Safe to execute|Permit granted/);
});

test('current explicit token classification reports observations without inventing a permit',()=>{
 const html=render('classification',{current:true,token:{quality:'PASS',opportunity:'ELIGIBLE',execution:'AVAILABLE'}});
 assert.match(html,/<dd>PASS<\/dd>/);
 assert.match(html,/<dd>ELIGIBLE<\/dd>/);
 assert.match(html,/<dd>AVAILABLE<\/dd>/);
 assert.match(html,/inspect the operating envelope/);
 assert.doesNotMatch(html,/Permit granted/);
});

test('malformed classification enums cannot create claims or resolve inherited properties',()=>{
 for (const current of [true,false]) {
  for (const value of ['__proto__','constructor','toString','SAFE','',null,{},['PASS']]) {
   const html=render('classification',{current,token:{quality:value,opportunity:value,execution:value}});
   assert.equal((html.match(/<dd>UNKNOWN<\/dd>/g)||[]).length,3);
   assert.equal((html.match(/Evidence unavailable/g)||[]).length,3);
   assert.doesNotMatch(html,/Historical observation:/);
  }
 }
});
