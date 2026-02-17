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
  sumOfPeggingStack,
  scoreHandWithBreakdown,
  scorePeggingWithBreakdown,
} from './scoring';
import { ScoreBreakdownItem } from '../types';
import EventEmitter from 'eventemitter3';
import { isValidDiscard, playerHasValidPlay } from './utils';
import {
  validatePlayerCount,
  getPlayerCountConfig,
  getExpectedCribSize,
} from '../gameplay/rules';
import { logger } from '../utils/logger';

/**
 * Serialized state for CribbageGame restoration
 * Dates are serialized as ISO strings for JSON compatibility
 */
export interface SerializedCribbageGameState {
  gameState: GameState;
  gameSnapshotHistory: Array<{
    gameState: GameState;
    gameEvent: Omit<GameEvent, 'timestamp'> & { timestamp: string };
    pendingDecisionRequests: Array<
      Omit<DecisionRequest, 'timestamp' | 'expiresAt'> & {
        timestamp: string;
        expiresAt?: string | null;
      }
    >;
  }>;
  pendingDecisionRequests: Array<
    Omit<DecisionRequest, 'timestamp' | 'expiresAt'> & {
      timestamp: string;
      expiresAt?: string | null;
    }
  >;
  dealerSelectionCards: Array<
    [string, { cardIndex: number; card: Card; timestamp: number }]
  >;
}

export class CribbageGame extends EventEmitter {
  private gameState: GameState;
  // private gameEventRecords: GameEvent[]; // Log of all game actions
  private gameSnapshotHistory: GameSnapshot[]; // Log of all game state and events
  private pendingDecisionRequests: DecisionRequest[] = []; // Active decision requests
  private dealerSelectionCards: Map<
    string,
    { cardIndex: number; card: Card; timestamp: number }
  > = new Map(); // Track dealer selection cards

  private deepClone<T>(value: T): T {
    const structuredCloneFn = (globalThis as { structuredClone?: <U>(x: U) => U })
      .structuredClone;
    if (typeof structuredCloneFn === 'function') {
      return structuredCloneFn(value);
    }
    // Fallback for runtimes without structuredClone.
    // Current game/session payloads are JSON-safe, so this preserves
    // compatibility for legacy environments.
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private cloneGameState(gameState: GameState): GameState {
    return this.deepClone(gameState);
  }

  private cloneDecisionRequests(
    requests: DecisionRequest[]
  ): DecisionRequest[] {
    return requests.map(request => ({
      ...request,
      requestData: this.deepClone(request.requestData),
      timestamp: new Date(request.timestamp),
      expiresAt: request.expiresAt ? new Date(request.expiresAt) : undefined,
    }));
  }

  constructor(playersInfo: PlayerIdAndName[], startingScore = 0) {
    super();
    // Validate player count (2-4 players)
    validatePlayerCount(playersInfo.length);
    const deck = this.generateDeck();
    // Initially, no dealer is set - dealer will be determined by card selection
    const players = playersInfo.map(info => ({
      id: info.id,
      name: info.name,
      hand: [],
      peggingHand: [],
      playedCards: [],
      score: startingScore,
      isDealer: false, // Dealer will be determined by card selection
      pegPositions: {
        current: startingScore,
        previous: startingScore,
      },
    })) as Player[];
    const id = `game-${Date.now()}-${playersInfo.map(p => p.id).join('-')}`;
    this.gameState = {
      id: id,
      players,
      deck,
      currentPhase: Phase.DEALER_SELECTION, // Start with dealer selection phase
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

  private updatePlayerScore(player: Player, points: number): void {
    if (points === 0) {
      return;
    }

    // Always update the numeric score, even for negative adjustments.
    // In standard cribbage play scores only increase, but allowing negative
    // changes supports correction/administrative adjustments and tests.
    const nextScore = player.score + points;
    player.score = nextScore;

    // Only perform the normal "two-peg" movement behavior when scoring
    // increases. For negative adjustments, keep peg state consistent with the
    // updated score without treating it as a scoring movement.
    if (points > 0) {
      // Move current peg position to previous
      player.pegPositions.previous = player.pegPositions.current;
      // Update current peg to new score position
      player.pegPositions.current = player.score;
      return;
    }

    // Negative adjustment: align current peg to score and prevent previous from
    // being ahead of current.
    player.pegPositions.current = player.score;
    if (player.pegPositions.previous > player.pegPositions.current) {
      player.pegPositions.previous = player.pegPositions.current;
    }
  }

  private recordGameEvent(
    actionType: ActionType,
    playerId: string | null,
    cards: Card[] | null,
    scoreChange: number,
    scoreBreakdown?: ScoreBreakdownItem[]
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
      scoreBreakdown: scoreBreakdown || [],
    };
    const newGameSnapshot: GameSnapshot = {
      gameEvent,
      // Store an immutable copy to preserve historical snapshot integrity.
      gameState: this.cloneGameState(this.gameState),
      pendingDecisionRequests: this.cloneDecisionRequests(
        this.pendingDecisionRequests
      ),
    };
    this.gameSnapshotHistory.push(newGameSnapshot);
    this.emit('gameSnapshot', newGameSnapshot);
  }

  public getCrib(): Card[] {
    return this.gameState.crib;
  }

  public startRound(): void {
    // dont rotate dealer if this is the first round
    // Check roundNumber instead of snapshotHistory.length because dealer selection creates snapshots
    if (this.gameState.roundNumber > 0) {
      this.gameState.deck = this.generateDeck();
      // Rotate dealer position
      const dealerIndex = this.gameState.players.findIndex(
        player => player.isDealer
      );
      const currentDealer = this.gameState.players[dealerIndex];
      const nextDealerIndex = (dealerIndex + 1) % this.gameState.players.length;
      const nextDealer = this.gameState.players[nextDealerIndex];
      if (currentDealer) {
        currentDealer.isDealer = false;
      }
      if (nextDealer) {
        nextDealer.isDealer = true;
      }
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

    // Auto-deal cards to crib for 3-player games
    const config = getPlayerCountConfig(this.gameState.players.length);
    if (config.autoCribCardsFromDeck > 0) {
      // Deal cards from deck to crib before player dealing
      const autoCribCards = this.gameState.deck.splice(
        0,
        config.autoCribCardsFromDeck
      );
      this.gameState.crib.push(...autoCribCards);
      // Record the auto-crib event
      this.recordGameEvent(
        ActionType.AUTO_CRIB_CARD,
        null, // No player associated with auto-crib
        autoCribCards,
        0
      );
      logger.info(
        `Auto-dealt ${
          autoCribCards.length
        } card(s) to crib: ${autoCribCards.join(', ')}`
      );
    }
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

    // Set phase to END before recording the event so the snapshot includes Phase.END
    this.gameState.currentPhase = Phase.END;

    // Record the WIN event and emit final snapshot with Phase.END
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

    // Get hand size based on player count
    const config = getPlayerCountConfig(this.gameState.players.length);

    this.gameState.players.forEach((player: Player) => {
      player.hand = this.gameState.deck.splice(0, config.handSize);
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
    const secondPlayer = this.gameState.players[1];
    if (secondPlayer && playerId === secondPlayer.id) {
      // logger.info(`Player ${playerId} hand: ${player.hand.join(', ')}`);
      // logger.info(`Player ${playerId} discards: ${cards.join(', ')}`);
    }
    // Remove cards from player's hand and add to the crib
    player.hand = player.hand.filter((card: Card) => !cards.includes(card));
    this.gameState.crib.push(...cards);
    // Log the discard action
    this.recordGameEvent(ActionType.DISCARD, playerId, cards, 0);
  }

  public completeCribPhase(): void {
    const expectedSize = getExpectedCribSize(this.gameState.players.length);
    if (this.gameState.crib.length !== expectedSize) {
      throw new Error(
        'Crib phase not complete. Ensure all players discarded. ' +
          `Expected ${expectedSize} cards in crib, but found ${this.gameState.crib.length}.`
      );
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
      this.updatePlayerScore(dealer, 2);
      const heelsBreakdown: ScoreBreakdownItem[] = [
        {
          type: 'HEELS',
          points: 2,
          cards: [cutCard],
          description: 'Heels',
        },
      ];
      this.recordGameEvent(
        ActionType.SCORE_HEELS,
        dealer.id,
        [cutCard],
        2,
        heelsBreakdown
      );
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

  /**
   * Handle dealer card selection with conflict resolution
   * If two players select the same index, first request gets that index,
   * second gets next available (or previous if at end)
   */
  public selectDealerCard(playerId: string, requestedIndex: number): void {
    if (this.gameState.currentPhase !== Phase.DEALER_SELECTION) {
      throw new Error(
        'Cannot select dealer card outside of dealer selection phase.'
      );
    }

    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    // Check if player already selected
    if (this.dealerSelectionCards.has(playerId)) {
      throw new Error('Player has already selected a dealer card.');
    }

    // Check if requested index is already taken
    const takenIndices = Array.from(this.dealerSelectionCards.values()).map(
      v => v.cardIndex
    );
    let finalIndex = requestedIndex;

    if (takenIndices.includes(requestedIndex)) {
      // Conflict: find next available index
      const maxIndex = this.gameState.deck.length - 1;
      let nextIndex = requestedIndex + 1;

      // Try next indices first
      while (nextIndex <= maxIndex && takenIndices.includes(nextIndex)) {
        nextIndex++;
      }

      if (nextIndex <= maxIndex) {
        finalIndex = nextIndex;
      } else {
        // Try previous indices if next doesn't work
        let prevIndex = requestedIndex - 1;
        while (prevIndex >= 0 && takenIndices.includes(prevIndex)) {
          prevIndex--;
        }
        if (prevIndex >= 0) {
          finalIndex = prevIndex;
        } else {
          throw new Error('No available card indices for dealer selection.');
        }
      }
    }

    // Validate index
    if (finalIndex < 0 || finalIndex >= this.gameState.deck.length) {
      throw new Error(`Invalid card index: ${finalIndex}`);
    }

    const selectedCard = this.gameState.deck[finalIndex];
    if (!selectedCard) {
      throw new Error('No card found at selected index.');
    }

    // Store selection
    this.dealerSelectionCards.set(playerId, {
      cardIndex: finalIndex,
      card: selectedCard,
      timestamp: Date.now(),
    });

    // Record event
    this.recordGameEvent(
      ActionType.SELECT_DEALER_CARD,
      playerId,
      [selectedCard],
      0
    );

    // Check if all players have selected
    if (this.dealerSelectionCards.size === this.gameState.players.length) {
      this.determineDealer();
    }
  }

  /**
   * Determine dealer based on selected cards (lowest card wins)
   * Uses runValue for ranking, suit breaks ties (Clubs < Diamonds < Hearts < Spades)
   */
  private determineDealer(): void {
    const suitOrder: Record<string, number> = {
      SPADES: 4,
      HEARTS: 3,
      DIAMONDS: 2,
      CLUBS: 1,
    };

    if (this.dealerSelectionCards.size === 0) {
      throw new Error('Could not determine dealer - no cards selected.');
    }

    // Convert to array for easier processing
    const selections = Array.from(this.dealerSelectionCards.entries());
    if (selections.length === 0) {
      throw new Error('Could not determine dealer - no cards selected.');
    }

    // Find lowest card
    const lowestSelection = selections.reduce(
      (lowest, [playerId, selection]) => {
        const parsed = parseCard(selection.card);
        const suitOrderValue = suitOrder[parsed.suit] || 0;

        if (!lowest) {
          return {
            playerId,
            card: selection.card,
            runValue: parsed.runValue,
            suitOrder: suitOrderValue,
          };
        }

        // Compare: first by runValue (lower wins), then by suit (lower wins)
        if (
          parsed.runValue < lowest.runValue ||
          (parsed.runValue === lowest.runValue &&
            suitOrderValue < lowest.suitOrder)
        ) {
          return {
            playerId,
            card: selection.card,
            runValue: parsed.runValue,
            suitOrder: suitOrderValue,
          };
        }

        return lowest;
      },
      null as {
        playerId: string;
        card: Card;
        runValue: number;
        suitOrder: number;
      } | null
    );

    if (!lowestSelection) {
      throw new Error('Could not determine dealer - no cards selected.');
    }

    // Set dealer
    const dealerId = lowestSelection.playerId;
    const dealerCard = lowestSelection.card;
    this.gameState.players.forEach(player => {
      player.isDealer = player.id === dealerId;
    });

    logger.info(
      `Dealer determined: Player ${dealerId} selected ${dealerCard} (lowest card)`
    );

    // Transition to DEALING phase
    // NOTE: Do NOT clear dealerSelectionCards here - they need to remain visible
    // during the READY_FOR_GAME_START acknowledgment phase
    // They will be cleared after acknowledgment completes
    this.gameState.currentPhase = Phase.DEALING;
    // Clear dealer-card requests immediately when dealer selection completes.
    // This prevents stale SELECT_DEALER_CARD requests from leaking into the
    // DEALING phase snapshot.
    this.pendingDecisionRequests = this.pendingDecisionRequests.filter(
      request => request.decisionType !== AgentDecisionType.SELECT_DEALER_CARD
    );
    this.recordGameEvent(ActionType.BEGIN_PHASE, null, null, 0);
  }

  /**
   * Clear dealer selection cards after acknowledgment phase
   * Called after all players have acknowledged ready for game start
   */
  public clearDealerSelectionCards(): void {
    this.dealerSelectionCards.clear();
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
    const followingPlayer = this.gameState.players[followingPlayerIndex];
    if (!followingPlayer) {
      throw new Error('Following player not found.');
    }
    return followingPlayer.id;
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
    logger.info('PEGGING ROUND OVER; last card player:', lastCardPlayer, '\n');
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
        logger.info(`Player ${playerId} got the last card! and scored 1 point`);
        // Capture pegging stack BEFORE calling startNewPeggingRound() which clears it
        const peggingStackForBreakdown = [...this.gameState.peggingStack];
        const lastPlayer = this.startNewPeggingRound();
        // give the player a point for playing the last card
        this.updatePlayerScore(player, 1);
        // log the scoring of the last card
        // Include the entire pegging stack for context (captured before reset)
        const lastCardBreakdown: ScoreBreakdownItem[] = [
          {
            type: 'LAST_CARD',
            points: 1,
            cards: peggingStackForBreakdown,
            description: 'Last card',
          },
        ];
        this.recordGameEvent(
          ActionType.LAST_CARD,
          playerId,
          null,
          1,
          lastCardBreakdown
        );
        return lastPlayer;
      }

      // add player to list of players who have said "Go"
      if (!this.gameState.peggingGoPlayers.includes(playerId)) {
        this.gameState.peggingGoPlayers.push(playerId);
        this.recordGameEvent(ActionType.GO, playerId, null, 0);
      }
      logger.info(`Player ${playerId} said "Go"`);

      // Check if all other players have said "Go" or can't play, and the last card player can't play
      // This handles the case where the last card player ran out of cards OR has cards but can't play them
      // (e.g., they have a 2 but stack is at 30, so playing it would exceed 31)
      // The last card player doesn't need to say "Go" - they just need to be unable to play
      // Players with no cards are automatically skipped (they don't say "Go")
      // Players with cards who can't play MUST say "Go" before the bonus is awarded
      // Only check this if the current player saying "Go" is NOT the last card player
      // (if the last card player is saying "Go", they should go through the normal path above)
      const lastCardPlayer = this.gameState.players.find(
        p => p.id === this.gameState.peggingLastCardPlayer
      );
      if (
        lastCardPlayer &&
        !playerHasValidPlay(this.gameState, lastCardPlayer) &&
        lastCardPlayer.id !== playerId
      ) {
        // Check if all other players (excluding last card player and current player) have either:
        // - Said "Go" (if they have cards but can't play - they MUST say "Go")
        // - Have no cards (automatically skipped, don't need to say "Go")
        const allOthersGoneOrCantPlay = this.gameState.players
          .filter(p => p.id !== lastCardPlayer.id && p.id !== playerId)
          .every(p => {
            // If player has no cards, they're automatically skipped (can't play)
            if (p.peggingHand.length === 0) {
              return true;
            }
            // If player has cards but can't play, they MUST have said "Go"
            if (!playerHasValidPlay(this.gameState, p)) {
              return this.gameState.peggingGoPlayers.includes(p.id);
            }
            // If player can play, they haven't "gone" yet
            return false;
          });
        // If all other players have said "Go" or have no cards, give the last card player a point
        if (allOthersGoneOrCantPlay) {
          logger.info(
            `All other players have said Go or have no cards. Player ${lastCardPlayer.id} (can't play) gets last card point!`
          );
          // Capture pegging stack BEFORE calling startNewPeggingRound() which clears it
          const peggingStackForBreakdown = [...this.gameState.peggingStack];
          const lastPlayer = this.startNewPeggingRound();
          // give the player a point for playing the last card
          this.updatePlayerScore(lastCardPlayer, 1);
          // log the scoring of the last card
          const lastCardBreakdown: ScoreBreakdownItem[] = [
            {
              type: 'LAST_CARD',
              points: 1,
              cards: peggingStackForBreakdown,
              description: 'Last card',
            },
          ];
          this.recordGameEvent(
            ActionType.LAST_CARD,
            lastCardPlayer.id,
            null,
            1,
            lastCardBreakdown
          );
          return lastPlayer;
        }
      }

      return null;
    }

    // add the played card to the pegging stack
    this.gameState.peggingStack.push(card);

    // add the card to the list of played cards
    this.gameState.playedCards.push({ playerId, card });

    // score the pegging stack
    const { total, breakdown } = scorePeggingWithBreakdown(
      this.gameState.peggingStack
    );

    // add the score to the player's total
    this.updatePlayerScore(player, total);

    // remove the played card from the player's hand
    player.peggingHand = player.peggingHand.filter(c => c !== card);

    // set this player as player who played the last card
    this.gameState.peggingLastCardPlayer = playerId;

    // log the play action
    this.recordGameEvent(
      ActionType.PLAY_CARD,
      playerId,
      [card],
      total,
      breakdown
    );

    // if this is the last card in the pegging round, give the player a point for last
    // (unless the last card made 31 — in that case we already scored 2 for 31, no extra last-card point)
    const playersWithCards = this.gameState.players.filter(
      player => player.peggingHand.length > 0
    );
    if (playersWithCards.length === 0) {
      if (sumOfPeggingStack(this.gameState.peggingStack) === 31) {
        logger.info(
          `Player ${playerId} played the last card (made 31) - no last card point, already scored 2 for 31`
        );
        return this.startNewPeggingRound();
      }
      // give the player a point for playing the last card
      this.updatePlayerScore(player, 1);
      // log the scoring of the last card
      // Include the entire pegging stack for context
      const lastCardBreakdown: ScoreBreakdownItem[] = [
        {
          type: 'LAST_CARD',
          points: 1,
          cards:
            this.gameState.peggingStack.length > 0
              ? this.gameState.peggingStack
              : [],
          description: 'Last card',
        },
      ];
      this.recordGameEvent(
        ActionType.LAST_CARD,
        playerId,
        null,
        1,
        lastCardBreakdown
      );
      // call resetPeggingRound to reset the pegging round and return the ID of last card player
      logger.info(`Player ${playerId} played the last card and scored 1 point`);
      return this.startNewPeggingRound();
    }

    // BUG FIX: Check if this player just ran out of cards and all other players have said Go
    // This handles the case where:
    // - Player A says "Go" (can't play without exceeding 31)
    // - Player B plays their last card (now has 0 cards)
    // - No one can play anymore, so round should end with B getting last card point
    if (player.peggingHand.length === 0) {
      // Current player just ran out of cards
      // Check if all other players with cards have said Go
      const allOthersWithCardsHaveSaidGo = this.gameState.players
        .filter(p => p.id !== playerId && p.peggingHand.length > 0)
        .every(p => this.gameState.peggingGoPlayers.includes(p.id));

      if (allOthersWithCardsHaveSaidGo) {
        // All other players with cards have said Go, so this player gets last card point
        // (unless the last card made 31 — in that case we already scored 2 for 31, no extra last-card point)
        if (sumOfPeggingStack(this.gameState.peggingStack) === 31) {
          logger.info(
            `Player ${playerId} played their last card (made 31) - no last card point, already scored 2 for 31`
          );
          return this.startNewPeggingRound();
        }
        logger.info(
          `Player ${playerId} played their last card and all others with cards have said Go - awarding last card point`
        );
        this.updatePlayerScore(player, 1);
        const lastCardBreakdown: ScoreBreakdownItem[] = [
          {
            type: 'LAST_CARD',
            points: 1,
            cards:
              this.gameState.peggingStack.length > 0
                ? this.gameState.peggingStack
                : [],
            description: 'Last card',
          },
        ];
        this.recordGameEvent(
          ActionType.LAST_CARD,
          playerId,
          null,
          1,
          lastCardBreakdown
        );
        return this.startNewPeggingRound();
      }
    }

    // if the sum of cards in the pegging stack is 31, end the pegging round
    if (sumOfPeggingStack(this.gameState.peggingStack) === 31) {
      // call resetPeggingRound to reset the pegging round and return the ID of last card player
      logger.info(
        `Player ${playerId} played ${card} and got 31 for ${total} points`
      );
      return this.startNewPeggingRound();
    }
    logger.info(
      `Player ${playerId} played ${card} for ${total} points - ${sumOfPeggingStack(
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

    const { total, breakdown } = scoreHandWithBreakdown(
      player.hand,
      this.gameState.turnCard,
      false
    );
    this.updatePlayerScore(player, total);
    this.recordGameEvent(
      ActionType.SCORE_HAND,
      playerId,
      player.hand,
      total,
      breakdown
    );
    return total;
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

    const { total, breakdown } = scoreHandWithBreakdown(
      this.gameState.crib,
      this.gameState.turnCard,
      true
    );
    this.updatePlayerScore(player, total);
    this.recordGameEvent(
      ActionType.SCORE_CRIB,
      playerId,
      this.gameState.crib,
      total,
      breakdown
    );
    return total;
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

    this.updatePlayerScore(player, points);

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
    if (
      !this.pendingDecisionRequests.find(r => r.requestId === request.requestId)
    ) {
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

    // Add dealer selection cards (hidden until all players have selected)
    const dealerSelectionCards: Record<string, Card | 'UNKNOWN'> = {};
    if (
      this.gameState.currentPhase === Phase.DEALER_SELECTION ||
      (this.gameState.currentPhase === Phase.DEALING &&
        this.dealerSelectionCards.size > 0)
    ) {
      for (const player of this.gameState.players) {
        dealerSelectionCards[player.id] = this.getDealerSelectionCard(
          player.id,
          forPlayerId
        );
      }
    }

    // Return redacted game state
    return {
      ...this.gameState,
      players: redactedPlayers,
      crib: redactedCrib,
      deck: redactedDeck,
      dealerSelectionCards:
        Object.keys(dealerSelectionCards).length > 0
          ? dealerSelectionCards
          : undefined,
      // All other fields remain visible (scores, pegging stack, turn card, etc.)
    };
  }

  /**
   * Get dealer selection card for a player
   * Returns 'UNKNOWN' if not all players have selected yet
   * @param playerId - ID of the player whose selection to get
   * @param forPlayerId - ID of the player requesting (for redaction)
   * @returns The selected card, or 'UNKNOWN' if not all have selected
   */
  public getDealerSelectionCard(
    playerId: string,
    _forPlayerId: string
  ): Card | 'UNKNOWN' {
    // Check if all players have selected
    const allPlayersSelected =
      this.dealerSelectionCards.size === this.gameState.players.length;

    if (!allPlayersSelected) {
      // Not all players have selected - hide all cards
      return 'UNKNOWN';
    }

    // All players have selected - reveal the card
    const selection = this.dealerSelectionCards.get(playerId);
    if (!selection) {
      return 'UNKNOWN';
    }

    return selection.card;
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
    const isOpponentEvent =
      gameEvent.playerId !== null && gameEvent.playerId !== forPlayerId;
    const isCountingPhase = this.gameState.currentPhase === Phase.COUNTING;

    // Redaction rules based on action type
    let shouldRedact = false;

    switch (gameEvent.actionType) {
      case ActionType.AUTO_CRIB_CARD:
        // Auto-crib cards should be redacted until counting phase (like regular crib cards)
        shouldRedact = !isCountingPhase;
        break;

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

      case ActionType.SELECT_DEALER_CARD:
        // Dealer selection cards are hidden until all players have selected
        const allPlayersSelected =
          this.dealerSelectionCards.size === this.gameState.players.length;
        shouldRedact = !allPlayersSelected;
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
        // Preserve scoreBreakdown - it's safe to show breakdown even if cards are redacted
        // because breakdown shows scoring reasons, not card values
        scoreBreakdown: gameEvent.scoreBreakdown,
      };
    }

    // Return event with all fields including scoreBreakdown
    return {
      ...gameEvent,
      scoreBreakdown: gameEvent.scoreBreakdown,
    };
  }

  /**
   * Get a redacted version of a game snapshot for a specific player
   * Combines getRedactedGameState() and getRedactedGameEvent()
   * @param forPlayerId - ID of the player requesting the snapshot
   * @returns Redacted game snapshot where opponents' cards are hidden
   */
  public getRedactedGameSnapshot(forPlayerId: string): GameSnapshot {
    // Get the most recent snapshot (or create one if none exists)
    const latestSnapshot: GameSnapshot =
      this.gameSnapshotHistory.length > 0
        ? this.gameSnapshotHistory[this.gameSnapshotHistory.length - 1]!
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

  /**
   * Serialize game state to JSON-safe format
   * Converts Date objects to ISO strings
   * @returns Serialized game state
   */
  public serialize(): SerializedCribbageGameState {
    return {
      gameState: this.cloneGameState(this.gameState),
      gameSnapshotHistory: this.gameSnapshotHistory.map(snapshot => ({
        gameState: this.cloneGameState(snapshot.gameState),
        gameEvent: {
          ...snapshot.gameEvent,
          timestamp: snapshot.gameEvent.timestamp.toISOString(),
        },
        pendingDecisionRequests: snapshot.pendingDecisionRequests.map(req => ({
          ...req,
          timestamp: req.timestamp.toISOString(),
          expiresAt: req.expiresAt?.toISOString() ?? null,
        })),
      })),
      pendingDecisionRequests: this.pendingDecisionRequests.map(req => ({
        ...req,
        timestamp: req.timestamp.toISOString(),
        expiresAt: req.expiresAt?.toISOString() ?? null,
      })),
      dealerSelectionCards: Array.from(this.dealerSelectionCards.entries()),
    };
  }

  /**
   * Restore game state from serialized data
   * @param serialized - Serialized game state with Date fields as ISO strings
   */
  public restoreState(serialized: SerializedCribbageGameState): void {
    // Restore gameState (no Date fields in GameState itself)
    this.gameState = this.cloneGameState(serialized.gameState);

    // Restore gameSnapshotHistory with Date parsing
    this.gameSnapshotHistory = serialized.gameSnapshotHistory.map(snapshot => ({
      gameState: this.cloneGameState(snapshot.gameState),
      gameEvent: {
        ...snapshot.gameEvent,
        timestamp: new Date(snapshot.gameEvent.timestamp),
      },
      pendingDecisionRequests: snapshot.pendingDecisionRequests.map(req => ({
        ...req,
        timestamp: new Date(req.timestamp),
        expiresAt: req.expiresAt ? new Date(req.expiresAt) : undefined,
      })),
    }));

    // Restore pendingDecisionRequests with Date parsing
    this.pendingDecisionRequests = serialized.pendingDecisionRequests.map(
      req => ({
        ...req,
        timestamp: new Date(req.timestamp),
        expiresAt: req.expiresAt ? new Date(req.expiresAt) : undefined,
      })
    );

    // Restore dealerSelectionCards Map
    this.dealerSelectionCards = new Map(serialized.dealerSelectionCards);
  }
}
