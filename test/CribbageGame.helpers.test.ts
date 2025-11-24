import { CribbageGame } from '../src/core/CribbageGame';
import { AgentDecisionType, DecisionRequest } from '../src/types';

describe('CribbageGame Helper Methods', () => {
  let game: CribbageGame;

  beforeEach(() => {
    game = new CribbageGame([
      { id: 'player-1', name: 'Player 1' },
      { id: 'player-2', name: 'Player 2' },
    ]);
  });

  describe('addDecisionRequest', () => {
    it('should add a decision request', () => {
      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(0);

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

      const updatedRequests = game.getPendingDecisionRequests();
      expect(updatedRequests.length).toBe(1);
      expect(updatedRequests[0].playerId).toBe('player-1');
      expect(updatedRequests[0].decisionType).toBe(AgentDecisionType.DISCARD);
      expect(updatedRequests[0].requestId).toBe('req-1');
    });

    it('should not add duplicate requests (same requestId)', () => {
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
      game.addDecisionRequest(request); // Duplicate

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(1);
    });

    it('should support multiple different players waiting simultaneously', () => {
      const request1: DecisionRequest = {
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

      const request2: DecisionRequest = {
        requestId: 'req-2',
        playerId: 'player-2',
        decisionType: AgentDecisionType.DISCARD,
        requestData: {
          hand: [],
          numberOfCardsToDiscard: 2,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request1);
      game.addDecisionRequest(request2);

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(2);
      expect(pendingRequests.map(r => r.playerId)).toEqual([
        'player-1',
        'player-2',
      ]);
    });
  });

  describe('removeDecisionRequest', () => {
    it('should remove a decision request', () => {
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

      const request2: DecisionRequest = {
        requestId: 'req-2',
        playerId: 'player-2',
        decisionType: AgentDecisionType.DISCARD,
        requestData: {
          hand: [],
          numberOfCardsToDiscard: 2,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request2);

      expect(game.getPendingDecisionRequests().length).toBe(2);

      game.removeDecisionRequest('req-1');

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(1);
      expect(pendingRequests[0].playerId).toBe('player-2');
    });

    it('should handle removing non-existent request gracefully', () => {
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

      expect(() => {
        game.removeDecisionRequest('req-999');
      }).not.toThrow();

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(1);
    });

    it('should handle removing from empty list', () => {
      expect(() => {
        game.removeDecisionRequest('req-1');
      }).not.toThrow();

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(0);
    });
  });

  describe('clearAllDecisionRequests', () => {
    it('should clear all decision requests', () => {
      const request1: DecisionRequest = {
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

      const request2: DecisionRequest = {
        requestId: 'req-2',
        playerId: 'player-2',
        decisionType: AgentDecisionType.PLAY_CARD,
        requestData: {
          peggingHand: [],
          peggingStack: [],
          playedCards: [],
          peggingTotal: 0,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request1);
      game.addDecisionRequest(request2);

      expect(game.getPendingDecisionRequests().length).toBe(2);

      game.clearAllDecisionRequests();

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(0);
    });

    it('should handle clearing empty list', () => {
      expect(() => {
        game.clearAllDecisionRequests();
      }).not.toThrow();

      const pendingRequests = game.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(0);
    });
  });

  describe('allPlayersAcknowledged', () => {
    it('should return true when no pending requests of given type', () => {
      expect(game.allPlayersAcknowledged(AgentDecisionType.READY_FOR_COUNTING)).toBe(true);
    });

    it('should return false when requests of given type exist', () => {
      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: 'player-1',
        decisionType: AgentDecisionType.READY_FOR_COUNTING,
        requestData: {
          message: 'Ready for counting',
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request);
      expect(game.allPlayersAcknowledged(AgentDecisionType.READY_FOR_COUNTING)).toBe(false);
    });

    it('should only check requests of the specified type', () => {
      const request1: DecisionRequest = {
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

      game.addDecisionRequest(request1);
      expect(game.allPlayersAcknowledged(AgentDecisionType.READY_FOR_COUNTING)).toBe(true);
      expect(game.allPlayersAcknowledged(AgentDecisionType.DISCARD)).toBe(false);
    });
  });

  describe('getRedactedGameState', () => {
    it('should return redacted game state', () => {
      const redactedState = game.getRedactedGameState('player-1');
      const fullState = game.getGameState();

      // Redacted state should be a different object (not the same reference)
      expect(redactedState).not.toBe(fullState);
      // But should have same basic properties
      expect(redactedState.id).toBe(fullState.id);
      expect(redactedState.players.length).toBe(fullState.players.length);
      // Deck should be redacted (all UNKNOWN)
      expect(redactedState.deck.every(c => c === 'UNKNOWN')).toBe(true);
    });

    it('should accept any player ID parameter', () => {
      expect(() => {
        game.getRedactedGameState('player-1');
        game.getRedactedGameState('player-2');
      }).not.toThrow();
    });

    it('should throw for non-existent player', () => {
      expect(() => {
        game.getRedactedGameState('non-existent-player');
      }).toThrow('Player non-existent-player not found');
    });
  });
});

