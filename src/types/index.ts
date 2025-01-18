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
  PLAY_CARD = 'PLAY_CARD', // player plays a card during pegging phase
  GO = 'GO', // Player says "Go" during pegging phase when they can't play a card
  LAST_CARD = 'LAST_CARD', // Player receives a point for playing the last card during pegging phase (after all other players have said "Go")
  SCORE_HAND = 'SCORE_HAND',
  SCORE_CRIB = 'SCORE_CRIB',
  TURN_CARD = 'TURN_CARD',
  CUT = 'CUT',
  SCORE_HEELS = 'SCORE_HEELS', // Special case for dealer scoring 2 points for a jack as the turn card ("his heels")
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
export interface Player extends PlayerIdAndName {
  hand: Card[]; // Cards currently in the player's hand
  peggingHand: Card[]; // Cards left to play during the pegging phase (starts as a copy of hand)
  score: number; // Player's score
  isDealer: boolean; // Whether the player is the dealer for the current round
}

export interface PlayerIdAndName {
  id: string; // Unique identifier for the player (username for human players)
  name: string; // Display name of the player
}

/**
 * Interface for the state of the game at any point in time
 */
export interface GameEvent {
  id: string; // Unique identifier for the game state (uuid)
  phase: Phase; // Current phase of the game
  actionType: ActionType; // Last action type taken in the game
  playerId: string | null; // ID of the player who took the last action
  cards: Card[] | null; // Card involved in the last action, if any
  scoreChange: number; // Points gained from the last action, if any
  timestamp: Date; // Time of the last action
  peggingStack?: Card[]; // Stack of played cards during pegging (including card just played) (if phase is PEGGING)
  peggingGoPlayers?: string[]; // List of players who have said "Go" during this pegging stack (if phase is PEGGING)
  peggingLastCardPlayer?: string; // Player who played the last card during pegging (if phase is PEGGING)
  playedCards: PlayedCard[]; // List of all cards played during the pegging phase to help with keeping track of played cards
}

/**
 * Interface for the overall game
 */
export interface GameState {
  id: string; // Unique identifier for the game
  players: Player[]; // List of players in the game
  deck: Card[]; // Remaining cards in the deck
  crib: Card[]; // Cards in the crib
  turnCard: Card | null; // The turn card revealed during the pegging phase
  currentPhase: Phase; // Current phase of the game
  peggingStack: Card[]; // Stack of cards played during the pegging phase
  peggingGoPlayers: string[]; // List of players who have said "Go" during this pegging stack
  peggingLastCardPlayer: string | null; // Player who played the last card during pegging
  playedCards: PlayedCard[]; // List of all cards played during the pegging phase to help with keeping track of played cards
}

/**
 * Interface for a card played by a player
 */
export interface PlayedCard {
  playerId: string; // ID of the player who played the card
  card: Card; // The card that was played
}

/**
 * Interface for a Cribbage game agent
 * Agents can be human or AI-controlled
 */
export interface GameAgent {
  id: string; // Unique identifier for the agent
  human: boolean; // Whether the agent represents a human player
  makeMove(game: GameState, playerId: string): Promise<Card | null>;
  discard(game: GameState, playerId: string): Promise<Card[]>;
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

////// Types for Event Emitters //////

export interface emittedMakeMoveRequest {
  playerId: string;
  peggingHand: Card[];
  peggingStack: Card[];
  playedCards: PlayedCard[];
  peggingTotal: number;
}

export interface emittedMakeMoveResponse {
  playerId: string;
  selectedCard: Card;
}

export interface emittedMakeMoveInvalid {
  reason: string;
}

export interface emittedDiscardRequest {
  playerId: string;
  hand: Card[];
}

export interface emittedDiscardResponse {
  selectedCards: Card[];
}

export interface emittedDiscardInvalid {
  reason: string;
}
