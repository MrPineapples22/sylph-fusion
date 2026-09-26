import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryRiskCache} from '../discovery-risk-cache.mjs';

const tokens = (...mints) => mints.map(mint => ({mint}));
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('fanout and retained work stay bounded, with one request per queued mint', async () => {
  const calls = [];
  const jobs = [];
  const cache = createDiscoveryRiskCache({concurrency: 2, capacity: 3, now: () => 100,
    scan: mint => { calls.push(mint); const job = deferred(); jobs.push(job); return job.promise; }});
  cache.refresh(tokens('a', 'b', 'c', 'd', 'a'));
  cache.refresh(tokens('a', 'b', 'c', 'd'));
  await settle();
  assert.deepEqual(calls, ['a', 'b']);
  jobs[0].resolve({at: 100});
  await settle();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  jobs[1].resolve({at: 100}); jobs[2].resolve({at: 100});
  await settle();
  cache.refresh(tokens('a', 'b', 'c', 'd'));
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(cache.risks.size, 3);
});

test('removed work cannot publish late or overwrite evidence after a mint returns', async () => {
  const jobs = [];
  const cache = createDiscoveryRiskCache({now: () => 100,
    scan: () => { const job = deferred(); jobs.push(job); return job.promise; }});
  cache.refresh(tokens('a')); await settle();
  cache.refresh([]);
  cache.refresh(tokens('a')); await settle();
  const current = {at: 100, source: 'current'};
  jobs[1].resolve(current); await settle();
  jobs[0].resolve({at: 50, source: 'departed'}); await settle();
  assert.equal(cache.risks.get('a'), current);
  cache.refresh([]);
  assert.equal(cache.risks.size, 0);
});

test('failures and synchronous errors back off without manufacturing risk evidence', async () => {
  let now = 100;
  let attempts = 0;
  const cache = createDiscoveryRiskCache({now: () => now, retryMs: 10,
    scan: () => { attempts++; throw new Error('offline'); }});
  cache.refresh(tokens('a')); await settle();
  assert.equal(cache.risks.size, 0);
  for (let i = 0; i < 20; i++) cache.refresh(tokens('a'));
  await settle();
  assert.equal(attempts, 1);
  now = 110;
  cache.refresh(tokens('a')); await settle();
  assert.equal(attempts, 2);
});

test('freshness uses provider evidence time and does not restamp stale evidence', async () => {
  let now = 100;
  let attempts = 0;
  const evidence = {at: 100};
  const cache = createDiscoveryRiskCache({now: () => now, refreshMs: 40, retryMs: 10,
    scan: () => { attempts++; return evidence; }});
  cache.refresh(tokens('a')); await settle();
  now = 139; cache.refresh(tokens('a')); await settle();
  assert.equal(attempts, 1);
  now = 140; cache.refresh(tokens('a')); await settle();
  assert.equal(attempts, 2);
  assert.equal(cache.risks.get('a').at, 100);
  now = 141; cache.refresh(tokens('a')); await settle();
  assert.equal(attempts, 2);
});

test('shutdown discards queued work and suppresses in-flight publication', async () => {
  const job = deferred();
  let attempts = 0, publications = 0;
  const cache = createDiscoveryRiskCache({concurrency: 1, scan: () => { attempts++; return job.promise; },
    onChange: () => { publications++; }});
  cache.refresh(tokens('a', 'b')); await settle();
  cache.stop();
  job.resolve({at: Date.now()}); await settle();
  cache.refresh(tokens('c')); await settle();
  assert.equal(attempts, 1);
  assert.equal(publications, 0);
  assert.equal(cache.risks.size, 0);
});

test('removed queued tokens never consume a provider request', async () => {
  const job = deferred();
  const calls = [];
  const cache = createDiscoveryRiskCache({concurrency: 1,
    scan: mint => { calls.push(mint); return job.promise; }});
  cache.refresh(tokens('a', 'b')); await settle();
  cache.refresh(tokens('a'));
  job.resolve({at: Date.now()}); await settle();
  assert.deepEqual(calls, ['a']);
});

test('shutdown before dispatch does not begin a scan', async () => {
  let calls = 0;
  const cache = createDiscoveryRiskCache({scan: () => { calls++; }});
  cache.refresh(tokens('a'));
  cache.stop();
  await settle();
  assert.equal(calls, 0);
});

test('older background completion cannot overwrite a newer manual observation', async () => {
  const job = deferred();
  let publications = 0;
  const cache = createDiscoveryRiskCache({now: () => 300, scan: () => job.promise,
    onChange: () => { publications++; }});
  cache.refresh(tokens('a')); await settle();
  const manual = {at: 200, safe: null};
  cache.risks.set('a', manual);
  job.resolve({at: 100, safe: false}); await settle();
  assert.equal(cache.risks.get('a'), manual);
  assert.equal(cache.risks.get('a').at, 200);
  assert.equal(publications, 0);
});

test('malformed background results remain absent and do not replace evidence', async () => {
  for (const result of [undefined, null, false, [], {}, {at: NaN}, {at: Infinity}, {at: '100'}, {at: 0}, {at: -1}, {at: 301}]) {
    const job = deferred();
    const cache = createDiscoveryRiskCache({now: () => 300, scan: () => job.promise});
    cache.refresh(tokens('a', 'b')); await settle();
    const manual = {at: 200, safe: null};
    cache.risks.set('a', manual);
    job.resolve(result); await settle();
    assert.equal(cache.risks.get('a'), manual);
    assert.equal(cache.risks.has('b'), false);
  }
});

test('newer background observation preserves unknown judgment and original timestamp', async () => {
  const job = deferred();
  const cache = createDiscoveryRiskCache({now: () => 300, scan: () => job.promise});
  cache.refresh(tokens('a')); await settle();
  cache.risks.set('a', {at: 100, safe: false});
  const observation = {at: 200, safe: null};
  job.resolve(observation); await settle();
  assert.equal(cache.risks.get('a'), observation);
  assert.equal(cache.risks.get('a').at, 200);
  assert.equal(cache.risks.get('a').safe, null);
});

test('refresh prunes manually inserted evidence without scheduler entries', async () => {
  let calls = 0;
  const cache = createDiscoveryRiskCache({now: () => 300, scan: () => { calls++; return {at: 300}; }});
  const present = {at: 200, safe: null};
  cache.risks.set('present', present);
  cache.risks.set('departed', {at: 250, safe: false});
  cache.refresh(tokens('present')); await settle();
  assert.deepEqual([...cache.risks.keys()], ['present']);
  assert.equal(cache.risks.get('present'), present);
  assert.equal(calls, 0);
  cache.refresh([]);
  assert.equal(cache.risks.size, 0);
});
