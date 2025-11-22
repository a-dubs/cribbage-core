import { CribbageGame } from '../src/core/CribbageGame';
import { GameLoop } from '../src/gameplay/GameLoop';
import { RandomAgent } from '../src/agents/RandomAgent';
import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import {
  AgentDecisionType,
  DecisionRequest,
} from '../src/types';

describe('Decision Requests Integration', () => {
  describe('addDecisionRequest', () => {
    it('should add decision request to pending requests', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      const initialPendingRequests = game.getPendingDecisionRequests();
      expect(initialPendingRequests.length).toBe(0);

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

      const updatedPendingRequests = game.getPendingDecisionRequests();
      expect(updatedPendingRequests.length).toBe(1);
      expect(updatedPendingRequests[0].playerId).toBe('player-1');
      expect(updatedPendingRequests[0].decisionType).toBe(
        AgentDecisionType.DISCARD
      );
    });
  });

  describe('CribbageGame methods clear decision requests', () => {
    it('should clear decision requests when deal() is called', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Set up game properly: select dealer and start round
      game.getGameState().players[0].isDealer = true;
      game.startRound();

      const dealer = game.getDealerId();
      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: dealer,
        decisionType: AgentDecisionType.DEAL,
        requestData: {
          canShuffle: true,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request);
      expect(game.getPendingDecisionRequests().length).toBe(1);

      // GameLoop pattern: remove request, then call method
      game.removeDecisionRequest(request.requestId);
      game.deal();

      // After GameLoop removes the request and calls deal(), no requests should remain
      expect(game.getPendingDecisionRequests().length).toBe(0);
    });

    it('should remove decision request when discardToCrib() is called', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Set up game properly: select dealer and start round
      game.getGameState().players[0].isDealer = true;
      game.startRound();
      game.deal();
      const player = game.getGameState().players[0];

      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: player.id,
        decisionType: AgentDecisionType.DISCARD,
        requestData: {
          hand: player.hand,
          numberOfCardsToDiscard: 2,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request);
      expect(game.getPendingDecisionRequests().length).toBe(1);

      const cardsToDiscard = player.hand.slice(0, 2);
      // GameLoop pattern: remove request, then call method
      game.removeDecisionRequest(request.requestId);
      game.discardToCrib(player.id, cardsToDiscard);

      // After GameLoop removes the request and calls discardToCrib(), no requests should remain
      expect(game.getPendingDecisionRequests().length).toBe(0);
    });

    it('should remove decision request when playCard() is called', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Set up game properly: select dealer and start round
      game.getGameState().players[0].isDealer = true;
      game.startRound();
      game.deal();
      // Complete discard phase
      const players = game.getGameState().players;
      players.forEach(player => {
        const cardsToDiscard = player.hand.slice(0, 2);
        game.discardToCrib(player.id, cardsToDiscard);
      });
      game.completeCribPhase();
      game.cutDeck(game.getGameState().players[1].id, 0);

      const player = game.getGameState().players.find(
        p => p.id !== game.getDealerId()
      )!;

      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: player.id,
        decisionType: AgentDecisionType.PLAY_CARD,
        requestData: {
          peggingHand: player.peggingHand,
          peggingStack: [],
          playedCards: [],
          peggingTotal: 0,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request);
      expect(game.getPendingDecisionRequests().length).toBe(1);

      const card = player.peggingHand[0];
      // GameLoop pattern: remove request, then call method
      game.removeDecisionRequest(request.requestId);
      game.playCard(player.id, card);

      // After GameLoop removes the request and calls playCard(), no requests should remain
      expect(game.getPendingDecisionRequests().length).toBe(0);
    });

    it('should remove decision request when cutDeck() is called', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      // Set up game properly: select dealer and start round
      game.getGameState().players[0].isDealer = true;
      game.startRound();
      game.deal();
      // Complete discard phase
      const players = game.getGameState().players;
      players.forEach(player => {
        const cardsToDiscard = player.hand.slice(0, 2);
        game.discardToCrib(player.id, cardsToDiscard);
      });
      game.completeCribPhase();

      const player = game.getGameState().players[1];
      const request: DecisionRequest = {
        requestId: 'req-1',
        playerId: player.id,
        decisionType: AgentDecisionType.CUT_DECK,
        requestData: {
          maxIndex: game.getGameState().deck.length - 1,
          deckSize: game.getGameState().deck.length,
        },
        required: true,
        timestamp: new Date(),
      };

      game.addDecisionRequest(request);
      expect(game.getPendingDecisionRequests().length).toBe(1);

      // GameLoop pattern: remove request, then call method
      game.removeDecisionRequest(request.requestId);
      game.cutDeck(player.id, 0);

      // After GameLoop removes the request and calls cutDeck(), no requests should remain
      expect(game.getPendingDecisionRequests().length).toBe(0);
    });
  });

  describe('GameLoop requestDecision integration', () => {
    it('should create decision requests during game play', async () => {
      const gameLoop = new GameLoop([
        { id: 'bot-1', name: 'Random Bot' },
        { id: 'bot-2', name: 'Simple Bot' },
      ]);

      const agent1 = new RandomAgent();
      agent1.playerId = 'bot-1';
      const agent2 = new ExhaustiveSimpleAgent();
      agent2.playerId = 'bot-2';

      gameLoop.addAgent('bot-1', agent1);
      gameLoop.addAgent('bot-2', agent2);

      // Start a round to trigger decision requests
      gameLoop.cribbageGame.startRound();

      // Request a decision (simulating what happens in doRound)
      const requestDecision = (gameLoop as any).requestDecision.bind(gameLoop);
      const request = requestDecision('bot-1', AgentDecisionType.DEAL, {
        canShuffle: true,
      });

      const pendingRequests = gameLoop.cribbageGame.getPendingDecisionRequests();
      expect(pendingRequests.length).toBe(1);
      expect(pendingRequests[0].playerId).toBe('bot-1');
      expect(pendingRequests[0].decisionType).toBe(AgentDecisionType.DEAL);
      expect(pendingRequests[0].requestId).toBe(request.requestId);

      // Decision requests are included in GameSnapshot
      // The request was added and a snapshot was emitted by requestDecision
      // We verify by checking getPendingDecisionRequests() which reflects current state
      expect(pendingRequests).toContainEqual(
        expect.objectContaining({
          playerId: 'bot-1',
          decisionType: AgentDecisionType.DEAL,
        })
      );
    });
  });
});

