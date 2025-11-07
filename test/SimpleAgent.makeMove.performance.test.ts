import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import { HeuristicSimpleAgent } from '../src/agents/HeuristicSimpleAgent';
import { CribbageGame } from '../src/core/CribbageGame';
import { GameState, Card } from '../src/types';

describe('Agent.makeMove Performance Tests', () => {
  let exhaustiveAgent: ExhaustiveSimpleAgent;
  let heuristicAgent: HeuristicSimpleAgent;
  let game: CribbageGame;
  let gameState: GameState;

  beforeEach(() => {
    exhaustiveAgent = new ExhaustiveSimpleAgent();
    exhaustiveAgent.playerId = 'test-player';
    
    heuristicAgent = new HeuristicSimpleAgent();
    heuristicAgent.playerId = 'test-player';
    
    game = new CribbageGame([
      { id: 'test-player', name: 'Test Player' },
      { id: 'opponent', name: 'Opponent' },
    ]);
    
    // Set up a game state for testing
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

  describe('ExhaustiveSimpleAgent (exhaustive) baseline performance', () => {
    it('should complete makeMove in reasonable time (< 5000ms)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const startTime = Date.now();
      const result = await exhaustiveAgent.makeMove(gameState, 'test-player');
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(5000); // Exhaustive can be slow
      
      console.log(`ExhaustiveSimpleAgent.makeMove took ${duration}ms`);
    });

    it('should handle multiple makeMove calls efficiently', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const times: number[] = [];
      const iterations = 5; // Fewer iterations for exhaustive

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await exhaustiveAgent.makeMove(gameState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      console.log(`ExhaustiveSimpleAgent.makeMove (${iterations} iterations):`);
      console.log(`  Average: ${avgTime.toFixed(0)}ms`);
      console.log(`  Min: ${minTime}ms`);
      console.log(`  Max: ${maxTime}ms`);
      console.log(`  Times: ${times.join(', ')}ms`);

      expect(avgTime).toBeLessThan(5000); // Exhaustive can be slower
      expect(maxTime).toBeLessThan(10000); // Max should not be too high
    });
  });

  describe('makeMove performance comparison', () => {
    it('should compare ExhaustiveSimpleAgent vs HeuristicSimpleAgent performance', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      // Test ExhaustiveSimpleAgent (exhaustive)
      const exhaustiveTimes: number[] = [];
      const exhaustiveIterations = 3;
      for (let i = 0; i < exhaustiveIterations; i++) {
        const startTime = Date.now();
        await exhaustiveAgent.makeMove(gameState, 'test-player');
        exhaustiveTimes.push(Date.now() - startTime);
      }
      const exhaustiveAvg = exhaustiveTimes.reduce((a, b) => a + b, 0) / exhaustiveTimes.length;

      // Test HeuristicSimpleAgent (fast)
      const heuristicTimes: number[] = [];
      const heuristicIterations = 10;
      for (let i = 0; i < heuristicIterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(gameState, 'test-player');
        heuristicTimes.push(Date.now() - startTime);
      }
      const heuristicAvg = heuristicTimes.reduce((a, b) => a + b, 0) / heuristicTimes.length;

      console.log(`\nPerformance Comparison:`);
      console.log(`  ExhaustiveSimpleAgent (exhaustive): avg ${exhaustiveAvg.toFixed(0)}ms`);
      console.log(`  HeuristicSimpleAgent (fast): avg ${heuristicAvg.toFixed(0)}ms`);
      console.log(`  Speedup: ${(exhaustiveAvg / heuristicAvg).toFixed(1)}x faster`);

      expect(heuristicAvg).toBeLessThan(exhaustiveAvg); // Heuristic should be faster
    });
  });

  describe('makeMove with different stack sizes', () => {
    it('should handle empty stack efficiently (HeuristicSimpleAgent)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const emptyStackState = { ...gameState, peggingStack: [] };
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(emptyStackState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`HeuristicSimpleAgent.makeMove with empty stack: avg ${avgTime.toFixed(0)}ms`);
      expect(avgTime).toBeLessThan(200);
    });

    it('should handle small stack efficiently (HeuristicSimpleAgent)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const smallStackState = {
        ...gameState,
        peggingStack: gameState.peggingStack.slice(0, 2),
      };
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(smallStackState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`HeuristicSimpleAgent.makeMove with 2 cards in stack: avg ${avgTime.toFixed(0)}ms`);
      expect(avgTime).toBeLessThan(200);
    });

    it('should handle medium stack efficiently (HeuristicSimpleAgent)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const mediumStackState = {
        ...gameState,
        peggingStack: gameState.peggingStack.slice(0, 5),
      };
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(mediumStackState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`HeuristicSimpleAgent.makeMove with 5 cards in stack: avg ${avgTime.toFixed(0)}ms`);
      expect(avgTime).toBeLessThan(200);
    });

    it('should handle large stack efficiently (HeuristicSimpleAgent)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const largeStackState = {
        ...gameState,
        peggingStack: gameState.peggingStack.slice(0, 8),
      };
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(largeStackState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`HeuristicSimpleAgent.makeMove with 8 cards in stack: avg ${avgTime.toFixed(0)}ms`);
      expect(avgTime).toBeLessThan(300);
    });
  });

  describe('makeMove with different numbers of possible remaining cards', () => {
    it('should handle few remaining cards efficiently (HeuristicSimpleAgent)', async () => {
      // Simulate late game: many cards already played
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      // Create state with many cards already played
      const lateGameState = {
        ...gameState,
        playedCards: Array.from({ length: 40 }, (_, i) => ({
          playerId: 'opponent',
          card: `ACE_SPADES` as Card, // Dummy cards
        })),
      };

      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(lateGameState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`HeuristicSimpleAgent.makeMove with few remaining cards: avg ${avgTime.toFixed(0)}ms`);
      expect(avgTime).toBeLessThan(200); // Should be consistently fast
    });

    it('should handle many remaining cards efficiently (HeuristicSimpleAgent)', async () => {
      // Simulate early game: few cards played
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const earlyGameState = {
        ...gameState,
        playedCards: [], // No cards played yet
      };

      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(earlyGameState, 'test-player');
        times.push(Date.now() - startTime);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      console.log(`HeuristicSimpleAgent.makeMove with many remaining cards: avg ${avgTime.toFixed(0)}ms, max ${maxTime}ms`);
      console.log(`  Times: ${times.join(', ')}ms`);
      
      // Heuristic should be fast regardless of remaining cards
      expect(avgTime).toBeLessThan(200);
      expect(maxTime).toBeLessThan(500);
    });

    it('should compare ExhaustiveSimpleAgent vs HeuristicSimpleAgent with many remaining cards', async () => {
      // Simulate early game: few cards played (worst case for ExhaustiveSimpleAgent)
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const earlyGameState = {
        ...gameState,
        playedCards: [], // No cards played yet
      };

      // Test ExhaustiveSimpleAgent (exhaustive - slow with many cards)
      const exhaustiveStartTime = Date.now();
      await exhaustiveAgent.makeMove(earlyGameState, 'test-player');
      const exhaustiveTime = Date.now() - exhaustiveStartTime;

      // Test HeuristicSimpleAgent (fast regardless)
      const heuristicStartTime = Date.now();
      await heuristicAgent.makeMove(earlyGameState, 'test-player');
      const heuristicTime = Date.now() - heuristicStartTime;

      console.log(`\nPerformance with many remaining cards:`);
      console.log(`  ExhaustiveSimpleAgent (exhaustive): ${exhaustiveTime}ms`);
      console.log(`  HeuristicSimpleAgent (fast): ${heuristicTime}ms`);
      console.log(`  Speedup: ${(exhaustiveTime / heuristicTime).toFixed(1)}x faster`);

      expect(heuristicTime).toBeLessThan(exhaustiveTime); // Heuristic should be faster
      expect(heuristicTime).toBeLessThan(500); // Heuristic should be consistently fast
    });
  });

  describe('makeMove performance regression test', () => {
    it('should not exceed performance thresholds', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const scenarios = [
        { name: 'empty stack', stack: [] },
        { name: 'small stack', stack: gameState.peggingStack.slice(0, 2) },
        { name: 'medium stack', stack: gameState.peggingStack.slice(0, 5) },
        { name: 'large stack', stack: gameState.peggingStack.slice(0, 8) },
      ];

      const results: Array<{ name: string; avgTime: number; maxTime: number }> = [];

      for (const scenario of scenarios) {
        const state = { ...gameState, peggingStack: scenario.stack };
        const iterations = 5;
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await heuristicAgent.makeMove(state, 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        results.push({ name: scenario.name, avgTime, maxTime });
      }

      console.log('\nHeuristicSimpleAgent.makeMove Performance Summary:');
      for (const result of results) {
        console.log(`  ${result.name}: avg ${result.avgTime.toFixed(0)}ms, max ${result.maxTime}ms`);
      }

      // Performance thresholds for HeuristicSimpleAgent (should be fast)
      expect(results[0].avgTime).toBeLessThan(200); // Empty stack
      expect(results[1].avgTime).toBeLessThan(200); // Small stack
      expect(results[2].avgTime).toBeLessThan(200); // Medium stack
      expect(results[3].avgTime).toBeLessThan(300); // Large stack
    });
  });
});

