import { parseCard } from '../core/scoring';
import {
  GameState,
  GameAgent,
  Card,
  DecisionRequest,
  DecisionResponse,
} from '../types';

const AGENT_ID = 'random-bot-v1.0';

export class RandomAgent implements GameAgent {
  playerId: string = AGENT_ID;
  human = false;
  // Optional; bots can override to pick a cut index
  cutDeck?: (
    game: GameState,
    playerId: string,
    maxIndex: number
  ) => Promise<number>;

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

  async waitForContinue(
    game: GameState,
    playerId: string,
    continueDescription: string
  ): Promise<void> {
    // Bots automatically continue - no need to wait
    // This simulates the continue request flow for testing
    return Promise.resolve();
  }

  async respondToDecision(
    request: DecisionRequest,
    game: GameState
  ): Promise<DecisionResponse | null> {
    const { playerId, type, requestId } = request;
    switch (type) {
      case 'PLAY_CARD': {
        const card = await this.makeMove(game, playerId);
        return {
          requestId,
          playerId,
          type: 'PLAY_CARD',
          payload: card,
        };
      }
      case 'DISCARD': {
        const num =
          (request.minSelections && request.maxSelections === request.minSelections
            ? request.minSelections
            : 2) ?? 2;
        const cards = await this.discard(game, playerId, num);
        return {
          requestId,
          playerId,
          type: 'DISCARD',
          payload: { cards },
        };
      }
      case 'CONTINUE': {
        if (this.waitForContinue) {
          await this.waitForContinue(
            game,
            playerId,
            (request.payload as { description?: string } | undefined)
              ?.description || ''
          );
        }
        return {
          requestId,
          playerId,
          type: 'CONTINUE',
        };
      }
      case 'CUT_DECK': {
        const maxIndex =
          (request.payload as { maxIndex?: number } | undefined)?.maxIndex ?? 0;
        let index: number;
        if (this.cutDeck) {
          index = await this.cutDeck(game, playerId, maxIndex);
        } else {
          index = Math.max(
            0,
            Math.min(maxIndex, Math.floor(Math.random() * (maxIndex + 1)))
          );
        }
        return {
          requestId,
          playerId,
          type: 'CUT_DECK',
          payload: { index },
        };
      }
      default:
        return null;
    }
  }
}
