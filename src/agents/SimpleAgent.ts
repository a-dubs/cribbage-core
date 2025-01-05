import { CribbageGame } from '../core/CribbageGame';
import { scoreHand } from '../core/scoring';
import { Game, Card } from '../types';
import { RandomAgent } from './RandomAgent';

export class SimpleAgent extends RandomAgent {
  id: string;
  human = false;
  cribbageGame: CribbageGame = new CribbageGame([]);

  constructor(id: string) {
    super(id);
    this.id = id;
  }

  private getBestHand(hand: Card[]): Card[] {
    // score all possible hands with all possible discards with any possible remaining cut card
    // choose the discard that results in the highest score
    let bestHand = hand.slice(0, 4);
    let bestScore = 0;

    const possibleTurnCards = this.cribbageGame
      .generateDeck()
      .filter(card => !hand.includes(card));
    for (const discard1 of hand) {
      for (const discard2 of hand) {
        if (discard1 === discard2) {
          continue;
        }
        const scores: number[] = [];
        for (const turnCard of possibleTurnCards) {
          const score = scoreHand(
            hand.filter(card => card !== discard1 && card !== discard2),
            turnCard,
            false
          );
          scores.push(score);
        }
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avgScore > bestScore) {
          bestScore = avgScore;
          bestHand = hand.filter(
            card => card !== discard1 && card !== discard2
          );
        }
      }
    }
    // console.log(`Full hand: ${hand.join(', ')}`);
    // console.log(`Best hand: ${bestHand.join(', ')}`);
    return bestHand;
  }

  discard(game: Game, playerId: string): Promise<Card[]> {
    // score all possible hands with all possible discards with any possible remaining cut card
    // choose the discard that results in the highest score

    const player = game.players.find(p => p.id === playerId);
    if (!player || player.hand.length < 2) {
      throw new Error('Not enough cards to discard.');
    }

    const bestHand = this.getBestHand(player.hand);
    const discards = player.hand.filter(card => !bestHand.includes(card));
    return Promise.resolve(discards);

    // return Promise.resolve(
    //   Array.from(randomIndices).map(index => player.hand[index])
    // );
  }
}
