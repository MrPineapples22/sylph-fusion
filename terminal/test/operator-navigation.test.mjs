import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOperatorRoute, operatorRoute, WORKSPACES, MOBILE_WORKSPACES} from '../src/operator-navigation.js';

test('workspace routes preserve investigation and discovery context without accepting action parameters', () => {
  const context = {workspace:'Token Intelligence', query:'A & B', filter:'Watch', page:2, mint:'mint-fixture'};
  assert.deepEqual(readOperatorRoute(operatorRoute(context)), context);
  assert.deepEqual(readOperatorRoute('#/execution?execute=true&amount=100'), {workspace:'Execution', query:'', filter:'All evidence', page:0, mint:null});
});
test('all destinations are addressable and mobile reserves one of five slots for More', () => {
  for (const workspace of WORKSPACES) assert.equal(readOperatorRoute(operatorRoute({workspace})).workspace, workspace);
  assert.equal(MOBILE_WORKSPACES.length + 1, 5);
  assert.ok(!MOBILE_WORKSPACES.includes('Execution'));
});
test('unrecognized and malformed route state has bounded neutral defaults', () => {
  assert.deepEqual(readOperatorRoute('#/missing?page=-2&filter=Execute'), {workspace:'Command', query:'', filter:'All evidence', page:0, mint:null});
  assert.equal(readOperatorRoute('#/discover?page=Infinity').page, 0);
});
