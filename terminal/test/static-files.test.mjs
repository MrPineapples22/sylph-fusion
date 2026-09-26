import test from 'node:test';
import assert from 'node:assert/strict';
import {serveStaticRequest} from '../static-files.mjs';

function response() {
  return {
    headers: {}, status: null, body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body) { this.body = body; },
  };
}

test('missing document fails unavailable without synthetic health or destructive instructions', async () => {
  const res = response();
  const missing = Object.assign(new Error('missing'), {code: 'ENOENT'});
  await serveStaticRequest({req: {url: '/', headers: {}, method: 'GET'}, res, root: 'X:/dist', project: 'X:/project', read: async () => { throw missing; }});
  assert.equal(res.status, 503);
  assert.equal(res.body, 'Terminal UI unavailable');
  assert.doesNotMatch(res.body, /feeds are active|reset --hard|online/i);
});

test('missing asset returns 404 instead of an HTML success page', async () => {
  const res = response();
  const missing = Object.assign(new Error('missing'), {code: 'ENOENT'});
  await serveStaticRequest({req: {url: '/assets/missing.js', headers: {}, method: 'GET'}, res, root: 'X:/dist', project: 'X:/project', read: async () => { throw missing; }});
  assert.equal(res.status, 404);
  assert.equal(res.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(res.body, 'Asset not found');
});

test('missing production document never falls back to legacy UI content', async () => {
  const res = response();
  const missing = Object.assign(new Error('missing'), {code: 'ENOENT'});
  const calls = [];
  await serveStaticRequest({
    req: {url: '/', headers: {}, method: 'GET'},
    res,
    root: 'X:/dist',
    project: 'X:/project',
    read: async file => {
      calls.push(file);
      if (calls.length === 1) throw missing;
      return Buffer.from('<title>legacy</title>');
    },
  });
  assert.equal(res.status, 503);
  assert.equal(res.body, 'Terminal UI unavailable');
  assert.equal(calls.length, 1, 'only the production artifact directory may be consulted');
});

test('asset read corruption returns 503 and does not fall through to a healthy page', async () => {
  const res = response();
  const corrupt = Object.assign(new Error('I/O failure'), {code: 'EIO'});
  await serveStaticRequest({req: {url: '/assets/app.js', headers: {}, method: 'GET'}, res, root: 'X:/dist', project: 'X:/project', read: async () => { throw corrupt; }});
  assert.equal(res.status, 503);
  assert.equal(res.body, 'Terminal asset unavailable');
});

test('HEAD failures preserve status but omit response body', async () => {
  const res = response();
  const missing = Object.assign(new Error('missing'), {code: 'ENOENT'});
  await serveStaticRequest({req: {url: '/', headers: {}, method: 'HEAD'}, res, root: 'X:/dist', project: 'X:/project', read: async () => { throw missing; }});
  assert.equal(res.status, 503);
  assert.equal(res.body, undefined);
});
