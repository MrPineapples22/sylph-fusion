import {readJson} from './read-json.js';

// One request at a time. A wake event during a request queues one refresh.
export function startDiscoveryConnection({onSnapshot,onError,events=globalThis.window,visibility=globalThis.document,request=signal=>readJson('/api/discovery',signal,4000),intervalMs=1000}) {
 let stopped=false,active=false,wakeQueued=false,timer;
 const controller=new AbortController();
 async function poll(){
  if(stopped)return;
  if(active){wakeQueued=true;return;}
  clearTimeout(timer);active=true;
  try{
   const data=await request(controller.signal);
   if(!data||data.schemaVersion!==1||!Number.isFinite(data.at)||!Array.isArray(data.rows)||!Array.isArray(data.positions))throw Error('Invalid discovery snapshot');
   if(!stopped)onSnapshot(data);
  }catch(error){if(!stopped)onError(error);}
  finally{active=false;if(!stopped){const delay=wakeQueued?0:intervalMs;wakeQueued=false;timer=setTimeout(poll,delay);}}
 }
 const wake=()=>{if(!visibility||visibility.visibilityState!=='hidden')void poll();};
 events?.addEventListener('online',wake);
 events?.addEventListener('focus',wake);
 visibility?.addEventListener('visibilitychange',wake);
 void poll();
 return ()=>{stopped=true;controller.abort();clearTimeout(timer);events?.removeEventListener('online',wake);events?.removeEventListener('focus',wake);visibility?.removeEventListener('visibilitychange',wake);};
}
