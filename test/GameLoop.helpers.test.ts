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

  describe('getWaitingActionType mapping', () => {
    it('should map AgentDecisionType to correct ActionType', () => {
      const gameLoop = new GameLoop([
        { id: 'player-1', name: 'Player 1' },
      ]);

      const getWaitingActionType = (gameLoop as any).getWaitingActionType.bind(
        gameLoop
      );

      expect(getWaitingActionType(AgentDecisionType.DEAL)).toBe(
        ActionType.WAITING_FOR_DEAL
      );
      expect(getWaitingActionType(AgentDecisionType.DISCARD)).toBe(
        ActionType.WAITING_FOR_DISCARD
      );
      expect(getWaitingActionType(AgentDecisionType.PLAY_CARD)).toBe(
        ActionType.WAITING_FOR_PLAY_CARD
      );
      expect(getWaitingActionType(AgentDecisionType.CONTINUE)).toBe(
        ActionType.WAITING_FOR_CONTINUE
      );
    });

    it('should throw error for unknown decision type', () => {
      const gameLoop = new GameLoop([
        { id: 'player-1', name: 'Player 1' },
      ]);

      const getWaitingActionType = (gameLoop as any).getWaitingActionType.bind(
        gameLoop
      );

      // TypeScript won't allow this, but test runtime behavior
      expect(() => {
        getWaitingActionType('UNKNOWN_DECISION_TYPE' as AgentDecisionType);
      }).toThrow('Unknown decision type');
    });
  });
});

