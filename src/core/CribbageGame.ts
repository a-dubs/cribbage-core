import {
  Phase,
  ActionType,
  Card,
  Player,
  GameState,
  GameEvent,
  PlayerIdAndName,
} from '../types';
import { scoreHand, scorePegging, sumOfPeggingStack } from './scoring';
import { EventEmitter } from 'events';
import { isValidDiscard, isValidPeggingPlay } from './utils';

export class CribbageGame extends EventEmitter {
  private gameState: GameState;
  private gameEventRecords: GameEvent[]; // Log of all game actions

  constructor(playersInfo: PlayerIdAndName[]) {
    super();
    const deck = this.generateDeck();
    const players = playersInfo.map((info, index) => ({
      id: info.id,
      name: info.name,
      hand: [],
      peggingHand: [],
      score: 0,
      isDealer: index === 0,
    })) as Player[];
    const id = `game-${Date.now()}`;
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
    };

    this.gameEventRecords = [];
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
    phase: Phase,
    actionType: ActionType,
    playerId: string | null,
    cards: Card[] | null,
    scoreChange: number
  ) {
    const gameEvent: GameEvent = {
      id: this.gameState.id,
      phase,
      actionType,
      playerId,
      cards,
      scoreChange,
      timestamp: new Date(),
      playedCards: this.gameState.playedCards,
    };
    if (phase === Phase.PEGGING) {
      gameEvent.peggingStack = this.gameState.peggingStack;
      gameEvent.peggingGoPlayers = this.gameState.peggingGoPlayers;
    }
    this.gameEventRecords.push(gameEvent);
    this.emit('gameStateChange', this.gameState);
    this.emit('gameEvent', gameEvent);
  }

  public getCrib(): Card[] {
    return this.gameState.crib;
  }

  public startRound(): void {
    // dont rotate dealer if this is the first round
    if (this.gameEventRecords.length > 0) {
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
    this.gameState.crib = [];
    this.gameState.turnCard = null;
    this.gameState.currentPhase = Phase.DEALING;
    this.gameState.playedCards = [];
    // reset all players' hands
    this.gameState.players.forEach(player => {
      player.hand = [];
      player.peggingHand = [];
    });
    this.recordGameEvent(Phase.DEALING, ActionType.START_ROUND, null, null, 0);
  }

  public deal(): void {
    if (this.gameState.currentPhase !== Phase.DEALING) {
      throw new Error('Cannot deal cards outside of the dealing phase.');
    }

    this.gameState.deck = this.gameState.deck.sort(() => Math.random() - 0.5);

    this.gameState.players.forEach((player: Player) => {
      player.hand = this.gameState.deck.splice(0, 6);
      this.recordGameEvent(
        Phase.DEALING,
        ActionType.DEAL,
        player.id,
        player.hand,
        0
      );
    });

    this.gameState.currentPhase = Phase.DISCARDING;
    this.recordGameEvent(
      Phase.DISCARDING,
      ActionType.BEGIN_PHASE,
      null,
      null,
      0
    );
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
    this.recordGameEvent(
      this.gameState.currentPhase,
      ActionType.DISCARD,
      playerId,
      cards,
      0
    );
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

    this.recordGameEvent(Phase.CUTTING, ActionType.CUT, playerId, null, 0);

    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    const cutCard = this.gameState.deck.splice(cutIndex, 1)[0];

    if (!cutCard) throw new Error('No cards left in deck to cut.');

    this.gameState.turnCard = cutCard;
    this.recordGameEvent(
      Phase.CUTTING,
      ActionType.TURN_CARD,
      playerId,
      [cutCard],
      0
    );

    // If cut card is a Jack, the dealer scores 2 points
    if (cutCard.split('_')[0] === 'JACK') {
      const dealer = this.gameState.players.find(p => p.isDealer);
      if (!dealer) throw new Error('Dealer not found.');
      dealer.score += 2;
      this.recordGameEvent(
        Phase.CUTTING,
        ActionType.SCORE_HEELS,
        dealer.id,
        [cutCard],
        2
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
    const lastCardPlayer = this.gameState.peggingLastCardPlayer;
    this.gameState.peggingLastCardPlayer = null;
    console.log('PEGGING ROUND OVER; last card player:', lastCardPlayer, '\n');
    this.recordGameEvent(
      Phase.PEGGING,
      ActionType.START_PEGGING_ROUND,
      null,
      null,
      0
    );
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

    // No card played = player says "Go"
    if (!card) {
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
        this.recordGameEvent(
          Phase.PEGGING,
          ActionType.LAST_CARD,
          playerId,
          null,
          1
        );
        return lastPlayer;
      }

      // add player to list of players who have said "Go"
      if (!this.gameState.peggingGoPlayers.includes(playerId)) {
        this.gameState.peggingGoPlayers.push(playerId);
        this.recordGameEvent(Phase.PEGGING, ActionType.GO, playerId, null, 0);
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
    this.recordGameEvent(
      Phase.PEGGING,
      ActionType.PLAY_CARD,
      playerId,
      [card],
      score
    );

    // if this is the last card in the pegging round, give the player a point for last
    const playersWithCards = this.gameState.players.filter(
      player => player.peggingHand.length > 0
    );
    if (playersWithCards.length === 0) {
      // give the player a point for playing the last card
      player.score += 1;
      // log the scoring of the last card
      this.recordGameEvent(
        Phase.PEGGING,
        ActionType.LAST_CARD,
        playerId,
        null,
        1
      );
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
    this.recordGameEvent(
      Phase.COUNTING,
      ActionType.SCORE_HAND,
      playerId,
      player.hand,
      score
    );
    return score;
  }

  public scoreCrib(playerId: string): number {
    const player = this.gameState.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    if (!this.gameState.turnCard) {
      throw new Error('Cannot score crib without a turn card.');
    }

    const score = scoreHand(this.gameState.crib, this.gameState.turnCard, true);
    player.score += score;
    this.recordGameEvent(
      Phase.COUNTING,
      ActionType.SCORE_CRIB,
      playerId,
      this.gameState.crib,
      score
    );
    return score;
  }

  public getGameState(): GameState {
    return this.gameState;
  }

  public getGameEventRecords(): GameEvent[] {
    return this.gameEventRecords;
  }
}
