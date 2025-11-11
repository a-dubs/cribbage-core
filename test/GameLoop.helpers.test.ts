import { GameLoop } from '../src/gameplay/GameLoop';
import { AgentDecisionType, ActionType } from '../src/types';

describe('GameLoop Helper Methods', () => {
  // Test the getWaitingActionType mapping indirectly through requestDecision
  // Since requestDecision is private, we test it by checking the GameState
  describe('requestDecision integration', () => {
    it('should add players to waiting list when requesting decisions', () => {
      const gameLoop = new GameLoop([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Use reflection to access private method for testing
      // In a real scenario, we'd test through public API in Phase 2
      const requestDecision = (gameLoop as any).requestDecision.bind(gameLoop);

      const gameState = gameLoop.cribbageGame.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(0);

      // Request different decision types
      requestDecision('player-1', AgentDecisionType.DISCARD);
      requestDecision('player-2', AgentDecisionType.PLAY_CARD);

      const updatedState = gameLoop.cribbageGame.getGameState();
      expect(updatedState.waitingForPlayers.length).toBe(2);
      expect(updatedState.waitingForPlayers[0].playerId).toBe('player-1');
      expect(updatedState.waitingForPlayers[0].decisionType).toBe(
        AgentDecisionType.DISCARD
      );
      expect(updatedState.waitingForPlayers[1].playerId).toBe('player-2');
      expect(updatedState.waitingForPlayers[1].decisionType).toBe(
        AgentDecisionType.PLAY_CARD
      );
    });
  });

});

