import test from 'node:test';
import assert from 'node:assert/strict';
import rulesetJson from '../../spec/rulesets/joB_full_pay_9_6.json' with { type: 'json' };
import rulesetSchema from '../../spec/contracts/ruleset.schema.json' with { type: 'json' };
import decisionPacketSchema from '../../spec/contracts/decision_packet.schema.json' with { type: 'json' };
import certificateSchema from '../../spec/contracts/certificate.schema.json' with { type: 'json' };
import sampleCert from '../../artifacts/sample_certificate.json' with { type: 'json' };
import { parseHand } from '../../src/core/hand.ts';
import { compileDecisionPacket } from '../../src/strategy/compiler.ts';

test('Contracts: Ruleset adheres to ruleset.schema.json', () => {
  for (const requiredProp of rulesetSchema.required) {
    assert.ok(requiredProp in rulesetJson, `Missing required property: ${requiredProp}`);
  }
  assert.equal(rulesetJson.canonical_classes, 134459);
  assert.equal(rulesetJson.distinct_ev_values, 1153);
});

test('Contracts: DecisionPacket adheres to decision_packet.schema.json', () => {
  const packet = compileDecisionPacket(parseHand('As Ks Qs Js 9c'));
  for (const requiredProp of decisionPacketSchema.required) {
    assert.ok(requiredProp in packet, `DecisionPacket missing: ${requiredProp}`);
  }
  assert.equal(packet.alternative_evs.length, 32);
});

test('Contracts: Sample Certificate adheres to certificate.schema.json', () => {
  for (const requiredProp of certificateSchema.required) {
    assert.ok(requiredProp in sampleCert, `Certificate missing: ${requiredProp}`);
  }
  assert.equal(sampleCert.all_holds.length, 32);
  assert.equal(sampleCert.engines_in_agreement, true);
});
