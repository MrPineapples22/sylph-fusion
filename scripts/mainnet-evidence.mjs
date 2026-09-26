#!/usr/bin/env node
// This safety tool intentionally cannot sign, submit, or create a transaction.
// It verifies that an operator has explicitly opened a ceremony and records only
// the requested evidence level. Wiring real signer/broadcast clients requires a
// separately reviewed isolated deployment.
if (process.env.SYLPH_OPERATOR_MAINNET_CEREMONY !== 'ACKNOWLEDGE_NO_TRANSACTION_WILL_BE_SENT') {
  throw new Error('Mainnet evidence ceremony is disabled. This script never runs automatically and requires explicit operator acknowledgement.');
}
console.log(JSON.stringify({event:'mainnet_evidence_preflight_only',evidenceLevel:'L0',productionExecutionCertified:false,reason:'No isolated signer/broadcast/reconciler composition is configured.'}));
