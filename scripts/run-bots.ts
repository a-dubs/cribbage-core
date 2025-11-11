import { GameLoop } from '../src/gameplay/GameLoop';
import { RandomAgent } from '../src/agents/RandomAgent';
import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import { HeuristicSimpleAgent } from '../src/agents/HeuristicSimpleAgent';
import {
  RandomDelaySimpleAgent,
  Fixed500msSimpleAgent,
  Fixed200msSimpleAgent,
} from '../src/agents/DelayedSimpleAgent';
// import { HumanAgent } from '../src/agents/HumanAgent';
import { GameStatistics } from '../src/core/statistics';
import { GameEvent, PlayerIdAndName, ActionType, GameAgent } from '../src/types';
import { scoreHand } from '../src/core/scoring';
import * as fs from 'fs';
import * as path from 'path';

// Parse command line arguments
// Usage: node run-bots.js [number-of-games] [agent-type-1] [agent-type-2]
// Agent types: 'random', 'exhaustive-simple', 'heuristic-simple', 'random-delay', 'fixed-500ms', 'fixed-200ms'
// Default: 10 games, 'random' vs 'exhaustive-simple'
// Note: 'exhaustive-simple' = exhaustive simulation (slow but optimal), 'heuristic-simple' = fast heuristic-based
const numGames = parseInt(process.argv[2] || '10', 10);
const agentType1 = process.argv[3] || 'random';
const agentType2 = process.argv[4] || 'exhaustive-simple';

if (isNaN(numGames) || numGames < 1) {
  console.error('Usage: node run-bots.js [number-of-games] [agent-type-1] [agent-type-2]');
  console.error('Example: node run-bots.js 2 random exhaustive-simple');
  console.error('Example: node run-bots.js 2 exhaustive-simple heuristic-simple');
  console.error('Example: node run-bots.js 2 fixed-500ms random-delay');
  console.error('Agent types: random, exhaustive-simple, heuristic-simple, random-delay, fixed-500ms, fixed-200ms');
  console.error('  - exhaustive-simple: Exhaustive simulation (slow but optimal)');
  console.error('  - heuristic-simple: Fast heuristic-based (fast but approximate)');
  process.exit(1);
}

// Create log file with timestamp
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logDir, `bots-test-${timestamp}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Logger that writes to both file and optionally stdout
const logger = {
  log: (message: string, toStdout = false) => {
    const logMessage = `[${new Date().toISOString()}] ${message}\n`;
    logStream.write(logMessage);
    if (toStdout) {
      console.log(message);
    }
  },
  close: () => {
    logStream.end();
  },
};

// Override console.log to write to log file (but keep some output to stdout)
const originalConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  const message = args.map(arg => String(arg)).join(' ');
  logStream.write(`[${new Date().toISOString()}] ${message}\n`);
};

// keep track of how each player performs in the game
// - points scored
// - average hand score
// - average crib score
// - max hand score
// - max crib score
// - points from pegging
// then print out the average, min, and max for each player per stat above

interface PlayerStatistics {
  playerId: string;
  pointsFromPegging: number;
  avgHandScore: number;
  avgCribScore: number;
  maxHandScore: number;
  maxCribScore: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  firstResponseCount: number;
}

const playerStatistics: PlayerStatistics[] = [];

interface ResponseTime {
  playerId: string;
  decisionType: string;
  requestTime: Date;
  responseTime: Date;
  durationMs: number;
}

interface GameResult {
  gameNumber: number;
  winner: string;
  winnerName: string;
  scores: { playerId: string; playerName: string; score: number }[];
  rounds: number;
  gameHistory: GameEvent[];
  responseTimes: ResponseTime[];
}

const gameResults: GameResult[] = [];
const winCounts: Record<string, number> = {};

function printStatistics(
  playerId: string,
  gameHistory: GameEvent[],
  responseTimes: ResponseTime[],
  toStdout = false
) {
  // Calculate statistics
  const pointsFromPegging = GameStatistics.pointsFromPegging(
    playerId,
    gameHistory
  );
  const avgHandScore = GameStatistics.averageHandScore(playerId, gameHistory);
  const avgCribScore = GameStatistics.averageCribScore(playerId, gameHistory);
  const maxHandScore = GameStatistics.maximumHandScore(playerId, gameHistory);
  const maxCribScore = GameStatistics.maximumCribScore(playerId, gameHistory);
  const bestHand = GameStatistics.bestPlayedHand(playerId, gameHistory);
  const hisHeelsCount = GameStatistics.scoredHisHeels(playerId, gameHistory);

  // Count decision requests by counting actual actions (DEAL, DISCARD, PLAY_CARD)
  // Note: CONTINUE doesn't have a corresponding action type, so we can't count it
  const dealRequests = gameHistory.filter(
    e => e.playerId === playerId && e.actionType === ActionType.DEAL
  ).length;
  const discardRequests = gameHistory.filter(
    e => e.playerId === playerId && e.actionType === ActionType.DISCARD
  ).length;
  const playCardRequests = gameHistory.filter(
    e => e.playerId === playerId && e.actionType === ActionType.PLAY_CARD
  ).length;

  logger.log(`Points from pegging: ${pointsFromPegging}`, toStdout);
  logger.log(`Average hand score: ${avgHandScore.toFixed(1)}`, toStdout);
  logger.log(`Average crib score: ${avgCribScore.toFixed(1)}`, toStdout);
  logger.log(`Max hand score: ${maxHandScore}`, toStdout);
  logger.log(`Max crib score: ${maxCribScore}`, toStdout);
  logger.log(`Scored "his heels": ${hisHeelsCount} times`, toStdout);
  logger.log(
    `Player actions: DEAL=${dealRequests}, DISCARD=${discardRequests}, PLAY_CARD=${playCardRequests}`,
    toStdout
  );

  // Calculate response time statistics for this player
  const playerResponseTimes = responseTimes.filter(rt => rt.playerId === playerId);
  if (playerResponseTimes.length > 0) {
    const avgResponseTime =
      playerResponseTimes.reduce((sum, rt) => sum + rt.durationMs, 0) /
      playerResponseTimes.length;
    const minResponseTime = Math.min(...playerResponseTimes.map(rt => rt.durationMs));
    const maxResponseTime = Math.max(...playerResponseTimes.map(rt => rt.durationMs));
    logger.log(
      `Response times: avg=${avgResponseTime.toFixed(0)}ms, min=${minResponseTime}ms, max=${maxResponseTime}ms`,
      toStdout
    );
  }

  if (bestHand) {
    // log the best hand and the turn card using bestHand.hand and bestHand.turnCard
    logger.log(
      `Best hand: ${bestHand.hand.join(', ')} with turn card ${
        bestHand.turnCard
      } for ${bestHand.score} (${scoreHand(
        bestHand.hand,
        bestHand.turnCard,
        false
      )}) points`,
      toStdout
    );
  } else logger.log('No best hand found', toStdout);

  // Calculate response time statistics for storing
  const avgResponseTime =
    playerResponseTimes.length > 0
      ? playerResponseTimes.reduce((sum, rt) => sum + rt.durationMs, 0) /
        playerResponseTimes.length
      : 0;
  const minResponseTime =
    playerResponseTimes.length > 0
      ? Math.min(...playerResponseTimes.map(rt => rt.durationMs))
      : 0;
  const maxResponseTime =
    playerResponseTimes.length > 0
      ? Math.max(...playerResponseTimes.map(rt => rt.durationMs))
      : 0;

  // Store statistics
  playerStatistics.push({
    playerId,
    pointsFromPegging,
    avgHandScore,
    avgCribScore,
    maxHandScore,
    maxCribScore,
    avgResponseTime,
    minResponseTime,
    maxResponseTime,
    firstResponseCount: 0, // Will be calculated in aggregate stats
  });
}

async function main(gameNumber: number, totalGames: number): Promise<GameResult> {
  // Add massive separator in log file (5 rows above and 5 rows below header)
  const separator = '\n' + 
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    `GAME ${gameNumber} OF ${totalGames}`.padStart(50 + `GAME ${gameNumber} OF ${totalGames}`.length / 2).padEnd(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n';
  logStream.write(separator);
  
  logger.log(`\n=== Starting Game ${gameNumber}/${totalGames} ===`, true);
  logger.log(`Agent 1: ${agentType1}, Agent 2: ${agentType2}`, true);

  // Create agent instances based on type
  function createAgent(type: string, playerId: string): GameAgent {
    let agent: GameAgent;
    let name: string;
    
    switch (type) {
      case 'random':
        agent = new RandomAgent();
        name = 'Random Bot';
        break;
      case 'exhaustive-simple':
        agent = new ExhaustiveSimpleAgent();
        name = 'Exhaustive Simple Bot';
        break;
      case 'heuristic-simple':
        agent = new HeuristicSimpleAgent();
        name = 'Heuristic Simple Bot';
        break;
      case 'random-delay':
        agent = new RandomDelaySimpleAgent();
        name = 'Random Delay Bot (250-1000ms)';
        break;
      case 'fixed-500ms':
        agent = new Fixed500msSimpleAgent();
        name = 'Fixed 500ms Bot';
        break;
      case 'fixed-200ms':
        agent = new Fixed200msSimpleAgent();
        name = 'Fixed 200ms Bot';
        break;
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
    
    agent.playerId = playerId;
    return agent;
  }

  const agent1 = createAgent(agentType1, 'bot-1');
  const agent2 = createAgent(agentType2, 'bot-2');
  
  const agent1Name = agentType1 === 'random' ? 'Random Bot' :
                     agentType1 === 'exhaustive-simple' ? 'Exhaustive Simple Bot' :
                     agentType1 === 'heuristic-simple' ? 'Heuristic Simple Bot' :
                     agentType1 === 'random-delay' ? 'Random Delay Bot (250-1000ms)' :
                     agentType1 === 'fixed-500ms' ? 'Fixed 500ms Bot' :
                     'Fixed 200ms Bot';
  
  const agent2Name = agentType2 === 'random' ? 'Random Bot' :
                     agentType2 === 'exhaustive-simple' ? 'Exhaustive Simple Bot' :
                     agentType2 === 'heuristic-simple' ? 'Heuristic Simple Bot' :
                     agentType2 === 'random-delay' ? 'Random Delay Bot (250-1000ms)' :
                     agentType2 === 'fixed-500ms' ? 'Fixed 500ms Bot' :
                     'Fixed 200ms Bot';

  const playersInfo: PlayerIdAndName[] = [
    { id: 'bot-1', name: agent1Name },
    { id: 'bot-2', name: agent2Name },
  ];
  const gameLoop = new GameLoop(playersInfo);

  gameLoop.addAgent('bot-1', agent1);
  gameLoop.addAgent('bot-2', agent2);

  const result = await gameLoop.playGame();

  // Extract game events from snapshot history
  const gameHistory = gameLoop.cribbageGame
    .getGameSnapshotHistory()
    .map(snapshot => snapshot.gameEvent);

  // Response time tracking removed - WAITING_FOR_* events no longer exist
  // Response times would need to be tracked differently (e.g., from GameState.waitingForPlayers snapshots)
  const responseTimes: ResponseTime[] = [];

  // read in game-history.json from project root and append gameHistory to it
  const filePath = '/Users/a-dubs/personal/cribbage/game-history.json';
  let existingHistory: GameEvent[] = [];

  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    existingHistory = JSON.parse(fileContent);
  }

  existingHistory.push(...gameHistory);

  fs.writeFileSync(filePath, JSON.stringify(existingHistory, null, 2));

  const NumberOfRounds = GameStatistics.numberOfRounds(gameHistory);
  const gameState = gameLoop.cribbageGame.getGameState();
  const scores = gameState.players.map(p => ({
    playerId: p.id,
    playerName: p.name,
    score: p.score,
  }));

  const winnerName = playersInfo.find(p => p.id === result)?.name || result;

  // Track win count
  if (!winCounts[result]) {
    winCounts[result] = 0;
  }
  winCounts[result] += 1;

  // Store game result with response times
  const gameResult: GameResult = {
    gameNumber,
    winner: result,
    winnerName,
    scores,
    rounds: NumberOfRounds,
    gameHistory,
    responseTimes,
  };
  gameResults.push(gameResult);

  // Print summary to stdout
  logger.log(
    `Game ${gameNumber}: Winner: ${winnerName} (${result}) after ${NumberOfRounds} rounds (${scores[0].score}-${scores[1].score})`,
    true
  );

  const playerIds = gameLoop.cribbageGame.getGameState().players.map(p => p.id);
  // Detailed stats go to log file only
  for (const playerId of playerIds) {
    logger.log('\n------------------------------');
    logger.log(`Player ${playerId} statistics:`);
    printStatistics(playerId, gameHistory, responseTimes, false);
  }
  
  // Add massive separator at end of game in log file (5 rows above and 5 rows below header)
  const endSeparator = '\n' + 
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    `END OF GAME ${gameNumber}`.padStart(50 + `END OF GAME ${gameNumber}`.length / 2).padEnd(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n' +
    '='.repeat(100) + '\n\n';
  logStream.write(endSeparator);
  
  logger.log('\n----------------------------------------------------------\n');

  return gameResult;
}

void (async () => {
  logger.log(`Starting bots test with ${numGames} game(s)`, true);
  logger.log(`Log file: ${logFile}`, true);
  logger.log('');

  for (let i = 0; i < numGames; i++) {
    await main(i + 1, numGames);
  }

  // Restore original console.log for final output
  console.log = originalConsoleLog;

  // Print game history summary
  console.log('\n=== Game History Summary ===');
  for (const result of gameResults) {
    const scoreStr = result.scores
      .map(s => `${s.playerName}: ${s.score}`)
      .join(' vs ');
    const winnerIndicator = result.scores
      .map(s => (s.playerId === result.winner ? '★' : ' '))
      .join(' ');
    console.log(
      `• Game ${result.gameNumber}: ${scoreStr} (${result.rounds} rounds) ${winnerIndicator} Winner: ${result.winnerName}`
    );
  }

  // Print out the player statistics to stdout
  console.log('\n=== Aggregate Statistics ===');
  // get unique player ids
  const playerIds = [...new Set(playerStatistics.map(p => p.playerId))];
  for (const playerId of playerIds) {
    const stats = playerStatistics.filter(p => p.playerId === playerId);
    if (stats.length === 0) continue;

    const playerName =
      gameResults[0]?.scores.find(s => s.playerId === playerId)?.playerName ||
      playerId;
    const wins = winCounts[playerId] || 0;
    const winPercentage = ((wins / numGames) * 100).toFixed(1);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = (arr: number[]) => Math.min(...arr);
    const max = (arr: number[]) => Math.max(...arr);

    const pointsFromPegging = stats.map(s => s.pointsFromPegging);
    const avgHandScore = stats.map(s => s.avgHandScore);
    const avgCribScore = stats.map(s => s.avgCribScore);
    const maxHandScore = stats.map(s => s.maxHandScore);
    const maxCribScore = stats.map(s => s.maxCribScore);

    console.log('\n------------------------------');
    console.log(`Player: ${playerName} (${playerId})`);
    console.log(`Wins: ${wins}/${numGames} (${winPercentage}%)`);
    console.log(
      `Points from pegging: avg: ${avg(pointsFromPegging).toFixed(
        1
      )}, min: ${min(pointsFromPegging)}, max: ${max(pointsFromPegging)}`
    );
    console.log(
      `Average hand score: avg: ${avg(avgHandScore).toFixed(1)}, min: ${min(
        avgHandScore
      ).toFixed(1)}, max: ${max(avgHandScore).toFixed(1)}`
    );
    console.log(
      `Average crib score: avg: ${avg(avgCribScore).toFixed(1)}, min: ${min(
        avgCribScore
      ).toFixed(1)}, max: ${max(avgCribScore).toFixed(1)}`
    );
    console.log(
      `Max hand score: avg: ${avg(maxHandScore)}, min: ${min(
        maxHandScore
      )}, max: ${max(maxHandScore)}`
    );
    console.log(
      `Max crib score: avg: ${avg(maxCribScore)}, min: ${min(
        maxCribScore
      )}, max: ${max(maxCribScore)}`
    );
    
    // Player action statistics (aggregate across all games)
    // Count actual actions instead of decision requests (WAITING_FOR_* events no longer exist)
    const allActions = gameResults.flatMap(r => r.gameHistory).filter(
      e => e.playerId === playerId
    );
    const dealReqs = allActions.filter(e => e.actionType === ActionType.DEAL).length;
    const discardReqs = allActions.filter(e => e.actionType === ActionType.DISCARD).length;
    const playCardReqs = allActions.filter(e => e.actionType === ActionType.PLAY_CARD).length;
    console.log(
      `Player actions: DEAL=${dealReqs}, DISCARD=${discardReqs}, PLAY_CARD=${playCardReqs}`
    );

    // Response time statistics (aggregate across all games)
    const allResponseTimes = gameResults.flatMap(r =>
      r.responseTimes.filter(rt => rt.playerId === playerId)
    );
    if (allResponseTimes.length > 0) {
      const avgResponseTime =
        allResponseTimes.reduce((sum, rt) => sum + rt.durationMs, 0) /
        allResponseTimes.length;
      const minResponseTime = Math.min(...allResponseTimes.map(rt => rt.durationMs));
      const maxResponseTime = Math.max(...allResponseTimes.map(rt => rt.durationMs));
      console.log(
        `Response times: avg: ${avgResponseTime.toFixed(0)}ms, min: ${minResponseTime}ms, max: ${maxResponseTime}ms`
      );
      
      // Breakdown by decision type
      const byDecisionType: Record<string, ResponseTime[]> = {};
      for (const rt of allResponseTimes) {
        if (!byDecisionType[rt.decisionType]) {
          byDecisionType[rt.decisionType] = [];
        }
        byDecisionType[rt.decisionType].push(rt);
      }
      
      // Response time breakdown by decision type removed - WAITING_FOR_* events no longer exist
      // Would need to track decision types differently to restore this feature
      
      const breakdowns: string[] = [];
      for (const [decisionType, times] of Object.entries(byDecisionType)) {
        const avg = times.reduce((sum, rt) => sum + rt.durationMs, 0) / times.length;
        const min = Math.min(...times.map(rt => rt.durationMs));
        const max = Math.max(...times.map(rt => rt.durationMs));
        const name = decisionTypeNames[decisionType] || decisionType;
        breakdowns.push(`${name}: avg=${avg.toFixed(0)}ms (min=${min}ms, max=${max}ms, count=${times.length})`);
      }
      if (breakdowns.length > 0) {
        console.log(`  Breakdown: ${breakdowns.join(', ')}`);
      }
    }

    console.log('------------------------------');
  }

  console.log(`\nDetailed logs saved to: ${logFile}`);
  logger.close();
})();
