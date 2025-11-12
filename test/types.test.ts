import {
  ActionType,
  AgentDecisionType,
  DecisionRequest,
  GameSnapshot,
} from '../src/types';
import { CribbageGame } from '../src/core/CribbageGame';

describe('Type System Tests', () => {
  describe('ActionType enum', () => {
    it('should include all action types', () => {
      expect(ActionType.DEAL).toBe('DEAL');
      expect(ActionType.DISCARD).toBe('DISCARD');
      expect(ActionType.PLAY_CARD).toBe('PLAY_CARD');
      expect(ActionType.CUT_DECK).toBe('CUT_DECK');
      expect(ActionType.READY_FOR_COUNTING).toBe('READY_FOR_COUNTING');
      expect(ActionType.READY_FOR_NEXT_ROUND).toBe('READY_FOR_NEXT_ROUND');
      expect(ActionType.WIN).toBe('WIN');
    });
  });

  describe('DecisionRequest interface', () => {
    it('should create a valid DecisionRequest object', () => {
      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: 'player-1',
        decisionType: AgentDecisionType.DISCARD,
        requestData: {
          hand: [],
          numberOfCardsToDiscard: 2,
        },
        required: true,
        timestamp: new Date(),
      };

      expect(request.requestId).toBe('req-1');
      expect(request.playerId).toBe('player-1');
      expect(request.decisionType).toBe(AgentDecisionType.DISCARD);
      expect(request.required).toBe(true);
      expect(request.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('GameSnapshot interface', () => {
    it('should include pendingDecisionRequests array', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Get a snapshot (by recording an event)
      game.deal();
      const history = game.getGameSnapshotHistory();
      
      if (history.length > 0) {
        const snapshot: GameSnapshot = history[history.length - 1];
        expect(snapshot.pendingDecisionRequests).toBeDefined();
        expect(Array.isArray(snapshot.pendingDecisionRequests)).toBe(true);
      }
    });

    it('should clear pendingDecisionRequests in startRound', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Add a decision request
      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: 'player-1',
        decisionType: AgentDecisionType.DISCARD,
        requestData: {
          hand: [],
          numberOfCardsToDiscard: 2,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request);
      expect(game.getPendingDecisionRequests().length).toBe(1);

      // Start a new round
      game.startRound();

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(0);
    });
  });
});

