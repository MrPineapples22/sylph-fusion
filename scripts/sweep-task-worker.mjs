import { workerData, parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';

function fail(message){throw new Error(message)}
if(!workerData?.fixturePath||typeof workerData.fixturePath!=='string') fail('fixturePath must be a non-empty string');
const parsed=JSON.parse(readFileSync(workerData.fixturePath,'utf8'));
const ticks=Array.isArray(parsed)?parsed:parsed?.ticks;
if(!Array.isArray(ticks)) fail('fixture must contain a tick array');
const finite=(x)=>Number.isFinite(x);
function validate(t){
 if(t?.type!=='RUN'||!Number.isInteger(t.taskId)||t.taskId<0) fail('invalid task envelope');
 if(!Number.isInteger(t.seed)||t.seed<0||t.seed>0xffffffff) fail('invalid seed'); const p=t.params;
 if(!p||!finite(p.velocity)||p.velocity<=0||!finite(p.trailing)||p.trailing<1||p.trailing>50||!Number.isInteger(p.slippageBps)||p.slippageBps<10||p.slippageBps>5000||!Array.isArray(p.tp)||p.tp.length!==3||!p.tp.every(x=>finite(x)&&x>0)||!(p.tp[0]<p.tp[1]&&p.tp[1]<p.tp[2])) fail('invalid parameters');
}
function trial(p,seed){let equity=100,peak=100,maxDd=0,trades=0,wins=0,entry=0,high=0;const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};for(const frame of ticks){const a=(frame.assets||[]).find(x=>x.id==='BONK')||frame.assets?.[0];if(!a||!finite(a.price))continue;const price=Number(a.price);if(!entry&&Number(a.velocity)>=p.velocity&&Number(a.volume||0)>=1){entry=price;high=price;trades++;continue}if(entry){high=Math.max(high,price);const stop=high*(1-p.trailing/100);if(price<=stop){const r=(price/entry-1)*100;equity*=1+r/100;maxDd=Math.max(maxDd,(peak-equity)/peak*100);if(r>0)wins++;trades++;entry=0;continue}const gain=(price/entry-1)*100;const target=p.tp.find(x=>gain>=x);if(target!==undefined){equity*=1+gain/100;maxDd=Math.max(maxDd,(peak-equity)/peak*100);if(gain>0)wins++;trades++;entry=0}}peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak*100)}return {netReturnPct:+(equity-100).toFixed(2),maxDrawdownPct:+maxDd.toFixed(2),trades,winRate:+(trades?wins/trades*100:0).toFixed(1),adverseScore:Math.max(0,Math.min(100,Math.round(rng()*20)))} }
parentPort.on('message',(task)=>{try{validate(task);parentPort.postMessage({type:'RESULT',taskId:task.taskId,result:{...task.params,...trial(task.params,task.seed)}})}catch(e){parentPort.postMessage({type:'ERROR',taskId:task?.taskId??-1,error:e?.stack||String(e)})}});
