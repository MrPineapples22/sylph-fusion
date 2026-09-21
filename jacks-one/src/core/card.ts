/**
 * Card representation and canonical encoding.
 * 52 cards in a standard deck.
 * Ranks: 0 = 2, 1 = 3, ..., 8 = 10 (T), 9 = J, 10 = Q, 11 = K, 12 = A
 * Suits: 0 = C (Clubs), 1 = D (Diamonds), 2 = H (Hearts), 3 = S (Spades)
 */

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['c', 'd', 'h', 's'] as const;
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;

export type RankIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type SuitIndex = 0 | 1 | 2 | 3;

export interface Card {
  readonly id: number; // 0..51
  readonly rank: RankIndex;
  readonly suit: SuitIndex;
  readonly symbol: string; // e.g. "As", "Th", "2c"
}

// Pre-create all 52 cards statically for identity reference and zero allocations
export const DECK: readonly Card[] = Array.from({ length: 52 }, (_, id) => {
  const rank = Math.floor(id / 4) as RankIndex;
  const suit = (id % 4) as SuitIndex;
  const symbol = `${RANKS[rank]}${SUITS[suit]}`;
  return Object.freeze({ id, rank, suit, symbol });
});

export function cardFromId(id: number): Card {
  if (id < 0 || id >= 52 || !Number.isInteger(id)) {
    throw new Error(`Invalid card ID: ${id}. Must be integer 0..51.`);
  }
  return DECK[id];
}

export function cardFromRankSuit(rank: RankIndex, suit: SuitIndex): Card {
  return DECK[rank * 4 + suit];
}

export function parseCard(str: string): Card {
  const s = str.trim().toUpperCase();
  let rankStr = '';
  let suitChar = '';

  if (s.startsWith('10')) {
    rankStr = 'T';
    suitChar = s.slice(2).toLowerCase();
  } else if (s.length === 2) {
    rankStr = s[0];
    suitChar = s[1].toLowerCase();
  } else {
    throw new Error(`Cannot parse card: "${str}". Format must be e.g. "As", "10h", "2c".`);
  }

  const rankIdx = RANKS.indexOf(rankStr as (typeof RANKS)[number]);
  if (rankIdx === -1) {
    throw new Error(`Unknown rank in card: "${str}". Valid ranks are 2..9, T, 10, J, Q, K, A.`);
  }

  const suitIdx = SUITS.indexOf(suitChar as (typeof SUITS)[number]);
  if (suitIdx === -1) {
    throw new Error(`Unknown suit in card: "${str}". Valid suits are c, d, h, s.`);
  }

  return DECK[rankIdx * 4 + suitIdx];
}

export function formatCard(card: Card, pretty = false): string {
  if (pretty) {
    return `${RANKS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
  }
  return card.symbol;
}

export function isHighCard(card: Card): boolean {
  // Jacks or Better high cards are J (rank 9), Q (rank 10), K (rank 11), A (rank 12)
  return card.rank >= 9;
}
