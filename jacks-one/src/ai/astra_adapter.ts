import { AIFirewall, type CertifiedFactPayload } from './firewall.ts';
import type { DecisionPacket } from '../strategy/compiler.ts';

export interface AstraResearchPayload {
  readonly query_type: 'EV_GAP_ANALYSIS' | 'PAYTABLE_SENSITIVITY' | 'DISTRIBUTION_AUDIT';
  readonly dataset_reference: string;
  readonly certified_facts: CertifiedFactPayload;
  readonly mathematical_invariants_preserved: boolean;
}

export class AstraAdapter {
  /**
   * Astra is the deep analytical research engine. Receives immutable datasets for anomaly investigation.
   */
  public static buildResearchRequest(packet: DecisionPacket, queryType: 'EV_GAP_ANALYSIS' | 'PAYTABLE_SENSITIVITY' | 'DISTRIBUTION_AUDIT'): AstraResearchPayload {
    const facts = AIFirewall.createFactPayload(packet);

    return {
      query_type: queryType,
      dataset_reference: packet.certificate_hash,
      certified_facts: facts,
      mathematical_invariants_preserved: true,
    };
  }
}
