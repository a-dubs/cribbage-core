import { Game, GameAgent, Card } from '../types';

export class RandomAgent implements GameAgent {
  id: string;
  human = false;

  constructor(id: string) {
    this.id = id;
  }

  makeMove(game: Game, playerId: string): Promise<Card> {
    const player = game.players.find(p => p.id === playerId);
    if (!player || player.hand.length === 0) {
      throw new Error('No valid cards to play.');
    }

    const randomIndex = Math.floor(Math.random() * player.hand.length);
    return Promise.resolve(player.hand[randomIndex]);
  }

  discard(game: Game, playerId: string): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player || player.hand.length < 2) {
      throw new Error('Not enough cards to discard.');
    }

    const randomIndices = new Set<number>();
    while (randomIndices.size < 2) {
      randomIndices.add(Math.floor(Math.random() * player.hand.length));
    }

    return Promise.resolve(
      Array.from(randomIndices).map(index => player.hand[index])
    );
  }
}
