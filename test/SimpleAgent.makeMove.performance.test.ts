import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import { HeuristicSimpleAgent } from '../src/agents/HeuristicSimpleAgent';
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

  /**
   * Helper to create a worst-case game state:
   * - Early game: very few cards played (maximizes possibleRemainingCards)
   * - Empty pegging stack: all cards in hand are valid to play
   * - Multiple cards in hand: maximizes valid cards to evaluate
   */
  function createWorstCaseState(
    baseState: GameState,
    cardsPlayed: number = 0,
    agent: ExhaustiveSimpleAgent | HeuristicSimpleAgent
  ): GameSnapshot {
    const player = baseState.players.find(p => p.id === 'test-player')!;
    const deck = agent.cribbageGame.generateDeck();
    
    // Create playedCards array with specified number of cards
    const playedCards = Array.from({ length: cardsPlayed }, (_, i) => ({
      playerId: 'opponent',
      card: deck[i] as Card,
    }));

    const modifiedState: GameState = {
      ...baseState,
      peggingStack: [], // Empty stack = all cards valid
      playedCards,
    };
    return stateToSnapshot(modifiedState);
  }

  /**
   * Helper to calculate remaining cards for a given state
   */
  function calculateRemainingCards(
    state: GameState,
    agent: ExhaustiveSimpleAgent | HeuristicSimpleAgent
  ): number {
    const player = state.players.find(p => p.id === 'test-player')!;
    const deck = agent.cribbageGame.generateDeck();
    return deck.filter(
      card =>
        !state.playedCards.some(pc => pc.card === card) &&
        !player.peggingHand.includes(card) &&
        card !== state.turnCard
    ).length;
  }

  describe('ExhaustiveSimpleAgent Performance', () => {
    describe('baseline performance', () => {
      it('[ExhaustiveSimpleAgent] should complete makeMove in reasonable time', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const startTime = Date.now();
        const result = await exhaustiveAgent.makeMove(stateToSnapshot(gameState), 'test-player');
        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        expect(duration).toBeLessThan(5000); // Exhaustive can be slow
        
        console.log(`\n[ExhaustiveSimpleAgent] Baseline makeMove: ${duration}ms`);
      });

      it('[ExhaustiveSimpleAgent] should handle multiple makeMove calls', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const times: number[] = [];
        const iterations = 5; // Fewer iterations for exhaustive

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await exhaustiveAgent.makeMove(stateToSnapshot(gameState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        console.log(`\n[ExhaustiveSimpleAgent] Multiple calls (${iterations} iterations):`);
        console.log(`  Average: ${avgTime.toFixed(0)}ms`);
        console.log(`  Min: ${minTime}ms`);
        console.log(`  Max: ${maxTime}ms`);
        console.log(`  Times: ${times.join(', ')}ms`);

        expect(avgTime).toBeLessThan(5000);
        expect(maxTime).toBeLessThan(10000);
      });
    });

    describe('worst-case scenarios', () => {
      it('[ExhaustiveSimpleAgent] worst-case: early game with 30+ remaining cards', async () => {
        const initialPlayer = gameState.players.find(p => p.id === 'test-player')!;
        if (initialPlayer.peggingHand.length === 0) {
          return;
        }

        const worstCaseSnapshot = createWorstCaseState(gameState, 2, exhaustiveAgent);
        const possibleRemaining = calculateRemainingCards(worstCaseSnapshot.gameState, exhaustiveAgent);
        const player = worstCaseSnapshot.gameState.players.find(p => p.id === 'test-player')!;

        // Calculate actual scorePegging calls
        // For each card: 1 call for scoreEarned + (remainingCards × (remainingCards - 1)) calls for opponent simulation
        const scorePeggingCallsPerCard = 1 + possibleRemaining * (possibleRemaining - 1);
        const totalScorePeggingCalls = player.peggingHand.length * scorePeggingCallsPerCard;

        console.log(`\n[ExhaustiveSimpleAgent] === WORST-CASE SCENARIO ===`);
        console.log(`  Cards in hand: ${player.peggingHand.length}`);
        console.log(`  Cards played: ${worstCaseSnapshot.gameState.playedCards.length}`);
        console.log(`  Possible remaining cards: ${possibleRemaining}`);
        console.log(`  Valid cards to play: ${player.peggingHand.length} (empty stack)`);
        console.log(`  Expected iterations: ${player.peggingHand.length} × ${possibleRemaining}² = ${player.peggingHand.length * possibleRemaining * possibleRemaining}`);
        console.log(`  Actual scorePegging calls: ${totalScorePeggingCalls} (${scorePeggingCallsPerCard} per card)`);

        const times: number[] = [];
        const iterations = 3;

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await exhaustiveAgent.makeMove(worstCaseSnapshot, 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const timePerCall = avgTime / totalScorePeggingCalls;

        console.log(`\n[ExhaustiveSimpleAgent] Worst-case results:`);
        console.log(`  Average: ${avgTime.toFixed(0)}ms`);
        console.log(`  Min: ${minTime}ms`);
        console.log(`  Max: ${maxTime}ms`);
        console.log(`  Times: ${times.join(', ')}ms`);
        console.log(`  Time per scorePegging call: ${timePerCall.toFixed(4)}ms`);
        console.log(`  Note: If scorePegging is ~0.001ms, expected time: ${(totalScorePeggingCalls * 0.001).toFixed(1)}ms`);

        expect(avgTime).toBeLessThan(10000);
        expect(maxTime).toBeLessThan(15000);
      });

      it('[ExhaustiveSimpleAgent] worst-case: maximum remaining cards (0 cards played)', async () => {
        const initialPlayer = gameState.players.find(p => p.id === 'test-player')!;
        if (initialPlayer.peggingHand.length === 0) {
          return;
        }

        const worstCaseSnapshot = createWorstCaseState(gameState, 0, exhaustiveAgent);
        const possibleRemaining = calculateRemainingCards(worstCaseSnapshot.gameState, exhaustiveAgent);
        const player = worstCaseSnapshot.gameState.players.find(p => p.id === 'test-player')!;

        // Calculate actual scorePegging calls
        const scorePeggingCallsPerCard = 1 + possibleRemaining * (possibleRemaining - 1);
        const totalScorePeggingCalls = player.peggingHand.length * scorePeggingCallsPerCard;

        console.log(`\n[ExhaustiveSimpleAgent] === ABSOLUTE WORST-CASE SCENARIO ===`);
        console.log(`  Cards in hand: ${player.peggingHand.length}`);
        console.log(`  Cards played: ${worstCaseSnapshot.gameState.playedCards.length}`);
        console.log(`  Possible remaining cards: ${possibleRemaining}`);
        console.log(`  Valid cards to play: ${player.peggingHand.length} (empty stack)`);
        console.log(`  Expected iterations: ${player.peggingHand.length} × ${possibleRemaining}² = ${player.peggingHand.length * possibleRemaining * possibleRemaining}`);
        console.log(`  Actual scorePegging calls: ${totalScorePeggingCalls} (${scorePeggingCallsPerCard} per card)`);

        const startTime = Date.now();
        await exhaustiveAgent.makeMove(worstCaseSnapshot, 'test-player');
        const duration = Date.now() - startTime;
        const timePerCall = duration / totalScorePeggingCalls;

        console.log(`\n[ExhaustiveSimpleAgent] Absolute worst-case duration: ${duration}ms`);
        console.log(`  Time per scorePegging call: ${timePerCall.toFixed(4)}ms`);
        console.log(`  Note: If scorePegging is ~0.001ms, expected time: ${(totalScorePeggingCalls * 0.001).toFixed(1)}ms`);

        expect(duration).toBeLessThan(15000);
      });

      it('[ExhaustiveSimpleAgent] performance scaling across different game states', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const scenarios = [
          { name: 'Late game (few remaining)', cardsPlayed: 40 },
          { name: 'Mid game (some remaining)', cardsPlayed: 20 },
          { name: 'Early game (many remaining)', cardsPlayed: 5 },
          { name: 'Very early (most remaining)', cardsPlayed: 0 },
        ];

        const results: Array<{
          name: string;
          cardsPlayed: number;
          actualRemaining: number;
          avgTime: number;
          maxTime: number;
        }> = [];

        for (const scenario of scenarios) {
          const snapshot = createWorstCaseState(gameState, scenario.cardsPlayed, exhaustiveAgent);
          const actualRemaining = calculateRemainingCards(snapshot.gameState, exhaustiveAgent);

          const times: number[] = [];
          const iterations = scenario.cardsPlayed === 0 ? 1 : 2;

          for (let i = 0; i < iterations; i++) {
            const startTime = Date.now();
            await exhaustiveAgent.makeMove(snapshot, 'test-player');
            times.push(Date.now() - startTime);
          }

          const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
          const maxTime = Math.max(...times);
          
          results.push({
            name: scenario.name,
            cardsPlayed: scenario.cardsPlayed,
            actualRemaining,
            avgTime,
            maxTime,
          });
        }

        console.log(`\n[ExhaustiveSimpleAgent] === PERFORMANCE SCALING ANALYSIS ===`);
        console.log(`Cards in hand: ${player.peggingHand.length}, Empty stack (all cards valid)`);
        for (const result of results) {
          const iterations = result.actualRemaining * result.actualRemaining * player.peggingHand.length;
          console.log(`\n  ${result.name}:`);
          console.log(`    Cards played: ${result.cardsPlayed}`);
          console.log(`    Remaining cards: ${result.actualRemaining}`);
          console.log(`    Estimated iterations: ${iterations}`);
          console.log(`    Avg time: ${result.avgTime.toFixed(0)}ms`);
          console.log(`    Max time: ${result.maxTime}ms`);
          console.log(`    Time per 1000 iterations: ${((result.avgTime / iterations) * 1000).toFixed(2)}ms`);
        }

        const lateGame = results.find(r => r.name.includes('Late'));
        const earlyGame = results.find(r => r.name.includes('Very early'));
        
        if (lateGame && earlyGame) {
          expect(earlyGame.avgTime).toBeGreaterThan(lateGame.avgTime);
        }
      });
    });
  });

  describe('HeuristicSimpleAgent Performance', () => {
    describe('baseline performance', () => {
      it('[HeuristicSimpleAgent] should complete makeMove quickly', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const startTime = Date.now();
        const result = await heuristicAgent.makeMove(stateToSnapshot(gameState), 'test-player');
        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        expect(duration).toBeLessThan(1000); // Should be fast
        
        console.log(`\n[HeuristicSimpleAgent] Baseline makeMove: ${duration}ms`);
      });

      it('[HeuristicSimpleAgent] should handle multiple makeMove calls efficiently', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const times: number[] = [];
        const iterations = 10;

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await heuristicAgent.makeMove(stateToSnapshot(gameState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        console.log(`\n[HeuristicSimpleAgent] Multiple calls (${iterations} iterations):`);
        console.log(`  Average: ${avgTime.toFixed(0)}ms`);
        console.log(`  Min: ${minTime}ms`);
        console.log(`  Max: ${maxTime}ms`);
        console.log(`  Times: ${times.join(', ')}ms`);

        expect(avgTime).toBeLessThan(200);
        expect(maxTime).toBeLessThan(500);
      });
    });

    describe('with different stack sizes', () => {
      it('[HeuristicSimpleAgent] should handle empty stack efficiently', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const emptyStackState = { ...gameState, peggingStack: [] };
        const iterations = 10;
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await heuristicAgent.makeMove(stateToSnapshot(emptyStackState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`\n[HeuristicSimpleAgent] Empty stack: avg ${avgTime.toFixed(0)}ms`);
        expect(avgTime).toBeLessThan(200);
      });

      it('[HeuristicSimpleAgent] should handle small stack efficiently', async () => {
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
          await heuristicAgent.makeMove(stateToSnapshot(smallStackState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`\n[HeuristicSimpleAgent] Small stack (2 cards): avg ${avgTime.toFixed(0)}ms`);
        expect(avgTime).toBeLessThan(200);
      });

      it('[HeuristicSimpleAgent] should handle medium stack efficiently', async () => {
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
          await heuristicAgent.makeMove(stateToSnapshot(mediumStackState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`\n[HeuristicSimpleAgent] Medium stack (5 cards): avg ${avgTime.toFixed(0)}ms`);
        expect(avgTime).toBeLessThan(200);
      });

      it('[HeuristicSimpleAgent] should handle large stack efficiently', async () => {
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
          await heuristicAgent.makeMove(stateToSnapshot(largeStackState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`\n[HeuristicSimpleAgent] Large stack (8 cards): avg ${avgTime.toFixed(0)}ms`);
        expect(avgTime).toBeLessThan(300);
      });
    });

    describe('with different numbers of remaining cards', () => {
      it('[HeuristicSimpleAgent] should handle few remaining cards efficiently', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const lateGameState = {
          ...gameState,
          playedCards: Array.from({ length: 40 }, (_, i) => ({
            playerId: 'opponent',
            card: `ACE_SPADES` as Card,
          })),
        };

        const iterations = 10;
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await heuristicAgent.makeMove(stateToSnapshot(lateGameState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`\n[HeuristicSimpleAgent] Few remaining cards (late game): avg ${avgTime.toFixed(0)}ms`);
        expect(avgTime).toBeLessThan(200);
      });

      it('[HeuristicSimpleAgent] should handle many remaining cards efficiently', async () => {
        const player = gameState.players.find(p => p.id === 'test-player')!;
        if (player.peggingHand.length === 0) {
          return;
        }

        const earlyGameState = {
          ...gameState,
          playedCards: [],
        };

        const iterations = 10;
        const times: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          await heuristicAgent.makeMove(stateToSnapshot(earlyGameState), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        console.log(`\n[HeuristicSimpleAgent] Many remaining cards (early game): avg ${avgTime.toFixed(0)}ms, max ${maxTime}ms`);
        console.log(`  Times: ${times.join(', ')}ms`);
        
        expect(avgTime).toBeLessThan(200);
        expect(maxTime).toBeLessThan(500);
      });
    });
  });

  describe('Performance Comparison', () => {
    it('[Comparison] ExhaustiveSimpleAgent vs HeuristicSimpleAgent - baseline', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const exhaustiveTimes: number[] = [];
      const exhaustiveIterations = 3;
      for (let i = 0; i < exhaustiveIterations; i++) {
        const startTime = Date.now();
        await exhaustiveAgent.makeMove(stateToSnapshot(gameState), 'test-player');
        exhaustiveTimes.push(Date.now() - startTime);
      }
      const exhaustiveAvg = exhaustiveTimes.reduce((a, b) => a + b, 0) / exhaustiveTimes.length;

      const heuristicTimes: number[] = [];
      const heuristicIterations = 10;
      for (let i = 0; i < heuristicIterations; i++) {
        const startTime = Date.now();
        await heuristicAgent.makeMove(stateToSnapshot(gameState), 'test-player');
        heuristicTimes.push(Date.now() - startTime);
      }
      const heuristicAvg = heuristicTimes.reduce((a, b) => a + b, 0) / heuristicTimes.length;

      console.log(`\n[Comparison] Baseline Performance:`);
      console.log(`  ExhaustiveSimpleAgent: avg ${exhaustiveAvg.toFixed(0)}ms`);
      console.log(`  HeuristicSimpleAgent: avg ${heuristicAvg.toFixed(0)}ms`);
      console.log(`  Speedup: ${(exhaustiveAvg / heuristicAvg).toFixed(1)}x faster`);

      expect(heuristicAvg).toBeLessThan(exhaustiveAvg);
    });

    it('[Comparison] ExhaustiveSimpleAgent vs HeuristicSimpleAgent - worst-case (many remaining cards)', async () => {
      const player = gameState.players.find(p => p.id === 'test-player')!;
      if (player.peggingHand.length === 0) {
        return;
      }

      const worstCaseState: GameState = {
        ...gameState,
        peggingStack: [],
        playedCards: [],
      };
      const worstCaseSnapshot = stateToSnapshot(worstCaseState);

      const exhaustiveStartTime = Date.now();
      await exhaustiveAgent.makeMove(worstCaseSnapshot, 'test-player');
      const exhaustiveTime = Date.now() - exhaustiveStartTime;

      const heuristicStartTime = Date.now();
      await heuristicAgent.makeMove(worstCaseSnapshot, 'test-player');
      const heuristicTime = Date.now() - heuristicStartTime;

      console.log(`\n[Comparison] Worst-Case Performance (many remaining cards):`);
      console.log(`  ExhaustiveSimpleAgent: ${exhaustiveTime}ms`);
      console.log(`  HeuristicSimpleAgent: ${heuristicTime}ms`);
      console.log(`  Speedup: ${(exhaustiveTime / heuristicTime).toFixed(1)}x faster`);

      expect(heuristicTime).toBeLessThan(exhaustiveTime);
      expect(heuristicTime).toBeLessThan(500);
    });
  });

  describe('Performance Regression Tests', () => {
    it('[HeuristicSimpleAgent] should not exceed performance thresholds', async () => {
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
          await heuristicAgent.makeMove(stateToSnapshot(state), 'test-player');
          times.push(Date.now() - startTime);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        results.push({ name: scenario.name, avgTime, maxTime });
      }

      console.log(`\n[HeuristicSimpleAgent] Performance Regression Summary:`);
      for (const result of results) {
        console.log(`  ${result.name}: avg ${result.avgTime.toFixed(0)}ms, max ${result.maxTime}ms`);
      }

      expect(results[0].avgTime).toBeLessThan(200);
      expect(results[1].avgTime).toBeLessThan(200);
      expect(results[2].avgTime).toBeLessThan(200);
      expect(results[3].avgTime).toBeLessThan(300);
    });
  });
});

