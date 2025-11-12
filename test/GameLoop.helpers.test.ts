import { GameLoop } from '../src/gameplay/GameLoop';
import { AgentDecisionType } from '../src/types';

describe('GameLoop Helper Methods', () => {
  // Test requestDecision indirectly through pendingDecisionRequests
  // Since requestDecision is private, we test it by checking pendingDecisionRequests
  describe('requestDecision integration', () => {
    it('should create decision requests when requesting decisions', () => {
      const gameLoop = new GameLoop([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Use reflection to access private method for testing
      const requestDecision = (gameLoop as any).requestDecision.bind(gameLoop);

      const pendingRequests = gameLoop.cribbageGame.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(0);

      // Request different decision types
      const request1 = requestDecision('player-1', AgentDecisionType.DISCARD, {
        hand: [],
        numberOfCardsToDiscard: 2,
      });
      const request2 = requestDecision('player-2', AgentDecisionType.PLAY_CARD, {
        peggingHand: [],
        peggingStack: [],
        playedCards: [],
        peggingTotal: 0,
      });

      const updatedPendingRequests = gameLoop.cribbageGame.getPendingDecisionRequests();
      expect(updatedPendingRequests.length).toBe(2);
      expect(updatedPendingRequests.find(r => r.playerId === 'player-1')?.decisionType).toBe(
        AgentDecisionType.DISCARD
      );
      expect(updatedPendingRequests.find(r => r.playerId === 'player-2')?.decisionType).toBe(
        AgentDecisionType.PLAY_CARD
      );
      expect(updatedPendingRequests.find(r => r.requestId === request1.requestId)).toBeDefined();
      expect(updatedPendingRequests.find(r => r.requestId === request2.requestId)).toBeDefined();
    });
  });

});

