import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function analyzePumpEvents(events){
 if(!Array.isArray(events))throw Error('INVALID_EVENTS');
 const mints=new Map(),seen=new Set();let outside=0;
 for(const e of events){
  if(!e||!['CREATE','TRADE','COMPLETE','MIGRATE'].includes(e.type)||!e.mint||!e.signature||!Number.isSafeInteger(e.slot)||!Number.isInteger(e.eventIndex))throw Error('INVALID_EVENT_IDENTITY');
  const time=Date.parse(e.timestamp);
  if(!Number.isFinite(time))throw Error('INVALID_TIMESTAMP');
  if(time<Date.parse('2025-10-01T00:00:00Z')||time>=Date.parse('2026-10-13T00:00:00Z')){outside++;continue;}
  const id=e.signature+':'+e.eventIndex;if(seen.has(id))throw Error('DUPLICATE_EVENT');seen.add(id);
  if(!mints.has(e.mint))mints.set(e.mint,{mint:e.mint,createdAt:null,creator:null,firstTradeAt:null,lastTradeAt:null,tradeCount:0,uniqueTraders:new Set(),completeAt:null,migratedAt:null,firstObservedPrice:null,peakObservedPrice:null,peakAt:null});
  const s=mints.get(e.mint);
  if(e.type==='CREATE'){if(s.createdAt)throw Error('DUPLICATE_CREATE');s.createdAt=e.timestamp;s.creator=e.creator??null;}
  if(e.type==='COMPLETE'&&(!s.completeAt||time<Date.parse(s.completeAt)))s.completeAt=e.timestamp;
  if(e.type==='MIGRATE'&&(!s.migratedAt||time<Date.parse(s.migratedAt)))s.migratedAt=e.timestamp;
  if(e.type==='TRADE'){
   if(!e.trader||!['BUY','SELL'].includes(e.side)||typeof e.quoteAmount!=='number'||typeof e.baseAmount!=='number'||!Number.isFinite(e.quoteAmount)||!Number.isFinite(e.baseAmount)||e.quoteAmount<=0||e.baseAmount<=0)throw Error('INVALID_TRADE');
   const price=e.quoteAmount/e.baseAmount;s.tradeCount++;s.uniqueTraders.add(e.trader);
   if(!s.firstTradeAt||time<Date.parse(s.firstTradeAt)){s.firstTradeAt=e.timestamp;s.firstObservedPrice=price;}
   if(!s.lastTradeAt||time>Date.parse(s.lastTradeAt))s.lastTradeAt=e.timestamp;
   if(!s.peakAt||price>s.peakObservedPrice){s.peakAt=e.timestamp;s.peakObservedPrice=price;}
  }
 }
 const tokens=[...mints.values()].map(s=>{
  if(s.createdAt&&s.firstTradeAt&&Date.parse(s.firstTradeAt)<Date.parse(s.createdAt))throw Error('TRADE_BEFORE_CREATE');
  if(s.completeAt&&s.migratedAt&&Date.parse(s.migratedAt)<Date.parse(s.completeAt))throw Error('MIGRATION_BEFORE_COMPLETE');
  const {uniqueTraders,...rest}=s;
  return {...rest,uniqueTraderCount:uniqueTraders.size,peakMultiple:s.firstObservedPrice>0?s.peakObservedPrice/s.firstObservedPrice:null,timeToPeakSeconds:s.firstTradeAt&&s.peakAt?(Date.parse(s.peakAt)-Date.parse(s.firstTradeAt))/1000:null,graduated:!!s.migratedAt};
 }).sort((a,b)=>a.mint.localeCompare(b.mint));
 const created=tokens.filter(t=>t.createdAt),graduated=created.filter(t=>t.graduated);
 return {periodStart:'2025-10-01',periodEndExclusive:'2026-10-13',coverage:'SUPPLIED_EVENTS_ONLY_NOT_COMPLETE_CHAIN',liveAuthority:'BLOCKED',summary:{inputEvents:events.length,eventsOutsidePeriod:outside,uniqueMints:tokens.length,observedCreates:created.length,observedGraduations:graduated.length,observedGraduationRate:created.length?graduated.length/created.length:null,observedTradeCount:tokens.reduce((a,t)=>a+t.tradeCount,0)},tokens};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('USAGE_INPUT_OUTPUT');
 const raw=readFileSync(input),result=analyzePumpEvents(JSON.parse(raw.toString('utf8')));
 result.inputSha256=createHash('sha256').update(raw).digest('hex');
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result.summary));
}
