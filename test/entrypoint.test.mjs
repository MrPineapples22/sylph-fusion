import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDirectEngineInvocation} from '../dist/fusion.js';

test('engine recognizes a direct Windows-style ESM invocation', () => {
  const script = path.resolve('dist/fusion.js');
  assert.equal(isDirectEngineInvocation(script, pathToFileURL(script).href), true);
  assert.equal(isDirectEngineInvocation('dist\\fusion.js', 'file:///normalized/dist/fusion.js'), true);
  assert.equal(isDirectEngineInvocation('dist/config.js', pathToFileURL(script).href), false);
});
