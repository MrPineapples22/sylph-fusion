import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {terminalPort, probeTerminal, waitForTerminal} from '../scripts/terminal-launcher.mjs';
const html = '<meta name="sylph-terminal"><script src="/assets/app.js?v=1"></script><link href="/assets/app.css?v=1">';
function mock({service='sylph-paper-terminal', page=html, missing=false, wrongType=false}={}) {
 return async url => {
  if (url.pathname === '/health') return Response.json({service});
  if (url.pathname === '/') return new Response(page);
  return new Response(missing?'':'asset content', {status:missing?404:200,headers:{'Content-Type':wrongType?'text/html':url.pathname.endsWith('.js')?'text/javascript':'text/css'}});
 };
}
test('launcher uses validated default and custom ports',()=>{
 assert.equal(terminalPort(),8795);assert.equal(terminalPort('8890'),8890);
 for (const value of ['abc','-1','80','65536','8795.5']) assert.throws(()=>terminalPort(value));
});
test('readiness requires named service and both nonempty typed production assets',async()=>{
 assert.equal(await probeTerminal('http://127.0.0.1:8795',mock()),true);
 for (const options of [{service:'unrelated'},{missing:true},{wrongType:true},{page:'<meta name="sylph-terminal">'},{page:html.replace('/assets/app.css?v=1','https://external.test/app.css')}]) {
  assert.equal(await probeTerminal('http://127.0.0.1:8795',mock(options)),false);
 }
});
test('readiness contains connection failures and does not follow redirects',async()=>{
 assert.equal(await probeTerminal('http://127.0.0.1:8795',async(_,options)=>{assert.equal(options.redirect,'error');throw Error('offline');}),false);
});
test('startup retries until ready and removes temporary listeners',async()=>{
 const child=new EventEmitter();let calls=0;
 assert.equal(await waitForTerminal({child,probe:async()=>++calls===3,pause:async()=>{}}),true);
 assert.equal(calls,3);assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
});
test('startup reports early child termination rather than accepting another listener',async()=>{
 const child=new EventEmitter();
 await assert.rejects(waitForTerminal({child,probe:async()=>{child.emit('exit',1);return true;},pause:async()=>{}}),/exited before startup/);
 assert.equal(child.listenerCount('exit'),0);
});
test('startup reports failed spawn and bounds retry attempts',async()=>{
 const child=new EventEmitter();
 await assert.rejects(waitForTerminal({child,probe:async()=>{child.emit('error',Error('spawn'));return false;}}),/could not start/);
 let calls=0;
 assert.equal(await waitForTerminal({child,probe:async()=>{calls++;return false;},attempts:2,pause:async()=>{}}),false);
 assert.equal(calls,2);
});

test('failed startup terminates only its owned child; successful startup remains running',async()=>{
 for (const ready of [true,false]) {
  const child=new EventEmitter();let killed=0;child.kill=()=>{killed++;return true;};
  assert.equal(await waitForTerminal({child,probe:async()=>ready,attempts:1}),ready);
  assert.equal(killed,ready?0:1);
 }
 const child=new EventEmitter();let killed=0;child.kill=()=>{killed++;return true;};
 await assert.rejects(waitForTerminal({child,probe:async()=>{throw Error('probe failed');}}),/probe failed/);
 assert.equal(killed,1);
});
