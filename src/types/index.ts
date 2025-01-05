/**
 * Enum for the phases of the game
 */
export enum Phase {
  DEALING = 'DEALING',
  CRIB = 'CRIB',
  CUTTING = 'CUTTING',
  PEGGING = 'PEGGING',
  COUNTING = 'COUNTING',
  END = 'END',
}

/**
 * Enum for the types of actions in the game
 */
export enum ActionType {
  DEAL = 'DEAL',
  DISCARD = 'DISCARD',
  PLAY_CARD = 'PLAY_CARD',
  SCORE = 'SCORE',
  TURN_CARD = 'TURN_CARD',
  CUT = 'CUT',
}

/**
 * Type for representing a playing card
 */
export type Card =
  | 'ACE_SPADES'
  | 'TWO_SPADES'
  | 'THREE_SPADES'
  | 'FOUR_SPADES'
  | 'FIVE_SPADES'
  | 'SIX_SPADES'
  | 'SEVEN_SPADES'
  | 'EIGHT_SPADES'
  | 'NINE_SPADES'
  | 'TEN_SPADES'
  | 'JACK_SPADES'
  | 'QUEEN_SPADES'
  | 'KING_SPADES'
  | 'ACE_HEARTS'
  | 'TWO_HEARTS'
  | 'THREE_HEARTS'
  | 'FOUR_HEARTS'
  | 'FIVE_HEARTS'
  | 'SIX_HEARTS'
  | 'SEVEN_HEARTS'
  | 'EIGHT_HEARTS'
  | 'NINE_HEARTS'
  | 'TEN_HEARTS'
  | 'JACK_HEARTS'
  | 'QUEEN_HEARTS'
  | 'KING_HEARTS'
  | 'ACE_DIAMONDS'
  | 'TWO_DIAMONDS'
  | 'THREE_DIAMONDS'
  | 'FOUR_DIAMONDS'
  | 'FIVE_DIAMONDS'
  | 'SIX_DIAMONDS'
  | 'SEVEN_DIAMONDS'
  | 'EIGHT_DIAMONDS'
  | 'NINE_DIAMONDS'
  | 'TEN_DIAMONDS'
  | 'JACK_DIAMONDS'
  | 'QUEEN_DIAMONDS'
  | 'KING_DIAMONDS'
  | 'ACE_CLUBS'
  | 'TWO_CLUBS'
  | 'THREE_CLUBS'
  | 'FOUR_CLUBS'
  | 'FIVE_CLUBS'
  | 'SIX_CLUBS'
  | 'SEVEN_CLUBS'
  | 'EIGHT_CLUBS'
  | 'NINE_CLUBS'
  | 'TEN_CLUBS'
  | 'JACK_CLUBS'
  | 'QUEEN_CLUBS'
  | 'KING_CLUBS';

/**
 * Interface for a player in the game
 */
export interface Player {
  id: string; // Unique identifier for the player
  name: string; // Display name for the player
  hand: Card[]; // Cards currently in the player's hand
  score: number; // Player's score
  isDealer: boolean; // Whether the player is the dealer for the current round
}

/**
 * Interface for the state of the game at any point in time
 */
export interface GameState {
  phase: Phase; // Current phase of the game
  actionType: ActionType; // Last action type taken in the game
  playerId: string | null; // ID of the player who took the last action
  cards: Card[] | null; // Card involved in the last action, if any
  scoreChange: number; // Points gained from the last action, if any
  timestamp: Date; // Time of the last action
}

/**
 * Interface for the overall game
 */
export interface Game {
  id: string; // Unique identifier for the game
  players: Player[]; // List of players in the game
  deck: Card[]; // Remaining cards in the deck
  crib: Card[]; // Cards in the crib
  turnCard: Card | null; // The turn card revealed during the pegging phase
  currentPhase: Phase; // Current phase of the game
  gameStateLog: GameState[]; // Log of all game actions
}

/**
 * Interface for a Cribbage game agent
 * Agents can be human or AI-controlled
 */
export interface GameAgent {
  id: string; // Unique identifier for the agent
  human: boolean; // Whether the agent represents a human player
  makeMove(game: Game, playerId: string): Promise<Card>; // Optional for AI
  discard(game: Game, playerId: string): Promise<Card[]>; // Optional for AI
}

/**
 * Interface for a Cribbage hand score
 * This can represent a single player's hand or the crib
 */
export interface HandScore {
  fifteens: number; // Points from combinations summing to 15
  pairs: number; // Points from pairs
  runs: number; // Points from runs
  flush: number; // Points from flushes
  nobs: number; // Points from having the jack of the turn card's suit
  total: number; // Total score for the hand
}
