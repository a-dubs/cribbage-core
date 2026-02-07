import { parseCard } from '../core/scoring';
import { GameSnapshot, GameAgent, Card } from '../types';
import { logger } from '../utils/logger';

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
    return Promise.resolve(filteredHand[randomIndex] ?? null);
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
      Array.from(randomIndices)
        .map(index => player.hand[index])
        .filter((card): card is Card => card !== undefined)
    );
  }

  async deal(_snapshot: GameSnapshot, _playerId: string): Promise<void> {
    // Bots automatically deal - no need to wait
    return Promise.resolve();
  }

  async cutDeck(
    _snapshot: GameSnapshot,
    _playerId: string,
    maxIndex: number
  ): Promise<number> {
    // Bots randomly cut the deck
    return Promise.resolve(Math.floor(Math.random() * (maxIndex + 1)));
  }

  async selectDealerCard(
    _snapshot: GameSnapshot,
    _playerId: string,
    maxIndex: number
  ): Promise<number> {
    // Bots randomly select a card for dealer selection
    return Promise.resolve(Math.floor(Math.random() * (maxIndex + 1)));
  }

  async acknowledgeReadyForGameStart(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const startTime = Date.now();
    logger.info(
      `[TIMING] RandomAgent.acknowledgeReadyForGameStart START for player ${playerId} at ${startTime}ms`
    );
    // Bots automatically acknowledge - no need to wait
    const endTime = Date.now();
    logger.info(
      `[TIMING] RandomAgent.acknowledgeReadyForGameStart END for player ${playerId} at ${endTime}ms (took ${
        endTime - startTime
      }ms)`
    );
    return Promise.resolve();
  }

  async acknowledgeReadyForCounting(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const startTime = Date.now();
    logger.info(
      `[TIMING] RandomAgent.acknowledgeReadyForCounting START for player ${playerId} at ${startTime}ms`
    );
    // Bots automatically acknowledge - no need to wait
    const endTime = Date.now();
    logger.info(
      `[TIMING] RandomAgent.acknowledgeReadyForCounting END for player ${playerId} at ${endTime}ms (took ${
        endTime - startTime
      }ms)`
    );
    return Promise.resolve();
  }

  async acknowledgeReadyForNextRound(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const startTime = Date.now();
    logger.info(
      `[TIMING] RandomAgent.acknowledgeReadyForNextRound START for player ${playerId} at ${startTime}ms`
    );
    // Bots automatically acknowledge - no need to wait
    const endTime = Date.now();
    logger.info(
      `[TIMING] RandomAgent.acknowledgeReadyForNextRound END for player ${playerId} at ${endTime}ms (took ${
        endTime - startTime
      }ms)`
    );
    return Promise.resolve();
  }
}
