import { parseCard } from '../core/scoring';
import { GameSnapshot, GameAgent, Card } from '../types';

const AGENT_ID = 'random-bot-v1.0';

export class RandomAgent implements GameAgent {
  playerId: string = AGENT_ID;
  human = false;

  makeMove(snapshot: GameSnapshot, playerId: string): Promise<Card | null> {
    const game = snapshot.gameState;
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
    snapshot: GameSnapshot,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const game = snapshot.gameState;
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

  async deal(snapshot: GameSnapshot, playerId: string): Promise<void> {
    // Bots automatically deal - no need to wait
    return Promise.resolve();
  }

  async cutDeck(
    snapshot: GameSnapshot,
    playerId: string,
    maxIndex: number
  ): Promise<number> {
    // Bots randomly cut the deck
    return Promise.resolve(Math.floor(Math.random() * (maxIndex + 1)));
  }

  async acknowledgeReadyForCounting(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const startTime = Date.now();
    console.log(`[TIMING] RandomAgent.acknowledgeReadyForCounting START for player ${playerId} at ${startTime}ms`);
    // Bots automatically acknowledge - no need to wait
    const endTime = Date.now();
    console.log(`[TIMING] RandomAgent.acknowledgeReadyForCounting END for player ${playerId} at ${endTime}ms (took ${endTime - startTime}ms)`);
    return Promise.resolve();
  }

  async acknowledgeReadyForNextRound(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const startTime = Date.now();
    console.log(`[TIMING] RandomAgent.acknowledgeReadyForNextRound START for player ${playerId} at ${startTime}ms`);
    // Bots automatically acknowledge - no need to wait
    const endTime = Date.now();
    console.log(`[TIMING] RandomAgent.acknowledgeReadyForNextRound END for player ${playerId} at ${endTime}ms (took ${endTime - startTime}ms)`);
    return Promise.resolve();
  }
}
