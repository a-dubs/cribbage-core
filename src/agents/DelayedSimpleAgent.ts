import { GameSnapshot, Card } from '../types';
import { HeuristicSimpleAgent } from './HeuristicSimpleAgent';

/**
 * Base class for HeuristicSimpleAgent with configurable delays to simulate human response times.
 * All decision methods are wrapped with a delay before returning.
 * 
 * Uses HeuristicSimpleAgent as base (fast) rather than SimpleAgent (slow exhaustive simulation).
 */
export abstract class DelayedSimpleAgent extends HeuristicSimpleAgent {
  /**
   * Get the delay in milliseconds for this decision.
   * Subclasses should override this to provide their delay strategy.
   */
  protected abstract getDelay(): number;

  /**
   * Helper to add delay before resolving a promise
   */
  private async delay<T>(value: T): Promise<T> {
    const delayMs = this.getDelay();
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return value;
  }

  async makeMove(snapshot: GameSnapshot, playerId: string): Promise<Card | null> {
    const result = await super.makeMove(snapshot, playerId);
    return this.delay(result);
  }

  async discard(
    snapshot: GameSnapshot,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const result = await super.discard(snapshot, playerId, numberOfCardsToDiscard);
    return this.delay(result);
  }

  async deal(snapshot: GameSnapshot, playerId: string): Promise<void> {
    await super.deal(snapshot, playerId);
    await this.delay(undefined);
  }

  async cutDeck(
    snapshot: GameSnapshot,
    playerId: string,
    maxIndex: number
  ): Promise<number> {
    const result = await super.cutDeck(snapshot, playerId, maxIndex);
    return this.delay(result);
  }

  async acknowledgeReadyForCounting(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    await super.acknowledgeReadyForCounting(snapshot, playerId);
    await this.delay(undefined);
  }

  async acknowledgeReadyForNextRound(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    await super.acknowledgeReadyForNextRound(snapshot, playerId);
    await this.delay(undefined);
  }
}

/**
 * SimpleAgent with random delay between 250ms and 1000ms
 */
export class RandomDelaySimpleAgent extends DelayedSimpleAgent {
  playerId: string = 'random-delay-simple-bot-v1.0';

  protected getDelay(): number {
    // Random delay between 250ms and 1000ms
    return 250 + Math.random() * 750;
  }
}

/**
 * SimpleAgent with fixed 500ms delay
 */
export class Fixed500msSimpleAgent extends DelayedSimpleAgent {
  playerId: string = 'fixed-500ms-simple-bot-v1.0';

  protected getDelay(): number {
    return 500;
  }
}

/**
 * SimpleAgent with fixed 200ms delay
 */
export class Fixed200msSimpleAgent extends DelayedSimpleAgent {
  playerId: string = 'fixed-200ms-simple-bot-v1.0';

  protected getDelay(): number {
    return 200;
  }
}

