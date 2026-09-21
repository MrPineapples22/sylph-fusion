import { AIFirewall, type CertifiedFactPayload } from './firewall.ts';
import type { DecisionPacket } from '../strategy/compiler.ts';

export interface LunaPromptPayload {
  readonly system_role: string;
  readonly context_certified_facts: CertifiedFactPayload;
  readonly user_query: string;
  readonly response_constraints: string[];
}

export class LunaAdapter {
  /**
   * Luna is the patient coach and tutor. Prepares strictly bounded prompt contracts for Luna.
   */
  public static buildTutoringPrompt(packet: DecisionPacket, userQuery: string): LunaPromptPayload {
    const facts = AIFirewall.createFactPayload(packet);

    return {
      system_role: 'You are Luna, the friendly video poker coach. You provide clear, supportive explanations strictly grounded in certified mathematics.',
      context_certified_facts: facts,
      user_query: userQuery,
      response_constraints: [
        'Must cite certificate_id in all answers.',
        'Never invent alternative EVs or contradict certified hold.',
        'Focus on explaining the strategic intuition and risk-reward tradeoff.',
      ],
    };
  }
}
