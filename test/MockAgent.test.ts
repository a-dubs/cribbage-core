import { MockAgent } from '../src/agents/MockAgent';
import { Card, GameSnapshot, Phase, ActionType } from '../src/types';

describe('MockAgent', () => {
  describe('Creation', () => {
    it('should create agent with correct playerId', () => {
      const agent = new MockAgent('player-1');
      expect(agent.playerId).toBe('player-1');
      expect(agent.human).toBe(false);
    });
  });

  describe('Play Card Responses', () => {
    it('should return configured play card responses in order', async () => {
      const agent = new MockAgent('player-1');
      const responses: Array<Card | null> = [
        'ACE_SPADES',
        'TWO_HEARTS',
        null, // Go
        'THREE_CLUBS',
      ];
      agent.setPlayCardResponses(responses);

      const snapshot = createMockSnapshot();

      expect(await agent.makeMove(snapshot, 'player-1')).toBe('ACE_SPADES');
      expect(await agent.makeMove(snapshot, 'player-1')).toBe('TWO_HEARTS');
      expect(await agent.makeMove(snapshot, 'player-1')).toBeNull();
      expect(await agent.makeMove(snapshot, 'player-1')).toBe('THREE_CLUBS');
    });

    it('should throw error when play card responses run out', async () => {
      const agent = new MockAgent('player-1');
      agent.setPlayCardResponses(['ACE_SPADES']);

      const snapshot = createMockSnapshot();

      await agent.makeMove(snapshot, 'player-1');
      await expect(agent.makeMove(snapshot, 'player-1')).rejects.toThrow(
        'No more play card responses configured'
      );
    });
  });

  describe('Discard Responses', () => {
    it('should return configured discard responses in order', async () => {
      const agent = new MockAgent('player-1');
      const responses: Card[][] = [
        ['ACE_SPADES', 'TWO_HEARTS'],
        ['THREE_CLUBS', 'FOUR_DIAMONDS'],
      ];
      agent.setDiscardResponses(responses);

      const snapshot = createMockSnapshot();

      const discard1 = await agent.discard(snapshot, 'player-1', 2);
      expect(discard1).toEqual(['ACE_SPADES', 'TWO_HEARTS']);

      const discard2 = await agent.discard(snapshot, 'player-1', 2);
      expect(discard2).toEqual(['THREE_CLUBS', 'FOUR_DIAMONDS']);
    });

    it('should validate discard response card count', async () => {
      const agent = new MockAgent('player-1');
      agent.setDiscardResponses([['ACE_SPADES']]); // Only 1 card

      const snapshot = createMockSnapshot();

      await expect(agent.discard(snapshot, 'player-1', 2)).rejects.toThrow(
        'Discard response has 1 cards but 2 expected'
      );
    });

    it('should throw error when discard responses run out', async () => {
      const agent = new MockAgent('player-1');
      agent.setDiscardResponses([['ACE_SPADES', 'TWO_HEARTS']]);

      const snapshot = createMockSnapshot();

      await agent.discard(snapshot, 'player-1', 2);
      await expect(agent.discard(snapshot, 'player-1', 2)).rejects.toThrow(
        'No more discard responses configured'
      );
    });

    it('should return a copy of discard cards (not reference)', async () => {
      const agent = new MockAgent('player-1');
      const originalCards: Card[] = ['ACE_SPADES', 'TWO_HEARTS'];
      agent.setDiscardResponses([originalCards]);

      const snapshot = createMockSnapshot();
      const result = await agent.discard(snapshot, 'player-1', 2);

      // Modifying result should not affect original
      result.push('THREE_CLUBS');
      expect(originalCards.length).toBe(2);
    });
  });

  describe('Cut Deck Responses', () => {
    it('should return configured cut deck responses in order', async () => {
      const agent = new MockAgent('player-1');
      agent.setCutDeckResponses([5, 10, 20]);

      const snapshot = createMockSnapshot();

      expect(await agent.cutDeck(snapshot, 'player-1', 51)).toBe(5);
      expect(await agent.cutDeck(snapshot, 'player-1', 51)).toBe(10);
      expect(await agent.cutDeck(snapshot, 'player-1', 51)).toBe(20);
    });

    it('should validate cut deck response is within bounds', async () => {
      const agent = new MockAgent('player-1');
      agent.setCutDeckResponses([60]); // Out of bounds for maxIndex 51

      const snapshot = createMockSnapshot();

      await expect(agent.cutDeck(snapshot, 'player-1', 51)).rejects.toThrow(
        'Cut deck response 60 is out of range [0, 51]'
      );
    });

    it('should throw error when cut deck responses run out', async () => {
      const agent = new MockAgent('player-1');
      agent.setCutDeckResponses([5]);

      const snapshot = createMockSnapshot();

      await agent.cutDeck(snapshot, 'player-1', 51);
      await expect(agent.cutDeck(snapshot, 'player-1', 51)).rejects.toThrow(
        'No more cut deck responses configured'
      );
    });
  });

  describe('Select Dealer Card Responses', () => {
    it('should return configured select dealer card responses in order', async () => {
      const agent = new MockAgent('player-1');
      agent.setSelectDealerCardResponses([0, 10, 25]);

      const snapshot = createMockSnapshot();

      expect(await agent.selectDealerCard(snapshot, 'player-1', 51)).toBe(0);
      expect(await agent.selectDealerCard(snapshot, 'player-1', 51)).toBe(10);
      expect(await agent.selectDealerCard(snapshot, 'player-1', 51)).toBe(25);
    });

    it('should validate select dealer card response is within bounds', async () => {
      const agent = new MockAgent('player-1');
      agent.setSelectDealerCardResponses([60]); // Out of bounds

      const snapshot = createMockSnapshot();

      await expect(
        agent.selectDealerCard(snapshot, 'player-1', 51)
      ).rejects.toThrow('Select dealer card response 60 is out of range [0, 51]');
    });

    it('should throw error when select dealer card responses run out', async () => {
      const agent = new MockAgent('player-1');
      agent.setSelectDealerCardResponses([0]);

      const snapshot = createMockSnapshot();

      await agent.selectDealerCard(snapshot, 'player-1', 51);
      await expect(
        agent.selectDealerCard(snapshot, 'player-1', 51)
      ).rejects.toThrow('No more select dealer card responses configured');
    });
  });

  describe('Acknowledgment Responses', () => {
    it('should acknowledge when configured to do so', async () => {
      const agent = new MockAgent('player-1');
      agent.setAcknowledgeResponses([true, true]);

      const snapshot = createMockSnapshot();

      await expect(
        agent.acknowledgeReadyForGameStart(snapshot, 'player-1')
      ).resolves.toBeUndefined();
      await expect(
        agent.acknowledgeReadyForCounting(snapshot, 'player-1')
      ).resolves.toBeUndefined();
    });

    it('should throw error when configured not to acknowledge', async () => {
      const agent = new MockAgent('player-1');
      agent.setAcknowledgeResponses([false]);

      const snapshot = createMockSnapshot();

      await expect(
        agent.acknowledgeReadyForGameStart(snapshot, 'player-1')
      ).rejects.toThrow('configured to not acknowledge ready for game start');
    });

    it('should default to acknowledging if no response configured', async () => {
      const agent = new MockAgent('player-1');
      // Don't set any acknowledge responses

      const snapshot = createMockSnapshot();

      await expect(
        agent.acknowledgeReadyForGameStart(snapshot, 'player-1')
      ).resolves.toBeUndefined();
      await expect(
        agent.acknowledgeReadyForCounting(snapshot, 'player-1')
      ).resolves.toBeUndefined();
      await expect(
        agent.acknowledgeReadyForNextRound(snapshot, 'player-1')
      ).resolves.toBeUndefined();
    });

    it('should use same acknowledge index for all acknowledgment types', async () => {
      const agent = new MockAgent('player-1');
      agent.setAcknowledgeResponses([true, false, true]);

      const snapshot = createMockSnapshot();

      // First acknowledgment uses first response (true)
      await expect(
        agent.acknowledgeReadyForGameStart(snapshot, 'player-1')
      ).resolves.toBeUndefined();

      // Second acknowledgment uses second response (false)
      await expect(
        agent.acknowledgeReadyForCounting(snapshot, 'player-1')
      ).rejects.toThrow('configured to not acknowledge ready for counting');

      // Third acknowledgment uses third response (true)
      await expect(
        agent.acknowledgeReadyForNextRound(snapshot, 'player-1')
      ).resolves.toBeUndefined();
    });
  });

  describe('Deal', () => {
    it('should always resolve deal without error', async () => {
      const agent = new MockAgent('player-1');
      const snapshot = createMockSnapshot();

      await expect(agent.deal(snapshot, 'player-1')).resolves.toBeUndefined();
    });
  });

  describe('Reset', () => {
    it('should reset all response counters', async () => {
      const agent = new MockAgent('player-1');
      agent.setPlayCardResponses(['ACE_SPADES', 'TWO_HEARTS']);
      agent.setDiscardResponses([['ACE_SPADES', 'TWO_HEARTS']]);
      agent.setCutDeckResponses([5]);
      agent.setSelectDealerCardResponses([0]);
      agent.setAcknowledgeResponses([true]);

      const snapshot = createMockSnapshot();

      // Use some responses
      await agent.makeMove(snapshot, 'player-1');
      await agent.discard(snapshot, 'player-1', 2);
      await agent.cutDeck(snapshot, 'player-1', 51);
      await agent.selectDealerCard(snapshot, 'player-1', 51);
      await agent.acknowledgeReadyForGameStart(snapshot, 'player-1');

      // Reset
      agent.reset();

      // Should be able to use responses again from the beginning
      expect(await agent.makeMove(snapshot, 'player-1')).toBe('ACE_SPADES');
      expect(await agent.discard(snapshot, 'player-1', 2)).toEqual([
        'ACE_SPADES',
        'TWO_HEARTS',
      ]);
      expect(await agent.cutDeck(snapshot, 'player-1', 51)).toBe(5);
      expect(await agent.selectDealerCard(snapshot, 'player-1', 51)).toBe(0);
      await expect(
        agent.acknowledgeReadyForGameStart(snapshot, 'player-1')
      ).resolves.toBeUndefined();
    });
  });

  describe('Response Configuration', () => {
    it('should reset index when setting new responses', async () => {
      const agent = new MockAgent('player-1');
      agent.setPlayCardResponses(['ACE_SPADES']);
      const snapshot = createMockSnapshot();

      await agent.makeMove(snapshot, 'player-1');

      // Set new responses - should reset index
      agent.setPlayCardResponses(['TWO_HEARTS', 'THREE_CLUBS']);

      // Should start from beginning of new responses
      expect(await agent.makeMove(snapshot, 'player-1')).toBe('TWO_HEARTS');
      expect(await agent.makeMove(snapshot, 'player-1')).toBe('THREE_CLUBS');
    });

    it('should create copies of arrays when setting responses', () => {
      const agent = new MockAgent('player-1');
      const originalDiscards: Card[][] = [['ACE_SPADES', 'TWO_HEARTS']];
      agent.setDiscardResponses(originalDiscards);

      // Modifying original should not affect agent's copy
      originalDiscards[0].push('THREE_CLUBS');
      originalDiscards.push(['FOUR_DIAMONDS']);

      // Agent should still have original configuration
      const snapshot = createMockSnapshot();
      return expect(agent.discard(snapshot, 'player-1', 2)).resolves.toEqual([
        'ACE_SPADES',
        'TWO_HEARTS',
      ]);
    });
  });
});

/**
 * Helper to create a minimal mock GameSnapshot for testing
 */
function createMockSnapshot(): GameSnapshot {
  return {
    gameState: {
      id: 'test-game',
      players: [
        {
          id: 'player-1',
          name: 'Player 1',
          hand: [],
          peggingHand: [],
          playedCards: [],
          score: 0,
          isDealer: false,
          pegPositions: { current: 0, previous: 0 },
        },
      ],
      deck: [],
      crib: [],
      turnCard: null,
      currentPhase: Phase.DEALER_SELECTION,
      peggingStack: [],
      peggingGoPlayers: [],
      peggingLastCardPlayer: null,
      playedCards: [],
      peggingTotal: 0,
      snapshotId: 0,
      roundNumber: 0,
    },
    gameEvent: {
      gameId: 'test-game',
      snapshotId: 0,
      phase: Phase.DEALER_SELECTION,
      actionType: ActionType.BEGIN_PHASE,
      playerId: null,
      cards: null,
      scoreChange: 0,
      timestamp: new Date(),
    },
    pendingDecisionRequests: [],
  };
}
