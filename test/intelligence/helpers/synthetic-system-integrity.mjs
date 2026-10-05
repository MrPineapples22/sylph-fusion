/**
 * Test-only fixture for exercising the authorized branch of the master pipeline.
 * These synthetic health checks are never used by application startup or runtime.
 */
export function certifySyntheticRuntimeForTestOnly(engine) {
  return engine.systemIntegrity.evaluateIntegrity({
    rpcQuorum: true,
    eventContinuity: true,
    decoderHealth: true,
    stateDeterminism: true,
    executionReconciled: true,
    portfolioLedgerIntegrity: true,
    clockHealth: true,
    persistenceHealth: true,
    queueHealth: true,
  });
}
