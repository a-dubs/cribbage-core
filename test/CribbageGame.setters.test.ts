import { CribbageGame } from '../src/core/CribbageGame';
import { ActionType, Phase, Card } from '../src/types';

describe('CribbageGame Setter Methods', () => {
  let game: CribbageGame;

  beforeEach(() => {
    game = new CribbageGame([
      { id: 'player-1', name: 'Player 1' },
      { id: 'player-2', name: 'Player 2' },
    ]);
  });

  describe('addScoreToPlayer', () => {
    it('should add score to a player and log event', () => {
      const initialScore = game.getPlayer('player-1').score;
      const initialHistoryLength = game.getGameSnapshotHistory().length;

      game.addScoreToPlayer('player-1', 5, ActionType.SCORE_HAND, null);

      const player = game.getPlayer('player-1');
      expect(player.score).toBe(initialScore + 5);

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(initialHistoryLength + 1);
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.actionType).toBe(ActionType.SCORE_HAND);
      expect(lastEvent.playerId).toBe('player-1');
      expect(lastEvent.scoreChange).toBe(5);
    });

    it('should include cards in event when provided', () => {
      const cards: Card[] = ['ACE_SPADES', 'TWO_SPADES'];
      game.addScoreToPlayer('player-1', 10, ActionType.SCORE_HAND, cards);

      const history = game.getGameSnapshotHistory();
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.cards).toEqual(cards);
    });

    it('should handle multiple score additions', () => {
      game.addScoreToPlayer('player-1', 2, ActionType.SCORE_HEELS);
      game.addScoreToPlayer('player-1', 3, ActionType.SCORE_HAND);

      const player = game.getPlayer('player-1');
      expect(player.score).toBe(5); // 0 + 2 + 3

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(2);
      expect(history[0].gameEvent.scoreChange).toBe(2);
      expect(history[1].gameEvent.scoreChange).toBe(3);
    });

    it('should throw error for non-existent player', () => {
      expect(() => {
        game.addScoreToPlayer('non-existent', 5, ActionType.SCORE_HAND);
      }).toThrow('Player non-existent not found');
    });

    it('should handle zero points', () => {
      game.addScoreToPlayer('player-1', 0, ActionType.GO);

      const history = game.getGameSnapshotHistory();
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.scoreChange).toBe(0);
    });

    it('should handle negative points (if needed)', () => {
      game.addScoreToPlayer('player-1', 5, ActionType.SCORE_HAND);
      game.addScoreToPlayer('player-1', -2, ActionType.SCORE_HAND);

      const player = game.getPlayer('player-1');
      expect(player.score).toBe(3); // 5 - 2
    });
  });

  describe('setPhase', () => {
    it('should change phase and log event', () => {
      const initialPhase = game.getGameState().currentPhase;
      // Games now start in DEALER_SELECTION phase
      expect(initialPhase).toBe(Phase.DEALER_SELECTION);

      const initialHistoryLength = game.getGameSnapshotHistory().length;

      game.setPhase(Phase.DISCARDING, ActionType.BEGIN_PHASE);

      const gameState = game.getGameState();
      expect(gameState.currentPhase).toBe(Phase.DISCARDING);

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(initialHistoryLength + 1);
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.actionType).toBe(ActionType.BEGIN_PHASE);
      expect(lastEvent.phase).toBe(Phase.DISCARDING);
      expect(lastEvent.playerId).toBeNull();
      expect(lastEvent.scoreChange).toBe(0);
    });

    it('should handle multiple phase transitions', () => {
      game.setPhase(Phase.DISCARDING, ActionType.BEGIN_PHASE);
      game.setPhase(Phase.CUTTING, ActionType.BEGIN_PHASE);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);

      const gameState = game.getGameState();
      expect(gameState.currentPhase).toBe(Phase.PEGGING);

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(3);
      expect(history[0].gameEvent.phase).toBe(Phase.DISCARDING);
      expect(history[1].gameEvent.phase).toBe(Phase.CUTTING);
      expect(history[2].gameEvent.phase).toBe(Phase.PEGGING);
    });

    it('should allow setting same phase multiple times', () => {
      game.setPhase(Phase.DISCARDING, ActionType.BEGIN_PHASE);
      game.setPhase(Phase.DISCARDING, ActionType.BEGIN_PHASE);

      const gameState = game.getGameState();
      expect(gameState.currentPhase).toBe(Phase.DISCARDING);

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(2);
    });
  });

  describe('setter methods integration', () => {
    it('should work together correctly', () => {
      // Set phase
      game.setPhase(Phase.DISCARDING, ActionType.BEGIN_PHASE);

      // Add score
      game.addScoreToPlayer('player-1', 2, ActionType.SCORE_HEELS);

      // Set phase again
      game.setPhase(Phase.CUTTING, ActionType.BEGIN_PHASE);

      const gameState = game.getGameState();
      expect(gameState.currentPhase).toBe(Phase.CUTTING);
      expect(gameState.players[0].score).toBe(2);

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(3);
      expect(history[0].gameEvent.actionType).toBe(ActionType.BEGIN_PHASE);
      expect(history[1].gameEvent.actionType).toBe(ActionType.SCORE_HEELS);
      expect(history[2].gameEvent.actionType).toBe(ActionType.BEGIN_PHASE);
    });
  });
});

