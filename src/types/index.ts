/**
 * Enum for the phases of the game
 */
export enum Phase {
  DEALER_SELECTION = 'DEALER_SELECTION', // Initial phase: players select cards to determine dealer
  DEALING = 'DEALING',
  DISCARDING = 'DISCARDING',
  CUTTING = 'CUTTING',
  PEGGING = 'PEGGING',
  COUNTING = 'COUNTING',
  END = 'END',
}

/**
 * Enum for the types of actions in the game
 */
export enum ActionType {
  BEGIN_PHASE = 'BEGIN_PHASE', // Used to indicate phase has changed w/o a specific action being taken by a player
  END_PHASE = 'END_PHASE', // Used to indicate phase has ended w/o a specific action being taken by a player
  DEAL = 'DEAL', // When dealer deals cards
  SHUFFLE_DECK = 'SHUFFLE_DECK',
  AUTO_CRIB_CARD = 'AUTO_CRIB_CARD', // Card(s) automatically dealt to crib from deck (3-player games)
  DISCARD = 'DISCARD',
  PLAY_CARD = 'PLAY_CARD', // player plays a card during pegging phase
  GO = 'GO', // Player says "Go" during pegging phase when they can't play a card
  LAST_CARD = 'LAST_CARD', // Player receives a point for playing the last card during pegging phase (after all other players have said "Go")
  SCORE_HAND = 'SCORE_HAND',
  SCORE_CRIB = 'SCORE_CRIB',
  TURN_CARD = 'TURN_CARD',
  CUT = 'CUT',
  CUT_DECK = 'CUT_DECK', // When player cuts the deck (new explicit action type)
  SCORE_HEELS = 'SCORE_HEELS', // Special case for dealer scoring 2 points for a jack as the turn card ("his heels")
  START_PEGGING_ROUND = 'START_PEGGING_ROUND', // Start a new round of pegging
  START_ROUND = 'START_ROUND', // Start a new round of the game
  SELECT_DEALER_CARD = 'SELECT_DEALER_CARD', // Player selects a card to determine dealer
  WIN = 'WIN', // Player wins the game
  READY_FOR_GAME_START = 'READY_FOR_GAME_START', // Player acknowledges ready to start game (after dealer selection)
  READY_FOR_COUNTING = 'READY_FOR_COUNTING', // Player acknowledges ready for counting phase
  READY_FOR_NEXT_ROUND = 'READY_FOR_NEXT_ROUND', // Player acknowledges ready for next round
}

/**
 * Type for representing a playing card
 */
export type Card =
  | 'UNKNOWN' // For opponents' cards that should not be revealed
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
  playedCards: Card[]; // Cards played by the player during the pegging phase
  score: number; // Player's score
  isDealer: boolean; // Whether the player is the dealer for the current round
  pegPositions: {
    current: number; // Position of current (front) peg on the board
    previous: number; // Position of previous (back) peg on the board
  };
}

export interface PlayerIdAndName {
  id: string; // Unique identifier for the player (username for human players)
  name: string; // Display name of the player
}

/**
 * Interface for the state of the game at any point in time
 */
export interface GameEvent {
  gameId: string; // Unique identifier for the game (uuid)
  snapshotId: number; // Ties this game event to a unique snapshot/version of the game state
  phase: Phase; // Current phase of the game
  actionType: ActionType; // Last action type taken in the game
  playerId: string | null; // ID of the player who took the last action
  cards: Card[] | null; // Card involved in the last action, if any
  scoreChange: number; // Points gained from the last action, if any
  timestamp: Date; // Time of the last action
  scoreBreakdown?: ScoreBreakdownItem[]; // NEW: Detailed breakdown of scoring (empty array if no scoring)
  // peggingStack?: Card[]; // Stack of played cards during pegging (including card just played) (if phase is PEGGING)
  // peggingGoPlayers?: string[]; // List of players who have said "Go" during this pegging stack (if phase is PEGGING)
  // peggingLastCardPlayer?: string; // Player who played the last card during pegging (if phase is PEGGING)
  // playedCards: PlayedCard[]; // List of all cards played during the pegging phase to help with keeping track of played cards
  // peggingTotal?: number; // Total value of the cards played in the current pegging stack
}

/**
 * Context-specific data for each decision type
 */
export type DecisionRequestData =
  | PlayCardRequestData
  | DiscardRequestData
  | DealRequestData
  | CutDeckRequestData
  | SelectDealerCardRequestData
  | AcknowledgeRequestData;

export interface PlayCardRequestData {
  peggingHand: Card[];
  peggingStack: Card[];
  playedCards: PlayedCard[];
  peggingTotal: number;
}

export interface DiscardRequestData {
  hand: Card[];
  numberOfCardsToDiscard: number;
}

export interface DealRequestData {
  // Future: could include shuffle options, etc.
  canShuffle?: boolean; // Whether player can shuffle before dealing
}

export interface CutDeckRequestData {
  maxIndex: number; // Maximum valid cut index (deck.length - 1)
  deckSize: number; // Total deck size for context
}

export interface SelectDealerCardRequestData {
  maxIndex: number; // Maximum valid card index (deck.length - 1)
  deckSize: number; // Total deck size for context
}

export interface AcknowledgeRequestData {
  message: string; // User-friendly message (e.g., "Ready for counting")
  // No additional data needed - just acknowledgment
}

/**
 * Unified interface for all decision requests
 * All active requests are stored in GameSnapshot.pendingDecisionRequests
 */
export interface DecisionRequest {
  requestId: string; // Unique ID for this request (UUID)
  playerId: string; // Player who must respond
  decisionType: AgentDecisionType; // Type of decision required
  requestData: DecisionRequestData; // Context-specific data for the request
  required: boolean; // Whether this blocks game flow (true for all)
  timestamp: Date; // When request was made
  expiresAt?: Date; // Optional expiration (for future timeout handling)
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
  peggingTotal: number; // Total value of the cards played in the current pegging stack
  snapshotId: number;
  roundNumber: number;
  dealerSelectionCards?: Record<string, Card | 'UNKNOWN'>; // Cards selected by each player for dealer selection (hidden until all selected)
  // waitingForPlayers removed - decision requests now in GameSnapshot.pendingDecisionRequests
}

export interface GameSnapshot {
  gameState: GameState; // Current state of the game
  gameEvent: GameEvent; // Last event that occurred in the game
  pendingDecisionRequests: DecisionRequest[]; // Active decision requests (new third field)
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
  playerId: string; // Unique identifier for the agent
  human: boolean; // Whether the agent represents a human player
  
  // Game action decisions
  // Note: snapshot contains redacted gameState and gameEvent, plus all pendingDecisionRequests
  makeMove(snapshot: GameSnapshot, playerId: string): Promise<Card | null>;
  discard(
    snapshot: GameSnapshot,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]>;
  deal?(snapshot: GameSnapshot, playerId: string): Promise<void>; // Explicit deal action
  cutDeck?(snapshot: GameSnapshot, playerId: string, maxIndex: number): Promise<number>; // Cut deck with index
  selectDealerCard?(snapshot: GameSnapshot, playerId: string, maxIndex: number): Promise<number>; // Select dealer card with index
  
  // Acknowledgment decisions (parallel, blocking)
  acknowledgeReadyForGameStart?(snapshot: GameSnapshot, playerId: string): Promise<void>;
  acknowledgeReadyForCounting?(snapshot: GameSnapshot, playerId: string): Promise<void>;
  acknowledgeReadyForNextRound?(snapshot: GameSnapshot, playerId: string): Promise<void>;
  
  // REMOVED: waitForContinue (replaced by specific acknowledgment methods)
}

export type ScoreType =
  | 'FIFTEEN'
  | 'PAIR'
  | 'TRIPS'
  | 'FOUR_OF_A_KIND'
  | 'RUN_OF_3'
  | 'RUN_OF_4'
  | 'RUN_OF_5'
  | 'RUN_OF_6'
  | 'RUN_OF_7'
  | 'RUN_OF_8'
  | 'RUN_OF_9'
  | 'RUN_OF_10'
  | 'NOBS'
  | 'FLUSH'
  | 'DOUBLE_RUN_OF_3'
  | 'DOUBLE_RUN_OF_4'
  | 'TRIPLE_RUN_OF_3'
  | 'QUADRUBLE_RUN_OF_3';

/**
 * Scoring breakdown type - detailed scoring reasons
 */
export type ScoreBreakdownType =
  // Hand/Crib Scoring
  | 'FIFTEEN'                    // Combination summing to 15
  | 'PAIR'                       // Two cards of same rank
  | 'THREE_OF_A_KIND'            // Three cards of same rank
  | 'FOUR_OF_A_KIND'             // Four cards of same rank
  | 'RUN_OF_3'                   // Three consecutive cards
  | 'RUN_OF_4'                   // Four consecutive cards
  | 'RUN_OF_5'                   // Five consecutive cards
  | 'DOUBLE_RUN_OF_3'            // Run of 3 with one duplicate (e.g., 2,3,4,4)
  | 'DOUBLE_RUN_OF_4'             // Run of 4 with one duplicate
  | 'TRIPLE_RUN_OF_3'            // Run of 3 with two duplicates (e.g., 2,3,4,4,4)
  | 'QUADRUPLE_RUN_OF_3'         // Run of 3 with three duplicates (e.g., 2,3,3,4,4)
  | 'FLUSH_4'                    // Four cards of same suit (hand only, not crib)
  | 'FLUSH_5'                    // Five cards of same suit (including cut card)
  | 'RIGHT_JACK'                 // Jack in hand matching cut card suit
  // Pegging Scoring
  | 'PEGGING_FIFTEEN'            // Pegging stack sums to 15 (all cards in stack)
  | 'PEGGING_THIRTY_ONE'         // Pegging stack sums to 31 (all cards in stack)
  | 'PEGGING_PAIR'               // Last 2 cards same rank
  | 'PEGGING_THREE_OF_A_KIND'    // Last 3 cards same rank
  | 'PEGGING_FOUR_OF_A_KIND'     // Last 4 cards same rank
  | 'PEGGING_RUN_OF_3'           // Last 3 cards form run
  | 'PEGGING_RUN_OF_4'           // Last 4 cards form run
  | 'PEGGING_RUN_OF_5'           // Last 5 cards form run
  | 'PEGGING_RUN_OF_6'           // Last 6 cards form run
  | 'PEGGING_RUN_OF_7'           // Last 7 cards form run (maximum possible)
  // Special Scoring
  | 'LAST_CARD'                  // Player played last card in pegging round
  | 'HEELS';                     // Dealer got jack as turn card

/**
 * Individual scoring breakdown item
 */
export interface ScoreBreakdownItem {
  type: ScoreBreakdownType;  // Type of scoring (e.g., 'FIFTEEN', 'PAIR', 'DOUBLE_RUN_OF_3')
  points: number;            // Points awarded for this specific item
  cards: Card[];             // Cards that contributed to this score
  description: string;       // Human-readable description (e.g., "Double run of 3")
}

////// Types for Event Emitters //////

export interface EmittedData {
  playerId: string;
}

export interface EmittedRequest extends EmittedData {
  requestType: AgentDecisionType;
}

// to player
export interface EmittedMakeMoveRequest extends EmittedRequest {
  peggingHand: Card[];
  peggingStack: Card[];
  playedCards: PlayedCard[];
  peggingTotal: number;
}

// from player
export interface EmittedMakeMoveResponse extends EmittedData {
  selectedCard: Card | null;
}

// to player
export interface EmittedMakeMoveInvalid extends EmittedData {
  reason: string;
  makeMoveRequest: EmittedMakeMoveRequest;
}

// to player
export interface EmittedDiscardRequest extends EmittedRequest {
  hand: Card[];
  numberOfCardsToDiscard: number;
}

// from player
export interface EmittedDiscardResponse extends EmittedData {
  selectedCards: Card[];
}

// to player
export interface EmittedDiscardInvalid extends EmittedData {
  reason: string;
  discardRequest: EmittedDiscardRequest;
}

// REMOVED: EmittedContinueRequest and EmittedContinueResponse
// Replaced by unified DecisionRequest/DecisionResponse system

export enum AgentDecisionType {
  // Game action decisions (require specific responses)
  PLAY_CARD = 'PLAY_CARD', // Player must play a card
  DISCARD = 'DISCARD', // Player must discard cards (parallel)
  DEAL = 'DEAL', // Dealer must deal cards (explicit action)
  CUT_DECK = 'CUT_DECK', // Player must cut deck (explicit action with index)
  SELECT_DEALER_CARD = 'SELECT_DEALER_CARD', // Player selects a card to determine dealer (parallel)
  
  // Acknowledgment decisions (pacing/blocking)
  READY_FOR_GAME_START = 'READY_FOR_GAME_START', // Acknowledge ready to start game (after dealer selection)
  READY_FOR_COUNTING = 'READY_FOR_COUNTING', // Acknowledge ready for counting
  READY_FOR_NEXT_ROUND = 'READY_FOR_NEXT_ROUND', // Acknowledge ready for next round
  // REMOVED: CONTINUE (replaced by specific acknowledgment types)
}

// REMOVED: EmittedDecisionRequest (replaced by DecisionRequest)
// REMOVED: EmittedWaitingForPlayer (replaced by DecisionRequest in GameSnapshot)

/**
 * Decision response types for WebSocket communication
 * Client sends these in response to DecisionRequests
 */
export type DecisionResponse =
  | PlayCardResponse
  | DiscardResponse
  | DealResponse
  | CutDeckResponse
  | SelectDealerCardResponse
  | AcknowledgeResponse;

export interface PlayCardResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.PLAY_CARD;
  selectedCard: Card | null;
}

export interface DiscardResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.DISCARD;
  selectedCards: Card[];
}

export interface DealResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.DEAL;
  // No data needed - just acknowledgment
}

export interface CutDeckResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.CUT_DECK;
  cutIndex: number;
}

export interface SelectDealerCardResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.SELECT_DEALER_CARD;
  cardIndex: number; // Index of the card selected from the deck
}

export interface AcknowledgeResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.READY_FOR_GAME_START | AgentDecisionType.READY_FOR_COUNTING | AgentDecisionType.READY_FOR_NEXT_ROUND;
  // No data needed - just acknowledgment
}

// create type for declaring a specific game that is played
export interface GameInfo {
  id: string; // Unique identifier for the game
  playerIds: string[]; // List of player IDs in the game
  lobbyId: string; // Unique identifier for the lobby
  startTime: Date; // Time when the game started
  endTime: Date | null; // Time when the game ended (null if not ended)
  gameWinner: string | null; // ID of the player who won the game (null if not ended)
}
