import {
  CanonicalIngress,
  DefaultTruthValidator,
  InMemoryIngressJournal,
  SolanaLogFusionEnvelopeCompiler,
} from '../../dist/platform/ingress/canonical-ingress.js';

export function createTestIngress({ parser, journal = new InMemoryIngressJournal(), onCommitted } = {}) {
  const compiler = new SolanaLogFusionEnvelopeCompiler();
  if (parser) compiler.parser = parser;
  return new CanonicalIngress({
    compiler,
    validator: new DefaultTruthValidator(),
    journal,
    downstreamSubscriber: onCommitted,
  });
}
