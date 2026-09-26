import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperPortfolio} from '../dist/paper.js';
const SOL='So11111111111111111111111111111111111111112';
const row=(mint,price,at=Date.now())=>({mint,symbol:mint===SOL?'SOL':'TOKEN',name:'Fixture',price,at,change:10,liquidity:60000,volume:100000,cap:100000,pair:'pair',dex:'fixture'});
async function fixture(run) { const dir=await mkdtemp(join(tmpdir(),'paper-evidence-')); try {const file=join(dir,'paper.json');const p=new PaperPortfolio(file);await p.start();await run(p,file);}finally{await rm(dir,{recursive:true,force:true});} }

test('paper token quantity and SOL valuation follow both exchange rates through partial exits',()=>fixture(async(p)=>{
 const token=row('TOKEN',2), sol=row(SOL,100);await p.buy(token,[token,sol]);
 assert.equal(p.snapshot([token,sol]).positions[0].qty,5);
 const risingSol={...sol,price:200};let s=p.snapshot([token,risingSol]);assert.equal(s.positions[0].mark.value,'50000000');assert.equal(s.unrealized,'-50000000');
 await p.sell(token.mint,[token,risingSol],5000);s=p.snapshot([token,risingSol]);assert.equal(s.positions[0].qty,2.5);assert.equal(s.positions[0].cost,'50000000');assert.equal(s.dayPnl,'-25000000');
 await p.sell(token.mint,[token,risingSol]);s=p.snapshot([token,risingSol]);assert.equal(s.positions.length,0);assert.equal(s.cash,'9950000000');assert.equal(s.dayPnl,'-50000000');
}));

test('stale future nonfinite and symbol-spoofed prices never debit cash',()=>fixture(async(p)=>{
 const token=row('TOKEN',2),sol=row(SOL,100), initial=p.snapshot([]).cash;
 for(const invalid of [{...token,at:Date.now()-90000},{...token,at:Date.now()+60000},{...token,price:NaN},{...token,price:Infinity},{...token,price:0},{...token,at:NaN}]) await assert.rejects(p.buy(invalid,[invalid,sol]),/PRICE_EVIDENCE/);
 for(const invalid of [{...sol,at:Date.now()-90000},{...sol,at:Date.now()+60000},{...sol,price:Infinity},{...sol,mint:'SPOOF',symbol:'SOL'}]) await assert.rejects(p.buy(token,[token,invalid]),/PRICE_EVIDENCE/);
 await assert.rejects(p.buy(token,[token,sol,{...sol,price:1}]),/PRICE_EVIDENCE/);
 assert.equal(p.snapshot([]).cash,initial);assert.equal(p.snapshot([]).positions.length,0);
}));

test('snapshots retain observation time and stale actions and automated exits preserve positions',()=>fixture(async(p)=>{
 const at=Date.now()-1000,token=row('TOKEN',2,at),sol=row(SOL,100,at-1000);await p.buy(token,[token,sol]);
 let s=p.snapshot([token,sol]);assert.equal(s.positions[0].mark.at,at-1000);assert.equal(s.feed.last,at-1000);
 const stale=[{...token,price:0.1,at:Date.now()-100000},{...sol,at:Date.now()-100000}];
 await assert.rejects(p.sell('TOKEN',stale),/PRICE_EVIDENCE/);await p.tick(stale);s=p.snapshot(stale);assert.equal(s.positions.length,1);assert.equal(s.positions[0].mark,null);assert.equal(s.feed.healthy,false);assert.ok(s.feed.last<Date.now()-90000);assert.equal(s.cash,'9900000000');
 const future=[{...token,at:Date.now()+100000},sol];assert.equal(p.snapshot(future).feed.last,0);
}));

test('automation revalidates price age after awaited safety check',()=>fixture(async(p)=>{
 const token=row('TOKEN',2),sol=row(SOL,100);await p.setAutoPaper(true);
 await p.tick([token,sol],async()=>{token.at=Date.now()-100000;return {safe:true};});
 assert.equal(p.snapshot([token,sol]).positions.length,0);
}));

test('legacy positions migrate only using unique matching opening evidence',()=>fixture(async(p,file)=>{
 const token=row('TOKEN',2),sol=row(SOL,100);await p.buy(token,[token,sol]);await p.sell('TOKEN',[token,sol],5000);
 let disk=JSON.parse(await readFile(file,'utf8'));let pos=disk.positions.TOKEN;pos.qty=pos.qty*1e9/100;delete pos.economicsVersion;delete pos.entrySolPriceUsd;await writeFile(file,JSON.stringify(disk));
 const migrated=new PaperPortfolio(file);await migrated.start();let s=migrated.snapshot([token,sol]);assert.equal(s.positions[0].qty,2.5);assert.equal(s.positions[0].mark.value,'50000000');assert.equal(s.halted,false);
 await migrated.sell('TOKEN',[token,sol]);assert.equal(migrated.snapshot([token,sol]).cash,'10000000000');
 for(const fills of [[],[disk.fills[0],disk.fills[0]]]) {
  await writeFile(file,JSON.stringify({...disk,fills}));const blocked=new PaperPortfolio(file);await blocked.start();s=blocked.snapshot([token,sol]);assert.equal(s.positions.length,1);assert.equal(s.positions[0].mark,null);assert.equal(s.halted,true);assert.match(s.positions[0].economicsIssue,/evidence/);await assert.rejects(blocked.sell('TOKEN',[token,sol]),/UNRESOLVED/);await blocked.tick([token,sol]);assert.equal(blocked.snapshot([token,sol]).positions.length,1);
 }
}));
