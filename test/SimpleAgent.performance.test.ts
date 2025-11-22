import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import { CribbageGame } from '../src/core/CribbageGame';
import { GameState, GameSnapshot, Card, ActionType } from '../src/types';

/**
 * Helper to convert GameState to GameSnapshot for tests
 */
function stateToSnapshot(gameState: GameState): GameSnapshot {
  return {
    gameState,
    gameEvent: {
      gameId: gameState.id,
      phase: gameState.currentPhase,
      actionType: ActionType.START_ROUND,
      playerId: null,
      cards: null,
      scoreChange: 0,
      timestamp: new Date(),
      snapshotId: gameState.snapshotId,
    },
    pendingDecisionRequests: [],
  };
}

describe('SimpleAgent Performance Tests', () => {
  let agent: ExhaustiveSimpleAgent;
  let game: CribbageGame;
  let gameState: GameState;

  beforeEach(() => {
    agent = new ExhaustiveSimpleAgent();
    agent.playerId = 'test-player';
    
    game = new CribbageGame([
      { id: 'test-player', name: 'Test Player' },
      { id: 'opponent', name: 'Opponent' },
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
    
    // Cut deck
    game.cutDeck(game.getGameState().players[1].id, 0);
    
    gameState = game.getGameState();
  });

  describe('makeMove performance', () => {
    it('should complete makeMove in reasonable time (< 1000ms)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        // Skip if no cards to play
        return;
      }

      const startTime = Date.now();
      const result = await agent.makeMove(stateToSnapshot(gameState), 'test-player');
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      
      console.log(`makeMove took ${duration}ms`);
    });

    it('should handle multiple makeMove calls efficiently', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const times: number[] = [];
      const iterations = 5;

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await agent.makeMove(stateToSnapshot(gameState), 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      console.log(`Average makeMove time: ${avgTime.toFixed(0)}ms`);
      console.log(`Max makeMove time: ${maxTime}ms`);
      console.log(`Times: ${times.join(', ')}ms`);

      expect(avgTime).toBeLessThan(2000); // Average should be reasonable
      expect(maxTime).toBeLessThan(5000); // Max should not be too high
    });

    it('should measure makeMove performance with different stack sizes', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      // Test with empty stack
      const emptyStackState = { ...gameState, peggingStack: [] };
      const startTime1 = Date.now();
      await agent.makeMove(stateToSnapshot(emptyStackState), 'test-player');
      const duration1 = Date.now() - startTime1;
      console.log(`makeMove with empty stack: ${duration1}ms`);

      // Test with some cards in stack
      const someCardsState = {
        ...gameState,
        peggingStack: gameState.peggingStack.slice(0, 3),
      };
      const startTime2 = Date.now();
      await agent.makeMove(stateToSnapshot(someCardsState), 'test-player');
      const duration2 = Date.now() - startTime2;
      console.log(`makeMove with 3 cards in stack: ${duration2}ms`);

      // Test with many cards in stack
      const manyCardsState = {
        ...gameState,
        peggingStack: gameState.peggingStack.slice(0, 8),
      };
      const startTime3 = Date.now();
      await agent.makeMove(stateToSnapshot(manyCardsState), 'test-player');
      const duration3 = Date.now() - startTime3;
      console.log(`makeMove with 8 cards in stack: ${duration3}ms`);

      expect(duration1).toBeLessThan(2000);
      expect(duration2).toBeLessThan(2000);
      expect(duration3).toBeLessThan(2000);
    });
  });

  describe('discard performance', () => {
    it('should complete discard in reasonable time (< 500ms)', async () => {
      // Reset to dealing phase for discard test
      game = new CribbageGame([
        { id: 'test-player', name: 'Test Player' },
        { id: 'opponent', name: 'Opponent' },
      ]);
      game.getGameState().players[0].isDealer = true;
      game.startRound();
      game.deal();
      const state = game.getGameState();
      const player = state.players.find(p => p.id === 'test-player')!;

      const startTime = Date.now();
      const result = await agent.discard(stateToSnapshot(state), 'test-player', 2);
      const duration = Date.now() - startTime;

      expect(result).toHaveLength(2);
      expect(duration).toBeLessThan(500); // Should complete quickly
      
      console.log(`discard took ${duration}ms`);
    });

    it('should handle multiple discard calls efficiently', async () => {
      game = new CribbageGame([
        { id: 'test-player', name: 'Test Player' },
        { id: 'opponent', name: 'Opponent' },
      ]);
      game.getGameState().players[0].isDealer = true;
      game.startRound();
      game.deal();
      const state = game.getGameState();

      const times: number[] = [];
      const iterations = 5;

      for (let i = 0; i < iterations; i++) {
        // Create fresh state for each iteration
        const freshGame = new CribbageGame([
          { id: 'test-player', name: 'Test Player' },
          { id: 'opponent', name: 'Opponent' },
        ]);
        freshGame.getGameState().players[0].isDealer = true;
        freshGame.startRound();
        freshGame.deal();
        const freshState = freshGame.getGameState();

        const startTime = Date.now();
        await agent.discard(stateToSnapshot(freshState), 'test-player', 2);
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      console.log(`Average discard time: ${avgTime.toFixed(0)}ms`);
      console.log(`Max discard time: ${maxTime}ms`);

      expect(avgTime).toBeLessThan(1000);
      expect(maxTime).toBeLessThan(2000);
    });
  });
});

