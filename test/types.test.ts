import {
  ActionType,
  AgentDecisionType,
  GameState,
  WaitingForPlayer,
} from '../src/types';
import { CribbageGame } from '../src/core/CribbageGame';

describe('Type System Tests', () => {
  describe('ActionType enum', () => {
    it('should include WAITING_FOR_* action types', () => {
      expect(ActionType.WAITING_FOR_DEAL).toBe('WAITING_FOR_DEAL');
      expect(ActionType.WAITING_FOR_DISCARD).toBe('WAITING_FOR_DISCARD');
      expect(ActionType.WAITING_FOR_PLAY_CARD).toBe('WAITING_FOR_PLAY_CARD');
      expect(ActionType.WAITING_FOR_CONTINUE).toBe('WAITING_FOR_CONTINUE');
    });

    it('should maintain backward compatibility with existing action types', () => {
      expect(ActionType.DEAL).toBe('DEAL');
      expect(ActionType.DISCARD).toBe('DISCARD');
      expect(ActionType.PLAY_CARD).toBe('PLAY_CARD');
      expect(ActionType.WIN).toBe('WIN');
    });
  });

  describe('WaitingForPlayer interface', () => {
    it('should create a valid WaitingForPlayer object', () => {
      const waiting: WaitingForPlayer = {
        playerId: 'player-1',
        decisionType: AgentDecisionType.DISCARD,
        requestTimestamp: new Date(),
      };

      expect(waiting.playerId).toBe('player-1');
      expect(waiting.decisionType).toBe(AgentDecisionType.DISCARD);
      expect(waiting.requestTimestamp).toBeInstanceOf(Date);
    });
  });

  describe('GameState interface', () => {
    it('should include waitingForPlayers array in new game', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers).toBeDefined();
      expect(Array.isArray(gameState.waitingForPlayers)).toBe(true);
      expect(gameState.waitingForPlayers.length).toBe(0);
    });

    it('should reset waitingForPlayers in startRound', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Manually add a waiting player (simulating what will happen later)
      const gameState = game.getGameState();
      (gameState as any).waitingForPlayers.push({
        playerId: 'player-1',
        decisionType: AgentDecisionType.DISCARD,
        requestTimestamp: new Date(),
      });

      expect(gameState.waitingForPlayers.length).toBe(1);

      // Start a new round
      game.startRound();

      const newGameState = game.getGameState();
      expect(newGameState.waitingForPlayers.length).toBe(0);
    });
  });
});

