import { Phase, ActionType, Card, Player, Game, GameState } from '../types';
import { scoreHand } from './scoring';

export class CribbageGame {
  private game: Game;

  constructor(playerNames: string[]) {
    const deck = this.generateDeck();
    const players = playerNames.map((name, index) => ({
      id: `player-${index + 1}`,
      name,
      hand: [],
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
      phase,
      actionType,
      playerId,
      cards,
      scoreChange,
      timestamp: new Date(),
    };
    this.game.gameStateLog.push(state);
    // console.log(state);
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
    if (!cards.every(card => player.hand.includes(card))) {
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
    this.game.currentPhase = Phase.PEGGING;
  }

  public playCard(playerId: string, card: Card): void {
    const player = this.game.players.find(p => p.id === playerId);
    if (!player || !player.hand.includes(card)) {
      throw new Error('Invalid card play.');
    }

    player.hand = player.hand.filter(c => c !== card);
    this.logState(Phase.PEGGING, ActionType.PLAY_CARD, playerId, [card], 0);
  }

  public scoreHand(playerId: string): number {
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
