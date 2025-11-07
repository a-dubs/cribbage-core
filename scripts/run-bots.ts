import { GameLoop } from '../src/gameplay/GameLoop';
import { RandomAgent } from '../src/agents/RandomAgent';
import { SimpleAgent } from '../src/agents/SimpleAgent';
// import { HumanAgent } from '../src/agents/HumanAgent';
import { GameStatistics } from '../src/core/statistics';
import { GameEvent, PlayerIdAndName } from '../src/types';
import { scoreHand } from '../src/core/scoring';
import * as fs from 'fs';
import * as path from 'path';

// Parse command line arguments
const numGames = parseInt(process.argv[2] || '10', 10);
if (isNaN(numGames) || numGames < 1) {
  console.error('Usage: node run-bots.js [number-of-games]');
  console.error('Example: node run-bots.js 2');
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
}

const playerStatistics: PlayerStatistics[] = [];

interface GameResult {
  gameNumber: number;
  winner: string;
  winnerName: string;
  scores: { playerId: string; playerName: string; score: number }[];
  rounds: number;
}

const gameResults: GameResult[] = [];
const winCounts: Record<string, number> = {};

function printStatistics(
  playerId: string,
  gameHistory: GameEvent[],
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

  logger.log(`Points from pegging: ${pointsFromPegging}`, toStdout);
  logger.log(`Average hand score: ${avgHandScore.toFixed(1)}`, toStdout);
  logger.log(`Average crib score: ${avgCribScore.toFixed(1)}`, toStdout);
  logger.log(`Max hand score: ${maxHandScore}`, toStdout);
  logger.log(`Max crib score: ${maxCribScore}`, toStdout);
  logger.log(`Scored "his heels": ${hisHeelsCount} times`, toStdout);
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

  // Store statistics
  playerStatistics.push({
    playerId,
    pointsFromPegging,
    avgHandScore,
    avgCribScore,
    maxHandScore,
    maxCribScore,
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

  const playersInfo: PlayerIdAndName[] = [
    { id: 'bot-1', name: 'Random Bot' },
    { id: 'bot-2', name: 'Simple Bot' },
  ];
  const gameLoop = new GameLoop(playersInfo);

  // Add a random bot agent
  const randomBotAgent = new RandomAgent();
  randomBotAgent.playerId = 'bot-1';
  gameLoop.addAgent('bot-1', randomBotAgent);

  // Add a simple bot agent
  const simpleBotAgent = new SimpleAgent();
  simpleBotAgent.playerId = 'bot-2';
  gameLoop.addAgent('bot-2', simpleBotAgent);

  const result = await gameLoop.playGame();

  // Extract game events from snapshot history
  const gameHistory = gameLoop.cribbageGame
    .getGameSnapshotHistory()
    .map(snapshot => snapshot.gameEvent);

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

  // Store game result
  const gameResult: GameResult = {
    gameNumber,
    winner: result,
    winnerName,
    scores,
    rounds: NumberOfRounds,
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
    printStatistics(playerId, gameHistory, false);
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
    console.log('------------------------------');
  }

  console.log(`\nDetailed logs saved to: ${logFile}`);
  logger.close();
})();
