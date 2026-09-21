#!/usr/bin/env node
import fs from 'node:fs';import readline from 'node:readline';import {fileURLToPath} from 'node:url';
import {reducer,initialState} from '../terminal/src/engine.js';
import {applyLedgerEvent} from './ledger-events.mjs';
export async function verifyReplay(filePath,snapshot=null){
 let state=initialState(0),eventsReplayed=0,lineNumber=0;const violations=[];const explicit=snapshot!=null;
 for await(const line of readline.createInterface({input:fs.createReadStream(filePath,{encoding:'utf8'}),crlfDelay:Infinity})){
  lineNumber++;if(!line.trim())continue;let event;
  try{event=JSON.parse(line);}catch{violations.push('Invalid JSON at line '+lineNumber);continue;}
  if(event.type==='SESSION_START'){state={...state,now:event.timestamp??0};continue;}
  if(event.type==='SESSION_CHECKPOINT'){if(!explicit)snapshot=event.payload;continue;}
  try{const next=applyLedgerEvent(state,event,reducer);if(next!==state)eventsReplayed++;state=next;}catch(e){violations.push('Line '+lineNumber+': '+e.message);}
  if(!Number.isFinite(state.cash)||state.cash<-.0001)violations.push('Invalid cash at line '+lineNumber);
  for(const p of state.positions)if(!Number.isFinite(p.qty)||p.qty<=1e-9||!Number.isFinite(p.entry)||p.entry<=0)violations.push('Invalid position '+p.asset);
 }
 const snapshotCash=snapshot?.cash??snapshot?.cashUsd??null;
 const cashDeltaUsd=snapshotCash==null?null:state.cash-snapshotCash;
 if(!Number.isFinite(snapshotCash))violations.push('Missing or invalid checkpoint cash');
 else if(Math.abs(cashDeltaUsd)>.0001)violations.push('Cash delta '+cashDeltaUsd);
 if(!Array.isArray(snapshot?.positions))violations.push('Missing checkpoint positions');
 else {
  if(snapshot.positions.length!==state.positions.length)violations.push('Position count mismatch');
  for(const p of state.positions){const q=snapshot.positions.find(x=>x.asset===p.asset);if(!q||!Number.isFinite(q.qty)||Math.abs(q.qty-p.qty)>1e-6)violations.push('Position quantity mismatch: '+p.asset);}
 }
 return {eventsReplayed,replayedEndingCash:state.cash,snapshotEndingCash:snapshotCash,cashDeltaUsd,openPositionsCount:state.positions.length,isDeterministicMatch:violations.length===0,invariantViolations:violations};
}
if(process.argv[1]===fileURLToPath(import.meta.url))verifyReplay(process.argv[2]).then(r=>{console.log(JSON.stringify(r,null,2));process.exitCode=r.isDeterministicMatch?0:1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
