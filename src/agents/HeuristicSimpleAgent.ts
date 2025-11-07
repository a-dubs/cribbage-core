import { CribbageGame } from '../core/CribbageGame';
import { parseCard, scoreHand, scorePegging } from '../core/scoring';
import { GameState, Card } from '../types';
import { SimpleAgent } from './SimpleAgent';

const AGENT_ID = 'heuristic-simple-bot-v1.0';
const DEBUG_TIMING = process.env.DEBUG_SIMPLE_AGENT_TIMING === 'true';

/**
 * HeuristicSimpleAgent extends SimpleAgent but uses a fast heuristic-based algorithm
 * for makeMove instead of exhaustive opponent simulation.
 * 
 * Performance: O(n) complexity vs O(n³) for SimpleAgent
 * - SimpleAgent: Simulates all possible opponent responses (slow but optimal)
 * - HeuristicSimpleAgent: Uses threat-based heuristics (fast but approximate)
 * 
 * Use HeuristicSimpleAgent when you need fast decisions (e.g., real-time games).
 * Use SimpleAgent when you need optimal decisions and can wait (e.g., analysis).
 */
export class HeuristicSimpleAgent extends SimpleAgent {
  playerId: string = AGENT_ID;

  makeMove(game: GameState, playerId: string): Promise<Card | null> {
    const startTime = DEBUG_TIMING ? Date.now() : 0;
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found.');
    }

    if (player.peggingHand.length === 0) {
      return Promise.resolve(null);
    }

    const parseStartTime = DEBUG_TIMING ? Date.now() : 0;
    const parsedHand = player.peggingHand.map(card => parseCard(card));
    const parsedStack = game.peggingStack.map(card => parseCard(card));
    
    // Calculate current stack sum for quick filtering
    const currentSum = parsedStack.reduce((sum, c) => sum + c.pegValue, 0);
    
    // Filter valid cards (must not exceed 31)
    const validPlayedCards = player.peggingHand.filter(card => {
      const cardValue = parseCard(card).pegValue;
      return currentSum + cardValue <= 31;
    });

    if (validPlayedCards.length === 0) {
      return Promise.resolve(null);
    }

    const parseDuration = DEBUG_TIMING ? Date.now() - parseStartTime : 0;
    const filterDuration = 0; // Already done above

    const scoringStartTime = DEBUG_TIMING ? Date.now() : 0;
    
    // HEURISTIC ALGORITHM: Use threat-based heuristics instead of opponent simulation
    // Strategy: Maximize immediate score while avoiding setting up opponent for big scores
    const cardScores: { card: Card; score: number; heuristic: number }[] = [];
    
    for (const card of validPlayedCards) {
      // Calculate immediate score earned
      const newStack = game.peggingStack.concat(card);
      const scoreEarned = scorePegging(newStack);
      
      // Heuristic: Estimate opponent threat
      // Instead of simulating all opponent responses, use simple heuristics:
      // 1. Avoid playing cards that bring sum close to 15 or 31 (opponent can complete)
      // 2. Prefer cards that score points
      // 3. Avoid creating pairs/runs that opponent can extend
      
      const cardValue = parseCard(card).pegValue;
      const newSum = currentSum + cardValue;
      
      // Calculate threat level (lower is better)
      let threatLevel = 0;
      
      // High threat: sum is close to 15 or 31
      const distanceTo15 = Math.abs(newSum - 15);
      const distanceTo31 = Math.abs(newSum - 31);
      if (distanceTo15 <= 5) threatLevel += (6 - distanceTo15) * 2;
      if (distanceTo31 <= 5) threatLevel += (6 - distanceTo31) * 2;
      
      // Medium threat: sum is exactly 10 or 20 (opponent can make 15 or 25)
      if (newSum === 10 || newSum === 20) threatLevel += 3;
      
      // Check if this creates a pair (opponent might extend to trips/quads)
      const lastCard = parsedStack[parsedStack.length - 1];
      if (lastCard && parseCard(card).runValue === lastCard.runValue) {
        threatLevel += 2; // Creates a pair
      }
      
      // Heuristic score: score earned minus threat level
      // Multiply scoreEarned by 10 to give it more weight
      const heuristic = scoreEarned * 10 - threatLevel;
      
      cardScores.push({ card, score: scoreEarned, heuristic });
    }
    
    const scoringDuration = DEBUG_TIMING ? Date.now() - scoringStartTime : 0;
    
    const selectStartTime = DEBUG_TIMING ? Date.now() : 0;
    // Choose card with highest heuristic score
    const bestCard = cardScores.reduce((a, b) =>
      a.heuristic > b.heuristic ? a : b
    );
    const selectDuration = DEBUG_TIMING ? Date.now() - selectStartTime : 0;
    
    if (DEBUG_TIMING) {
      const totalDuration = Date.now() - startTime;
      console.log(`[HeuristicSimpleAgent.makeMove] ${totalDuration}ms total (parse: ${parseDuration}ms, filter: ${filterDuration}ms, scoring: ${scoringDuration}ms, select: ${selectDuration}ms)`);
      console.log(`  - Valid cards: ${validPlayedCards.length}, Chose: ${bestCard.card} (score: ${bestCard.score}, heuristic: ${bestCard.heuristic})`);
    }
    
    return Promise.resolve(bestCard.card);
  }
}

