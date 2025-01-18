import {
  Phase,
  ActionType,
  Card,
  Player,
  Game,
  GameState,
  PlayerIdAndName,
} from '../types';
import { scoreHand, scorePegging, sumOfPeggingStack } from './scoring';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { isValidDiscard, isValidPeggingPlay } from './utils';

export class CribbageGame extends EventEmitter {
  private game: Game;

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

    this.game = {
      id: `game-${Date.now()}`,
      players,
      deck,
      currentPhase: Phase.DEALING,
      gameStateLog: [],
      crib: [],
      turnCard: null,
      peggingStack: [],
      peggingGoPlayers: [],
      peggingLastCardPlayer: null,
      playedCards: [],
    };
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

  private logState(
    phase: Phase,
    actionType: ActionType,
    playerId: string | null,
    cards: Card[] | null,
    scoreChange: number
  ) {
    const state: GameState = {
      id: uuidv4(),
      phase,
      actionType,
      playerId,
      cards,
      scoreChange,
      timestamp: new Date(),
      playedCards: this.game.playedCards,
    };
    if (phase === Phase.PEGGING) {
      state.peggingStack = this.game.peggingStack;
      state.peggingGoPlayers = this.game.peggingGoPlayers;
    }
    this.game.gameStateLog.push(state);
    this.emit('gameStateChange', this.game);
    this.emit('logGameStateChange', state);
  }

  public getCrib(): Card[] {
    return this.game.crib;
  }

  public endRound(): void {
    this.game.deck = this.generateDeck();
    // Rotate dealer position
    const dealerIndex = this.game.players.findIndex(player => player.isDealer);
    this.game.players[dealerIndex].isDealer = false;
    this.game.players[(dealerIndex + 1) % this.game.players.length].isDealer =
      true;
    this.game.crib = [];
    this.game.turnCard = null;
    this.game.currentPhase = Phase.DEALING;
    this.game.playedCards = [];
  }

  public deal(): void {
    if (this.game.currentPhase !== Phase.DEALING) {
      throw new Error('Cannot deal cards outside of the dealing phase.');
    }

    this.game.deck = this.game.deck.sort(() => Math.random() - 0.5);

    this.game.players.forEach((player: Player) => {
      player.hand = this.game.deck.splice(0, 6);
      this.logState(Phase.DEALING, ActionType.DEAL, player.id, player.hand, 0);
    });

    this.game.currentPhase = Phase.CRIB;
  }

  public discardToCrib(playerId: string, cards: Card[]): void {
    const player = this.game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (!isValidDiscard(this.game, player, cards)) {
      throw new Error('Invalid cards to discard.');
    }
    if (playerId === this.game.players[1].id) {
      // console.log(`Player ${playerId} hand: ${player.hand.join(', ')}`);
      // console.log(`Player ${playerId} discards: ${cards.join(', ')}`);
    }
    // Remove cards from player's hand and add to the crib
    player.hand = player.hand.filter((card: Card) => !cards.includes(card));
    this.game.crib.push(...cards);
    // Log the discard action
    this.logState(
      this.game.currentPhase,
      ActionType.DISCARD,
      playerId,
      cards,
      0
    );
  }

  public completeCribPhase(): void {
    if (this.game.crib.length !== 4) {
      throw new Error('Crib phase not complete. Ensure all players discarded.');
    }

    // copy each players hands to their pegging hands
    this.game.players.forEach(player => {
      player.peggingHand = [...player.hand];
    });
    this.game.currentPhase = Phase.CUTTING;
  }

  public cutDeck(playerId: string, cutIndex: number): void {
    if (this.game.currentPhase !== Phase.CUTTING) {
      throw new Error('Cannot cut deck outside of the cutting phase.');
    }

    this.logState(Phase.CUTTING, ActionType.CUT, playerId, null, 0);

    const player = this.game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    const cutCard = this.game.deck.splice(cutIndex, 1)[0];

    if (!cutCard) throw new Error('No cards left in deck to cut.');

    this.game.turnCard = cutCard;
    this.logState(Phase.CUTTING, ActionType.TURN_CARD, playerId, [cutCard], 0);

    // If cut card is a Jack, the dealer scores 2 points
    if (cutCard.split('_')[0] === 'JACK') {
      const dealer = this.game.players.find(p => p.isDealer);
      if (!dealer) throw new Error('Dealer not found.');
      dealer.score += 2;
      this.logState(
        Phase.CUTTING,
        ActionType.SCORE_HEELS,
        dealer.id,
        [cutCard],
        2
      );
    }

    // Advance to the pegging phase
    this.resetPeggingRound();
    this.game.currentPhase = Phase.PEGGING;
  }

  public getPlayer(playerId: string): Player {
    const player = this.game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    return player;
  }

  public getDealerId(): string {
    const dealer = this.game.players.find(p => p.isDealer);
    if (!dealer) throw new Error('Dealer not found.');
    return dealer.id;
  }

  public getFollowingPlayerId(playerId: string): string {
    const playerIndex = this.game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
      throw new Error('Player not found.');
    }
    const followingPlayerIndex = (playerIndex + 1) % this.game.players.length;
    return this.game.players[followingPlayerIndex].id;
  }

  public resetPeggingRound(): string | null {
    this.game.peggingStack = [];
    this.game.peggingGoPlayers = [];
    const lastCardPlayer = this.game.peggingLastCardPlayer;
    this.game.peggingLastCardPlayer = null;
    console.log('PEGGING ROUND OVER; last card player:', lastCardPlayer, '\n');
    return lastCardPlayer;
  }

  // returns true if the pegging round is over (someone got LAST_CARD or 31)
  public playCard(playerId: string, card: Card | null): string | null {
    if (this.game.currentPhase !== Phase.PEGGING) {
      throw new Error('Cannot play card outside of the pegging phase.');
    }

    const player = this.game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    // if (!isValidPeggingPlay(this.game, player, card)) {
    //   throw new Error('Invalid card play.');
    // }

    if (!card) {
      // if all other players have said "Go", give the last player to play a point
      if (
        this.game.peggingGoPlayers.length === this.game.players.length - 1 &&
        !this.game.peggingGoPlayers.includes(playerId) &&
        this.game.peggingLastCardPlayer === playerId
      ) {
        // give the player a point for playing the last card
        player.score += 1;
        // log the scoring of the last card
        this.logState(Phase.PEGGING, ActionType.LAST_CARD, playerId, null, 1);
        // call resetPeggingRound to reset the pegging round and return the ID of last card player
        console.log(`Player ${playerId} got the last card! and scored 1 point`);
        return this.resetPeggingRound();
      }

      // add player to list of players who have said "Go"
      if (!this.game.peggingGoPlayers.includes(playerId)) {
        this.game.peggingGoPlayers.push(playerId);
        this.logState(Phase.PEGGING, ActionType.GO, playerId, null, 0);
      }
      console.log(`Player ${playerId} said "Go"`);
      return null;
    }

    // add the played card to the pegging stack
    this.game.peggingStack.push(card);

    // add the card to the list of played cards
    this.game.playedCards.push({ playerId, card });

    // score the pegging stack
    const score = scorePegging(this.game.peggingStack);

    // add the score to the player's total
    player.score += score;

    // remove the played card from the player's hand
    player.peggingHand = player.peggingHand.filter(c => c !== card);

    // set this player as player who played the last card
    this.game.peggingLastCardPlayer = playerId;

    // log the play action
    this.logState(Phase.PEGGING, ActionType.PLAY_CARD, playerId, [card], score);

    // if this is the last card in the pegging round, give the player a point for last
    const playersWithCards = this.game.players.filter(
      player => player.peggingHand.length > 0
    );
    if (playersWithCards.length === 0) {
      // give the player a point for playing the last card
      player.score += 1;
      // log the scoring of the last card
      this.logState(Phase.PEGGING, ActionType.LAST_CARD, playerId, null, 1);
      // call resetPeggingRound to reset the pegging round and return the ID of last card player
      console.log(`Player ${playerId} played the last card and scored 1 point`);
      return this.resetPeggingRound();
    }

    // if the sum of cards in the pegging stack is 31, end the pegging round
    if (sumOfPeggingStack(this.game.peggingStack) === 31) {
      // call resetPeggingRound to reset the pegging round and return the ID of last card player
      console.log(
        `Player ${playerId} played ${card} and got 31 for ${score} points`
      );
      return this.resetPeggingRound();
    }
    console.log(
      `Player ${playerId} played ${card} for ${score} points - ${sumOfPeggingStack(
        this.game.peggingStack
      )}`
    );
    return null;
  }

  public endPegging(): void {
    if (this.game.currentPhase !== Phase.PEGGING) {
      throw new Error('Cannot end pegging outside of the pegging phase.');
    }

    // if a player still has cards in their pegging hand, raise an error
    const playersWithCards = this.game.players.filter(
      player => player.peggingHand.length > 0
    );
    if (playersWithCards.length > 0) {
      throw new Error('Cannot end pegging with players still holding cards.');
    }

    this.game.peggingStack = [];
    this.game.peggingGoPlayers = [];
    this.game.peggingLastCardPlayer = null;

    // Advance to the counting phase
    this.game.currentPhase = Phase.COUNTING;
  }

  public scoreHand(playerId: string): number {
    if (this.game.currentPhase !== Phase.COUNTING) {
      throw new Error('Cannot score hand outside of the counting phase.');
    }

    const player = this.game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    if (!this.game.turnCard) {
      throw new Error('Cannot score hand without a turn card.');
    }

    const score = scoreHand(player.hand, this.game.turnCard, false);
    player.score += score;
    this.logState(
      Phase.COUNTING,
      ActionType.SCORE_HAND,
      playerId,
      player.hand,
      score
    );
    return score;
  }

  public scoreCrib(playerId: string): number {
    const player = this.game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    if (!this.game.turnCard) {
      throw new Error('Cannot score crib without a turn card.');
    }

    const score = scoreHand(this.game.crib, this.game.turnCard, true);
    player.score += score;
    this.logState(
      Phase.COUNTING,
      ActionType.SCORE_CRIB,
      playerId,
      this.game.crib,
      score
    );
    return score;
  }

  public getGameState(): Game {
    return this.game;
  }
}
