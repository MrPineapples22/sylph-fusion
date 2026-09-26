import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startDiscoveryConnection} from '../src/discovery-connection.js';
const snapshot=()=>({schemaVersion:1,at:Date.now(),rows:[],positions:[]});
const until=async f=>{const end=Date.now()+1500;while(!f()){if(Date.now()>end)throw Error('Condition did not recover');await new Promise(r=>setTimeout(r,5));}};
test('connection survives normal refresh, outage, invalid response and automatic recovery',async()=>{
 let mode='ok',success=0,errors=0,active=0,maxActive=0;
 const stop=startDiscoveryConnection({intervalMs:5,request:async()=>{maxActive=Math.max(maxActive,++active);try{await new Promise(r=>setTimeout(r,2));if(mode==='offline')throw Error('offline');return mode==='bad'?{}:snapshot();}finally{active--;}},onSnapshot:()=>success++,onError:()=>errors++});
 try{await until(()=>success>=10);mode='offline';await until(()=>errors>=3);mode='bad';await until(()=>errors>=5);const before=success;mode='ok';await until(()=>success>=before+10);assert.equal(maxActive,1);}finally{stop();}
});
test('online, focus and visible resume wake refresh without parallel requests',async()=>{
 const events=new EventTarget(),visibility=new EventTarget();visibility.visibilityState='visible';let calls=0,success=0,release;
 const stop=startDiscoveryConnection({events,visibility,intervalMs:60000,request:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return snapshot();},onSnapshot:()=>success++,onError:e=>{throw e;}});
 try{for(let i=0;i<20;i++)events.dispatchEvent(new Event('online'));assert.equal(calls,1);release();await until(()=>success===2);events.dispatchEvent(new Event('focus'));await until(()=>success===3);visibility.dispatchEvent(new Event('visibilitychange'));await until(()=>success===4);}finally{stop();}
});
test('stopped connection never publishes a late request or restarts on focus',async()=>{
 const events=new EventTarget();let release,published=0,calls=0;
 const stop=startDiscoveryConnection({events,request:async()=>{calls++;await new Promise(r=>release=r);return snapshot();},onSnapshot:()=>published++,onError:()=>published++});stop();release();events.dispatchEvent(new Event('focus'));await new Promise(r=>setTimeout(r,20));assert.equal(published,0);assert.equal(calls,1);
});
