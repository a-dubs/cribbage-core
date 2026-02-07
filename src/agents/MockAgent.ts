import { GameAgent, Card, GameSnapshot } from '../types';

/**
 * MockAgent provides deterministic behavior for testing.
 * All decisions are pre-configured and returned in order.
 */
export class MockAgent implements GameAgent {
  playerId: string;
  human = false;

  // Pre-configured responses
  private playCardResponses: Array<Card | null> = [];
  private discardResponses: Card[][] = [];
  private cutDeckResponses: number[] = [];
  private selectDealerCardResponses: number[] = [];
  private acknowledgeResponses: boolean[] = [];

  // Counters for tracking which response to return
  private playCardIndex = 0;
  private discardIndex = 0;
  private cutDeckIndex = 0;
  private selectDealerCardIndex = 0;
  private acknowledgeIndex = 0;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  /**
   * Configure play card responses (in order)
   */
  public setPlayCardResponses(responses: Array<Card | null>): void {
    this.playCardResponses = [...responses];
    this.playCardIndex = 0;
  }

  /**
   * Configure discard responses (in order)
   */
  public setDiscardResponses(responses: Card[][]): void {
    this.discardResponses = responses.map(r => [...r]);
    this.discardIndex = 0;
  }

  /**
   * Configure cut deck responses (in order)
   */
  public setCutDeckResponses(responses: number[]): void {
    this.cutDeckResponses = [...responses];
    this.cutDeckIndex = 0;
  }

  /**
   * Configure select dealer card responses (in order)
   */
  public setSelectDealerCardResponses(responses: number[]): void {
    this.selectDealerCardResponses = [...responses];
    this.selectDealerCardIndex = 0;
  }

  /**
   * Configure acknowledgment responses (in order)
   */
  public setAcknowledgeResponses(responses: boolean[]): void {
    this.acknowledgeResponses = [...responses];
    this.acknowledgeIndex = 0;
  }

  /**
   * Reset all response counters (useful for reusing agent in multiple games)
   */
  public reset(): void {
    this.playCardIndex = 0;
    this.discardIndex = 0;
    this.cutDeckIndex = 0;
    this.selectDealerCardIndex = 0;
    this.acknowledgeIndex = 0;
  }

  async makeMove(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<Card | null> {
    if (this.playCardIndex >= this.playCardResponses.length) {
      throw new Error(
        `MockAgent: No more play card responses configured for player ${playerId}`
      );
    }
    const response = this.playCardResponses[this.playCardIndex];
    if (response === undefined) {
      throw new Error(
        `MockAgent: Missing play card response at index ${this.playCardIndex} for player ${playerId}`
      );
    }
    this.playCardIndex++;
    return Promise.resolve(response);
  }

  async discard(
    _snapshot: GameSnapshot,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    if (this.discardIndex >= this.discardResponses.length) {
      throw new Error(
        `MockAgent: No more discard responses configured for player ${playerId}`
      );
    }
    const response = this.discardResponses[this.discardIndex];
    if (response === undefined) {
      throw new Error(
        `MockAgent: Missing discard response at index ${this.discardIndex} for player ${playerId}`
      );
    }
    this.discardIndex++;
    if (response.length !== numberOfCardsToDiscard) {
      throw new Error(
        `MockAgent: Discard response has ${response.length} cards but ${numberOfCardsToDiscard} expected`
      );
    }
    return Promise.resolve([...response]);
  }

  async deal(_snapshot: GameSnapshot, _playerId: string): Promise<void> {
    // Deal is always allowed (no response needed)
    return Promise.resolve();
  }

  async cutDeck(
    _snapshot: GameSnapshot,
    playerId: string,
    maxIndex: number
  ): Promise<number> {
    if (this.cutDeckIndex >= this.cutDeckResponses.length) {
      throw new Error(
        `MockAgent: No more cut deck responses configured for player ${playerId}`
      );
    }
    const response = this.cutDeckResponses[this.cutDeckIndex];
    if (response === undefined) {
      throw new Error(
        `MockAgent: Missing cut deck response at index ${this.cutDeckIndex} for player ${playerId}`
      );
    }
    this.cutDeckIndex++;
    if (response < 0 || response > maxIndex) {
      throw new Error(
        `MockAgent: Cut deck response ${response} is out of range [0, ${maxIndex}]`
      );
    }
    return Promise.resolve(response);
  }

  async selectDealerCard(
    _snapshot: GameSnapshot,
    playerId: string,
    maxIndex: number
  ): Promise<number> {
    if (this.selectDealerCardIndex >= this.selectDealerCardResponses.length) {
      throw new Error(
        `MockAgent: No more select dealer card responses configured for player ${playerId}`
      );
    }
    const response = this.selectDealerCardResponses[this.selectDealerCardIndex];
    if (response === undefined) {
      throw new Error(
        `MockAgent: Missing select dealer card response at index ${this.selectDealerCardIndex} for player ${playerId}`
      );
    }
    this.selectDealerCardIndex++;
    if (response < 0 || response > maxIndex) {
      throw new Error(
        `MockAgent: Select dealer card response ${response} is out of range [0, ${maxIndex}]`
      );
    }
    return Promise.resolve(response);
  }

  async acknowledgeReadyForGameStart(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    if (this.acknowledgeIndex >= this.acknowledgeResponses.length) {
      // Default to acknowledging if no response configured
      return Promise.resolve();
    }
    const shouldAcknowledge = this.acknowledgeResponses[this.acknowledgeIndex];
    this.acknowledgeIndex++;
    if (!shouldAcknowledge) {
      throw new Error(
        `MockAgent: Player ${playerId} configured to not acknowledge ready for game start`
      );
    }
    return Promise.resolve();
  }

  async acknowledgeReadyForCounting(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    if (this.acknowledgeIndex >= this.acknowledgeResponses.length) {
      // Default to acknowledging if no response configured
      return Promise.resolve();
    }
    const shouldAcknowledge = this.acknowledgeResponses[this.acknowledgeIndex];
    this.acknowledgeIndex++;
    if (!shouldAcknowledge) {
      throw new Error(
        `MockAgent: Player ${playerId} configured to not acknowledge ready for counting`
      );
    }
    return Promise.resolve();
  }

  async acknowledgeReadyForNextRound(
    _snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    if (this.acknowledgeIndex >= this.acknowledgeResponses.length) {
      // Default to acknowledging if no response configured
      return Promise.resolve();
    }
    const shouldAcknowledge = this.acknowledgeResponses[this.acknowledgeIndex];
    this.acknowledgeIndex++;
    if (!shouldAcknowledge) {
      throw new Error(
        `MockAgent: Player ${playerId} configured to not acknowledge ready for next round`
      );
    }
    return Promise.resolve();
  }
}
