import { CribbageGame } from '../src/core/CribbageGame';
import { AgentDecisionType } from '../src/types';

describe('CribbageGame Helper Methods', () => {
  let game: CribbageGame;

  beforeEach(() => {
    game = new CribbageGame([
      { id: 'player-1', name: 'Player 1' },
      { id: 'player-2', name: 'Player 2' },
    ]);
  });

  describe('addWaitingForPlayer', () => {
    it('should add a player to the waiting list', () => {
      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(0);

      game.addWaitingForPlayer('player-1', AgentDecisionType.DISCARD);

      const updatedState = game.getGameState();
      expect(updatedState.waitingForPlayers.length).toBe(1);
      expect(updatedState.waitingForPlayers[0].playerId).toBe('player-1');
      expect(updatedState.waitingForPlayers[0].decisionType).toBe(
        AgentDecisionType.DISCARD
      );
      expect(updatedState.waitingForPlayers[0].requestTimestamp).toBeInstanceOf(
        Date
      );
    });

    it('should not add duplicate players to waiting list', () => {
      game.addWaitingForPlayer('player-1', AgentDecisionType.DISCARD);
      game.addWaitingForPlayer('player-1', AgentDecisionType.PLAY_CARD);

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(1);
      expect(gameState.waitingForPlayers[0].decisionType).toBe(
        AgentDecisionType.DISCARD
      );
    });

    it('should support multiple different players waiting simultaneously', () => {
      game.addWaitingForPlayer('player-1', AgentDecisionType.DISCARD);
      game.addWaitingForPlayer('player-2', AgentDecisionType.DISCARD);

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(2);
      expect(gameState.waitingForPlayers.map(w => w.playerId)).toEqual([
        'player-1',
        'player-2',
      ]);
    });
  });

  describe('removeWaitingForPlayer', () => {
    it('should remove a player from the waiting list', () => {
      game.addWaitingForPlayer('player-1', AgentDecisionType.DISCARD);
      game.addWaitingForPlayer('player-2', AgentDecisionType.DISCARD);

      expect(game.getGameState().waitingForPlayers.length).toBe(2);

      game.removeWaitingForPlayer('player-1');

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(1);
      expect(gameState.waitingForPlayers[0].playerId).toBe('player-2');
    });

    it('should handle removing non-existent player gracefully', () => {
      game.addWaitingForPlayer('player-1', AgentDecisionType.DISCARD);

      expect(() => {
        game.removeWaitingForPlayer('player-999');
      }).not.toThrow();

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(1);
    });

    it('should handle removing from empty waiting list', () => {
      expect(() => {
        game.removeWaitingForPlayer('player-1');
      }).not.toThrow();

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(0);
    });
  });

  describe('clearAllWaiting', () => {
    it('should clear all waiting players', () => {
      game.addWaitingForPlayer('player-1', AgentDecisionType.DISCARD);
      game.addWaitingForPlayer('player-2', AgentDecisionType.PLAY_CARD);

      expect(game.getGameState().waitingForPlayers.length).toBe(2);

      game.clearAllWaiting();

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(0);
    });

    it('should handle clearing empty waiting list', () => {
      expect(() => {
        game.clearAllWaiting();
      }).not.toThrow();

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(0);
    });
  });

  describe('getRedactedGameState', () => {
    it('should return game state (stub implementation)', () => {
      const redactedState = game.getRedactedGameState('player-1');
      const fullState = game.getGameState();

      // Currently returns full state (stub)
      expect(redactedState).toBe(fullState);
      expect(redactedState.id).toBe(fullState.id);
      expect(redactedState.players.length).toBe(fullState.players.length);
    });

    it('should accept any player ID parameter', () => {
      expect(() => {
        game.getRedactedGameState('player-1');
        game.getRedactedGameState('player-2');
        game.getRedactedGameState('non-existent-player');
      }).not.toThrow();
    });
  });
});

