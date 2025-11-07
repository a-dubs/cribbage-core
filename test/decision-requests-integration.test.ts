import { CribbageGame } from '../src/core/CribbageGame';
import { GameLoop } from '../src/gameplay/GameLoop';
import { RandomAgent } from '../src/agents/RandomAgent';
import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import {
  ActionType,
  AgentDecisionType,
} from '../src/types';

describe('Decision Requests Integration', () => {
  describe('recordWaitingEvent', () => {
    it('should add player to waiting list and record event', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      const initialHistoryLength = game.getGameSnapshotHistory().length;
      const gameState = game.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(0);

      game.recordWaitingEvent(
        ActionType.WAITING_FOR_DISCARD,
        'player-1',
        AgentDecisionType.DISCARD
      );

      const updatedState = game.getGameState();
      expect(updatedState.waitingForPlayers.length).toBe(1);
      expect(updatedState.waitingForPlayers[0].playerId).toBe('player-1');
      expect(updatedState.waitingForPlayers[0].decisionType).toBe(
        AgentDecisionType.DISCARD
      );

      const history = game.getGameSnapshotHistory();
      expect(history.length).toBe(initialHistoryLength + 1);
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.actionType).toBe(ActionType.WAITING_FOR_DISCARD);
      expect(lastEvent.playerId).toBe('player-1');
    });
  });

  describe('CribbageGame methods clear waiting state', () => {
    it('should clear waiting state before deal()', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      const dealer = game.getDealerId();
      game.addWaitingForPlayer(dealer, AgentDecisionType.DEAL);

      expect(game.getGameState().waitingForPlayers.length).toBe(1);

      game.deal();

      expect(game.getGameState().waitingForPlayers.length).toBe(0);
    });

    it('should clear waiting state before discardToCrib()', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      game.deal();
      const player = game.getGameState().players[0];

      game.addWaitingForPlayer(player.id, AgentDecisionType.DISCARD);
      expect(game.getGameState().waitingForPlayers.length).toBe(1);

      const cardsToDiscard = player.hand.slice(0, 2);
      game.discardToCrib(player.id, cardsToDiscard);

      expect(game.getGameState().waitingForPlayers.length).toBe(0);
    });

    it('should clear waiting state before playCard()', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

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
      game.addWaitingForPlayer(player.id, AgentDecisionType.PLAY_CARD);
      expect(game.getGameState().waitingForPlayers.length).toBe(1);

      const card = player.peggingHand[0];
      game.playCard(player.id, card);

      expect(game.getGameState().waitingForPlayers.length).toBe(0);
    });

    it('should clear waiting state before cutDeck()', () => {
      const game = new CribbageGame([
        { id: 'player-1', name: 'Player 1' },
        { id: 'player-2', name: 'Player 2' },
      ]);

      game.deal();
      // Complete discard phase
      const players = game.getGameState().players;
      players.forEach(player => {
        const cardsToDiscard = player.hand.slice(0, 2);
        game.discardToCrib(player.id, cardsToDiscard);
      });
      game.completeCribPhase();

      const player = game.getGameState().players[1];
      game.addWaitingForPlayer(player.id, AgentDecisionType.CONTINUE);
      expect(game.getGameState().waitingForPlayers.length).toBe(1);

      game.cutDeck(player.id, 0);

      expect(game.getGameState().waitingForPlayers.length).toBe(0);
    });
  });

  describe('GameLoop requestDecision integration', () => {
    it('should record waiting events during game play', async () => {
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
      requestDecision('bot-1', AgentDecisionType.DEAL);

      const gameState = gameLoop.cribbageGame.getGameState();
      expect(gameState.waitingForPlayers.length).toBe(1);
      expect(gameState.waitingForPlayers[0].playerId).toBe('bot-1');
      expect(gameState.waitingForPlayers[0].decisionType).toBe(
        AgentDecisionType.DEAL
      );

      const history = gameLoop.cribbageGame.getGameSnapshotHistory();
      const waitingEvents = history.filter(
        e => e.gameEvent.actionType === ActionType.WAITING_FOR_DEAL
      );
      expect(waitingEvents.length).toBe(1);
      expect(waitingEvents[0].gameEvent.playerId).toBe('bot-1');
    });
  });
});

