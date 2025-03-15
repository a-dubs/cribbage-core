import { parseCard } from '../core/scoring';
import { GameState, GameAgent, Card } from '../types';

export class RandomAgent implements GameAgent {
  playerId: string;
  human = false;

  constructor(id: string) {
    this.playerId = id;
  }

  makeMove(game: GameState, playerId: string): Promise<Card | null> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found.');
    }

    if (player.peggingHand.length === 0) {
      return Promise.resolve(null);
    }

    // filter by cards that can be played (sum of stack + card <= 31) using game.peggingStack
    const parsedHand = player.peggingHand.map(parseCard);
    const parsedStack = game.peggingStack.map(parseCard);
    const validCards = parsedHand.filter(card => {
      const sum = parsedStack.reduce(
        (acc, c) => acc + c.pegValue,
        card.pegValue
      );
      return sum <= 31;
    });

    if (validCards.length === 0) {
      return Promise.resolve(null);
    }

    const filteredHand = player.peggingHand.filter(card =>
      validCards.some(c => c.runValue === parseCard(card).runValue)
    );

    if (filteredHand.length === 0) {
      throw new Error('this should never happen');
    }

    const randomIndex = Math.floor(Math.random() * filteredHand.length);
    return Promise.resolve(filteredHand[randomIndex]);
  }

  discard(
    game: GameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');

    if (player.hand.length === 4)
      throw new Error('Player has already discarded');

    const randomIndices = new Set<number>();
    while (randomIndices.size < numberOfCardsToDiscard) {
      randomIndices.add(Math.floor(Math.random() * player.hand.length));
    }

    return Promise.resolve(
      Array.from(randomIndices).map(index => player.hand[index])
    );
  }
}
