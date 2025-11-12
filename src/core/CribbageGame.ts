import {
  Phase,
  ActionType,
  Card,
  Player,
  GameState,
  GameEvent,
  PlayerIdAndName,
  GameSnapshot,
  AgentDecisionType,
  DecisionRequest,
} from '../types';
import {
  parseCard,
  scoreHand,
  scorePegging,
  sumOfPeggingStack,
} from './scoring';
import EventEmitter from 'eventemitter3';
import { isValidDiscard } from './utils';

export class CribbageGame extends EventEmitter {
  private gameState: GameState;
  // private gameEventRecords: GameEvent[]; // Log of all game actions
  private gameSnapshotHistory: GameSnapshot[]; // Log of all game state and events
  private pendingDecisionRequests: DecisionRequest[] = []; // Active decision requests

  constructor(playersInfo: PlayerIdAndName[], startingScore = 0) {
    super();
    const deck = this.generateDeck();
    const players = playersInfo.map((info, index) => ({
      id: info.id,
      name: info.name,
      hand: [],
      peggingHand: [],
      playedCards: [],
      score: startingScore,
      isDealer: index === 0,
    })) as Player[];
    const id = `game-${Date.now()}-${playersInfo.map(p => p.id).join('-')}`;
    this.gameState = {
      id: id,
      players,
      deck,
      currentPhase: Phase.DEALING,
      crib: [],
      turnCard: null,
      peggingStack: [],
      peggingGoPlayers: [],
      peggingLastCardPlayer: null,
      playedCards: [],
      peggingTotal: 0,
      roundNumber: 0,
      snapshotId: 0,
    };

    // this.gameEventRecords = [];
    this.gameSnapshotHistory = [];
  }

  public generateDeck(): Card[] {
    const suits = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
    const ranks = [
      'ACE',
      'TWO',
      'THREE',
      'FOUR',
      'FIVE',
      'SIX',
      'SEVEN',
      'EIGHT',
      'NINE',
      'TEN',
      'JACK',
      'QUEEN',
      'KING',
    ];
    return suits.flatMap(suit => ranks.map(rank => `${rank}_${suit}` as Card));
  }

  private recordGameEvent(
    actionType: ActionType,
    playerId: string | null,
    cards: Card[] | null,
    scoreChange: number
  ) {
    this.gameState.snapshotId += 1;
    const gameEvent: GameEvent = {
      gameId: this.gameState.id,
      phase: this.gameState.currentPhase,
      actionType,
      playerId,
      cards,
      scoreChange,
      timestamp: new Date(),
      snapshotId: this.gameState.snapshotId,
    };
    const newGameSnapshot: GameSnapshot = {
      gameEvent,
      gameState: this.gameState,
      pendingDecisionRequests: [...this.pendingDecisionRequests], // Include current pending requests
    };
    this.gameSnapshotHistory.push(newGameSnapshot);
    this.emit('gameSnapshot', newGameSnapshot);
  }

  public getCrib(): Card[] {
    return this.gameState.crib;
  }

  public startRound(): void {
    // dont rotate dealer if this is the first round
    if (this.gameSnapshotHistory.length > 0) {
      this.gameState.deck = this.generateDeck();
      // Rotate dealer position
      const dealerIndex = this.gameState.players.findIndex(
        player => player.isDealer
      );
      this.gameState.players[dealerIndex].isDealer = false;
      this.gameState.players[
        (dealerIndex + 1) % this.gameState.players.length
      ].isDealer = true;
    }
    // increment round number
    this.gameState.roundNumber += 1;
    this.gameState.crib = [];
    this.gameState.turnCard = null;
    this.gameState.currentPhase = Phase.DEALING;
    this.gameState.playedCards = [];
    this.gameState.peggingStack = [];
    this.gameState.peggingGoPlayers = [];
    this.gameState.peggingLastCardPlayer = null;
    this.gameState.peggingTotal = 0;
    // Clear pending decision requests when starting new round
    this.pendingDecisionRequests = [];
    // reset all players' hands
    this.gameState.players.forEach(player => {
      player.hand = [];
      player.peggingHand = [];
      player.playedCards = [];
    });
    this.recordGameEvent(ActionType.START_ROUND, null, null, 0);
  }

  public endScoring(): void {
    if (this.gameState.currentPhase !== Phase.COUNTING) {
      throw new Error('Cannot end scoring outside of the counting phase.');
    }

    this.recordGameEvent(ActionType.END_PHASE, null, null, 0);
  }

  public endGame(winnerId: string): void {
    const winner = this.gameState.players.find(p => p.id === winnerId);
    if (!winner) throw new Error(`Winner not found: ${winnerId}`);
    this.recordGameEvent(ActionType.WIN, winnerId, null, 0);
  }

  public shuffleDeck(): void {
    if (this.gameState.currentPhase !== Phase.DEALING) {
      throw new Error('Cannot shuffle cards outside of the dealing phase.');
    }

    this.gameState.deck = this.gameState.deck.sort(() => Math.random() - 0.5);
  }

  private beginDiscardingPhase(): void {
    this.gameState.currentPhase = Phase.DISCARDING;
    this.recordGameEvent(ActionType.BEGIN_PHASE, null, null, 0);
  }

  public deal(): void {
    if (this.gameState.currentPhase !== Phase.DEALING) {
      throw new Error('Cannot deal cards outside of the dealing phase.');
    }

    this.shuffleDeck();

    this.gameState.players.forEach((player: Player) => {
      player.hand = this.gameState.deck.splice(0, 6);
      this.recordGameEvent(ActionType.DEAL, player.id, player.hand, 0);
    });

    // Advance to the discarding phase
    this.beginDiscardingPhase();
  }

  public discardToCrib(playerId: string, cards: Card[]): void {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (!isValidDiscard(this.gameState, player, cards)) {
      throw new Error('Invalid cards to discard.');
    }
    if (playerId === this.gameState.players[1].id) {
      // console.log(`Player ${playerId} hand: ${player.hand.join(', ')}`);
      // console.log(`Player ${playerId} discards: ${cards.join(', ')}`);
    }
    // Remove cards from player's hand and add to the crib
    player.hand = player.hand.filter((card: Card) => !cards.includes(card));
    this.gameState.crib.push(...cards);
    // Log the discard action
    this.recordGameEvent(ActionType.DISCARD, playerId, cards, 0);
  }

  public completeCribPhase(): void {
    if (this.gameState.crib.length !== 4) {
      throw new Error('Crib phase not complete. Ensure all players discarded.');
    }

    // copy each players hands to their pegging hands
    this.gameState.players.forEach(player => {
      player.peggingHand = [...player.hand];
    });
    this.gameState.currentPhase = Phase.CUTTING;
  }

  public cutDeck(playerId: string, cutIndex: number): void {
    if (this.gameState.currentPhase !== Phase.CUTTING) {
      throw new Error('Cannot cut deck outside of the cutting phase.');
    }

    this.recordGameEvent(ActionType.CUT_DECK, playerId, null, 0);

    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    const cutCard = this.gameState.deck.splice(cutIndex, 1)[0];

    if (!cutCard) throw new Error('No cards left in deck to cut.');

    this.gameState.turnCard = cutCard;
    this.recordGameEvent(ActionType.TURN_CARD, playerId, [cutCard], 0);

    // If cut card is a Jack, the dealer scores 2 points
    if (cutCard.split('_')[0] === 'JACK') {
      const dealer = this.gameState.players.find(p => p.isDealer);
      if (!dealer) throw new Error('Dealer not found.');
      dealer.score += 2;
      this.recordGameEvent(ActionType.SCORE_HEELS, dealer.id, [cutCard], 2);
    }

    // Advance to the pegging phase
    this.gameState.currentPhase = Phase.PEGGING;
    this.startNewPeggingRound();
  }

  public getPlayer(playerId: string): Player {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    return player;
  }

  public getDealerId(): string {
    const dealer = this.gameState.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Dealer not found.');
    return dealer.id;
  }

  public getFollowingPlayerId(playerId: string): string {
    const playerIndex = this.gameState.players.findIndex(
      p => p.id === playerId
    );
    if (playerIndex === -1) {
      throw new Error('Player not found.');
    }
    const followingPlayerIndex =
      (playerIndex + 1) % this.gameState.players.length;
    return this.gameState.players[followingPlayerIndex].id;
  }

  /**
   * Reset the pegging round by clearing the pegging stack and go players
   * @returns the ID of the player who played the last card
   */
  public startNewPeggingRound(): string | null {
    this.gameState.peggingStack = [];
    this.gameState.peggingGoPlayers = [];
    this.gameState.peggingTotal = 0;
    const lastCardPlayer = this.gameState.peggingLastCardPlayer;
    this.gameState.peggingLastCardPlayer = null;
    console.log('PEGGING ROUND OVER; last card player:', lastCardPlayer, '\n');
    this.recordGameEvent(ActionType.START_PEGGING_ROUND, null, null, 0);
    return lastCardPlayer;
  }

  // returns true if the pegging round is over (someone got LAST_CARD or 31)
  public playCard(playerId: string, card: Card | null): string | null {
    if (this.gameState.currentPhase !== Phase.PEGGING) {
      throw new Error('Cannot play card outside of the pegging phase.');
    }

    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    // if (!isValidPeggingPlay(this.game, player, card)) {
    //   throw new Error('Invalid card play.');
    // }

    if (card) {
      player.playedCards.push(card);
      this.gameState.peggingTotal += parseCard(card).pegValue;
    }
    // No card played = player says "Go"
    else {
      // if all other players have said "Go", give the last player to play a point
      if (
        this.gameState.peggingGoPlayers.length ===
          this.gameState.players.length - 1 &&
        !this.gameState.peggingGoPlayers.includes(playerId) &&
        this.gameState.peggingLastCardPlayer === playerId
      ) {
        // call resetPeggingRound to reset the pegging round and return the ID of last card player
        console.log(`Player ${playerId} got the last card! and scored 1 point`);
        const lastPlayer = this.startNewPeggingRound();
        // give the player a point for playing the last card
        player.score += 1;
        // log the scoring of the last card
        this.recordGameEvent(ActionType.LAST_CARD, playerId, null, 1);
        return lastPlayer;
      }

      // add player to list of players who have said "Go"
      if (!this.gameState.peggingGoPlayers.includes(playerId)) {
        this.gameState.peggingGoPlayers.push(playerId);
        this.recordGameEvent(ActionType.GO, playerId, null, 0);
      }
      console.log(`Player ${playerId} said "Go"`);
      return null;
    }

    // add the played card to the pegging stack
    this.gameState.peggingStack.push(card);

    // add the card to the list of played cards
    this.gameState.playedCards.push({ playerId, card });

    // score the pegging stack
    const score = scorePegging(this.gameState.peggingStack);

    // add the score to the player's total
    player.score += score;

    // remove the played card from the player's hand
    player.peggingHand = player.peggingHand.filter(c => c !== card);

    // set this player as player who played the last card
    this.gameState.peggingLastCardPlayer = playerId;

    // log the play action
    this.recordGameEvent(ActionType.PLAY_CARD, playerId, [card], score);

    // if this is the last card in the pegging round, give the player a point for last
    const playersWithCards = this.gameState.players.filter(
      player => player.peggingHand.length > 0
    );
    if (playersWithCards.length === 0) {
      // give the player a point for playing the last card
      player.score += 1;
      // log the scoring of the last card
      this.recordGameEvent(ActionType.LAST_CARD, playerId, null, 1);
      // call resetPeggingRound to reset the pegging round and return the ID of last card player
      console.log(`Player ${playerId} played the last card and scored 1 point`);
      return this.startNewPeggingRound();
    }

    // if the sum of cards in the pegging stack is 31, end the pegging round
    if (sumOfPeggingStack(this.gameState.peggingStack) === 31) {
      // call resetPeggingRound to reset the pegging round and return the ID of last card player
      console.log(
        `Player ${playerId} played ${card} and got 31 for ${score} points`
      );
      return this.startNewPeggingRound();
    }
    console.log(
      `Player ${playerId} played ${card} for ${score} points - ${sumOfPeggingStack(
        this.gameState.peggingStack
      )}`
    );
    return null;
  }

  public endPegging(): void {
    if (this.gameState.currentPhase !== Phase.PEGGING) {
      throw new Error('Cannot end pegging outside of the pegging phase.');
    }

    // if a player still has cards in their pegging hand, raise an error
    const playersWithCards = this.gameState.players.filter(
      player => player.peggingHand.length > 0
    );
    if (playersWithCards.length > 0) {
      throw new Error('Cannot end pegging with players still holding cards.');
    }

    this.gameState.peggingStack = [];
    this.gameState.peggingGoPlayers = [];
    this.gameState.peggingLastCardPlayer = null;
    this.gameState.peggingTotal = 0;

    // Advance to the counting phase
    this.gameState.currentPhase = Phase.COUNTING;
  }

  public scoreHand(playerId: string): number {
    if (this.gameState.currentPhase !== Phase.COUNTING) {
      throw new Error('Cannot score hand outside of the counting phase.');
    }

    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    if (!this.gameState.turnCard) {
      throw new Error('Cannot score hand without a turn card.');
    }

    const score = scoreHand(player.hand, this.gameState.turnCard, false);
    player.score += score;
    this.recordGameEvent(ActionType.SCORE_HAND, playerId, player.hand, score);
    return score;
  }

  public scoreCrib(playerId: string): number {
    if (this.gameState.currentPhase !== Phase.COUNTING) {
      throw new Error('Cannot score crib outside of the counting phase.');
    }
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    if (!this.gameState.turnCard) {
      throw new Error('Cannot score crib without a turn card.');
    }

    const score = scoreHand(this.gameState.crib, this.gameState.turnCard, true);
    player.score += score;
    this.recordGameEvent(
      ActionType.SCORE_CRIB,
      playerId,
      this.gameState.crib,
      score
    );
    return score;
  }

  /**
   * Add score to a player and automatically log the event
   * This is a setter method that enforces event logging for score changes
   * @param playerId - ID of the player receiving points
   * @param points - Number of points to add
   * @param reason - ActionType that caused the score change
   * @param cards - Optional cards involved in the scoring (for event logging)
   */
  public addScoreToPlayer(
    playerId: string,
    points: number,
    reason: ActionType,
    cards: Card[] | null = null
  ): void {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error(`Player ${playerId} not found`);
    }

    player.score += points;

    // Automatically log event
    this.recordGameEvent(reason, playerId, cards, points);
  }

  /**
   * Set the game phase and automatically log the event
   * This is a setter method that enforces event logging for phase changes
   * @param newPhase - The new phase to transition to
   * @param reason - ActionType that caused the phase change
   */
  public setPhase(newPhase: Phase, reason: ActionType): void {
    this.gameState.currentPhase = newPhase;

    // Automatically log event
    this.recordGameEvent(reason, null, null, 0);
  }

  /**
   * Add a decision request to the pending requests
   * Called by GameLoop when requesting a decision
   * @param request - The decision request to add
   */
  public addDecisionRequest(request: DecisionRequest): void {
    // Check if request already exists (by requestId)
    if (!this.pendingDecisionRequests.find(r => r.requestId === request.requestId)) {
      this.pendingDecisionRequests.push(request);
    }
  }

  /**
   * Remove a decision request (when player responds)
   * @param requestId - ID of the request to remove
   */
  public removeDecisionRequest(requestId: string): void {
    this.pendingDecisionRequests = this.pendingDecisionRequests.filter(
      r => r.requestId !== requestId
    );
  }

  /**
   * Get all pending decision requests
   * @returns Array of pending decision requests
   */
  public getPendingDecisionRequests(): DecisionRequest[] {
    return [...this.pendingDecisionRequests];
  }

  /**
   * Check if all required players have responded to a blocking request
   * Used for acknowledgment requests that require all players
   * @param decisionType - The decision type to check
   * @returns True if all players have responded
   */
  public allPlayersAcknowledged(decisionType: AgentDecisionType): boolean {
    // Find all pending requests of this type
    const pendingRequests = this.pendingDecisionRequests.filter(
      r => r.decisionType === decisionType
    );
    
    // If no pending requests, all have acknowledged
    return pendingRequests.length === 0;
  }

  /**
   * Clear all pending decision requests
   * Used during phase transitions
   */
  public clearAllDecisionRequests(): void {
    this.pendingDecisionRequests = [];
  }

  /**
   * Get a redacted version of the game state for a specific player
   * Opponents' hands and pegging hands are redacted to 'UNKNOWN' cards
   * EXCEPT during COUNTING phase when all cards are revealed
   * @param forPlayerId - ID of the player requesting the state
   * @returns Redacted game state where opponents' cards are hidden (unless counting)
   */
  public getRedactedGameState(forPlayerId: string): GameState {
    const requestingPlayer = this.gameState.players.find(
      p => p.id === forPlayerId
    );
    if (!requestingPlayer) {
      throw new Error(`Player ${forPlayerId} not found`);
    }

    // During COUNTING phase, all cards are revealed (no redaction)
    const isCountingPhase = this.gameState.currentPhase === Phase.COUNTING;

    // Create redacted players array
    const redactedPlayers = this.gameState.players.map(player => {
      if (player.id === forPlayerId) {
        // This player sees their own cards
        return {
          ...player,
          hand: [...player.hand],
          peggingHand: [...player.peggingHand],
        };
      } else {
        // Opponents' hands are redacted UNLESS we're in counting phase
        if (isCountingPhase) {
          // During counting, show all cards
          return {
            ...player,
            hand: [...player.hand],
            peggingHand: [...player.peggingHand],
          };
        } else {
          // Opponents' hands are redacted
          return {
            ...player,
            hand: player.hand.map(() => 'UNKNOWN' as Card),
            peggingHand: player.peggingHand.map(() => 'UNKNOWN' as Card),
          };
        }
      }
    });

    // Determine if crib should be visible
    // Crib is visible to all players during counting phase (when scoring happens)
    // (Note: isCountingPhase already declared above)
    const cribVisible = isCountingPhase;

    // Redact crib if not visible
    const redactedCrib = cribVisible
      ? [...this.gameState.crib]
      : this.gameState.crib.map(() => 'UNKNOWN' as Card);

    // Redact deck contents (keep count visible via length)
    const redactedDeck = this.gameState.deck.map(() => 'UNKNOWN' as Card);

    // Return redacted game state
    return {
      ...this.gameState,
      players: redactedPlayers,
      crib: redactedCrib,
      deck: redactedDeck,
      // All other fields remain visible (scores, pegging stack, turn card, etc.)
    };
  }

  /**
   * Get a redacted version of a game event for a specific player
   * Opponents' cards in events are redacted to 'UNKNOWN' cards
   * @param gameEvent - The game event to redact
   * @param forPlayerId - ID of the player requesting the event
   * @returns Redacted game event where opponents' cards are hidden
   */
  public getRedactedGameEvent(
    gameEvent: GameEvent,
    forPlayerId: string
  ): GameEvent {
    const requestingPlayer = this.gameState.players.find(
      p => p.id === forPlayerId
    );
    if (!requestingPlayer) {
      throw new Error(`Player ${forPlayerId} not found`);
    }

    // If no cards in event, return as-is
    if (!gameEvent.cards || gameEvent.cards.length === 0) {
      return gameEvent;
    }

    // Determine if event is from opponent
    const isOpponentEvent = gameEvent.playerId !== null && gameEvent.playerId !== forPlayerId;
    const isDealer = requestingPlayer.isDealer;
    const isCountingPhase = this.gameState.currentPhase === Phase.COUNTING;

    // Redaction rules based on action type
    let shouldRedact = false;

    switch (gameEvent.actionType) {
      case ActionType.DISCARD:
        // Opponent's discards are private
        shouldRedact = isOpponentEvent;
        break;

      case ActionType.DEAL:
        // Opponent's dealt cards are private
        shouldRedact = isOpponentEvent;
        break;

      case ActionType.PLAY_CARD:
        // Played cards are public (everyone sees what was played)
        shouldRedact = false;
        break;

      case ActionType.SCORE_HAND:
        // During counting phase, hands are shown (public) - no redaction
        // Outside counting phase, opponent's hand cards in events are redacted
        shouldRedact = isOpponentEvent && !isCountingPhase;
        break;

      case ActionType.SCORE_CRIB:
        // Crib is visible to all players during counting phase (when scoring happens)
        // Outside counting phase, crib is redacted
        shouldRedact = !isCountingPhase;
        break;

      case ActionType.TURN_CARD:
        // Turn card is public
        shouldRedact = false;
        break;

      case ActionType.SCORE_HEELS:
        // Turn card is public
        shouldRedact = false;
        break;

      default:
        // Other events: no cards or public
        shouldRedact = false;
        break;
    }

    if (shouldRedact) {
      return {
        ...gameEvent,
        cards: gameEvent.cards.map(() => 'UNKNOWN' as Card),
      };
    }

    return gameEvent;
  }

  /**
   * Get a redacted version of a game snapshot for a specific player
   * Combines getRedactedGameState() and getRedactedGameEvent()
   * @param forPlayerId - ID of the player requesting the snapshot
   * @returns Redacted game snapshot where opponents' cards are hidden
   */
  public getRedactedGameSnapshot(forPlayerId: string): GameSnapshot {
    // Get the most recent snapshot (or create one if none exists)
    const latestSnapshot = this.gameSnapshotHistory.length > 0
      ? this.gameSnapshotHistory[this.gameSnapshotHistory.length - 1]
      : {
          gameState: this.gameState,
          gameEvent: {
            gameId: this.gameState.id,
            phase: this.gameState.currentPhase,
            actionType: ActionType.START_ROUND,
            playerId: null,
            cards: null,
            scoreChange: 0,
            timestamp: new Date(),
            snapshotId: this.gameState.snapshotId,
          },
          pendingDecisionRequests: this.pendingDecisionRequests,
        };

    // Redact game state and game event
    const redactedGameState = this.getRedactedGameState(forPlayerId);
    const redactedGameEvent = latestSnapshot.gameEvent
      ? this.getRedactedGameEvent(latestSnapshot.gameEvent, forPlayerId)
      : {
          gameId: this.gameState.id,
          phase: this.gameState.currentPhase,
          actionType: ActionType.START_ROUND,
          playerId: null,
          cards: null,
          scoreChange: 0,
          timestamp: new Date(),
          snapshotId: this.gameState.snapshotId,
        };

    // Return redacted snapshot
    // Note: pendingDecisionRequests are not redacted - all players see all requests
    // This is intentional for parallel decisions (e.g., DISCARD)
    return {
      gameState: redactedGameState,
      gameEvent: redactedGameEvent,
      pendingDecisionRequests: [...this.pendingDecisionRequests],
    };
  }

  public getGameState(): GameState {
    return this.gameState;
  }

  // public getGameEventRecords(): GameEvent[] {
  //   return this.gameEventRecords;
  // }

  public getGameSnapshotHistory(): GameSnapshot[] {
    return this.gameSnapshotHistory;
  }
}

