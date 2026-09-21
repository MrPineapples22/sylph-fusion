import type { UIPresentationStateDTO } from '../../adapter/ui_adapter.ts';

/**
 * Godot presentation interface contract.
 * Defines the public signals and methods for Godot GDScript integration.
 */

export interface GodotPokerPresentationNode {
  // Methods callable by adapter / game controller
  update_presentation_state(state: UIPresentationStateDTO): void;
  play_deal_animation(cardSymbols: string[]): Promise<void>;
  play_draw_animation(replacedIndices: number[], newCardSymbols: string[]): Promise<void>;
  highlight_winning_hand(category: string, payout: number): void;
  show_coach_bubble(text: string, certificateId: string): void;

  // Signals emitted by Godot UI towards game controller
  on_card_clicked(cardIndex: number): void;
  on_deal_pressed(): void;
  on_draw_pressed(): void;
  on_bet_adjusted(newBet: number): void;
}
