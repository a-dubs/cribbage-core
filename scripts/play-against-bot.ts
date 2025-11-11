import { GameLoop } from '../src/gameplay/GameLoop';
import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import { HumanAgent } from './HumanAgent';
import { GameStatistics } from '../src/core/statistics';
import { GameEvent, PlayerIdAndName } from '../src/types';
import { scoreHand } from '../src/core/scoring';

interface PlayerStatistics {
  playerId: string;
  pointsFromPegging: number;
  avgHandScore: number;
  avgCribScore: number;
  maxHandScore: number;
  maxCribScore: number;
}

const playerStatistics: PlayerStatistics[] = [];

function printStatistics(playerId: string, gameHistory: GameEvent[]) {
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

  console.log(`Points from pegging: ${pointsFromPegging}`);
  console.log(`Average hand score: ${avgHandScore.toFixed(1)}`);
  console.log(`Average crib score: ${avgCribScore.toFixed(1)}`);
  console.log(`Max hand score: ${maxHandScore}`);
  console.log(`Max crib score: ${maxCribScore}`);
  console.log(`Scored "his heels": ${hisHeelsCount} times`);
  if (bestHand) {
    // log the best hand and the turn card using bestHand.hand and bestHand.turnCard
    console.log(
      `Best hand: ${bestHand.hand.join(', ')} with turn card ${
        bestHand.turnCard
      } for ${bestHand.score} (${scoreHand(
        bestHand.hand,
        bestHand.turnCard,
        false
      )}) points`
    );
  } else console.log('No best hand found');

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

async function main() {
  const playersInfo: PlayerIdAndName[] = [
    { id: 'player-XXX', name: 'Human Player' },
    { id: 'bot', name: 'Simple Bot' },
  ];
  const gameLoop = new GameLoop(playersInfo);

  // Add a human agent
  const humanAgent = new HumanAgent(playersInfo[0].id);
  gameLoop.addAgent(playersInfo[0].id, humanAgent);

  // Add a simple bot agent
  const simpleBotAgent = new ExhaustiveSimpleAgent();
  simpleBotAgent.playerId = playersInfo[1].id;
  gameLoop.addAgent(playersInfo[1].id, simpleBotAgent);

  // listen for gameEvent event emitted from the gameLoop

  const result = await gameLoop.playGame();

  // Extract game events from snapshot history
  const gameHistory = gameLoop.cribbageGame
    .getGameSnapshotHistory()
    .map(snapshot => snapshot.gameEvent);

  const NumberOfRounds = GameStatistics.numberOfRounds(gameHistory);
  console.log(`Winner: ${result} after ${NumberOfRounds} rounds`);
  const p1_score = gameLoop.cribbageGame.getGameState().players[0].score;
  const p2_score = gameLoop.cribbageGame.getGameState().players[1].score;
  console.log(`Player 1 score: ${p1_score}`);
  console.log(`Player 2 score: ${p2_score}`);

  const playerIds = gameLoop.cribbageGame.getGameState().players.map(p => p.id);
  // console.log('Game history: ', gameHistory);
  for (const playerId of playerIds) {
    console.log('\n------------------------------');
    console.log(`Player ${playerId} statistics:`);
    printStatistics(playerId, gameHistory);
  }
  console.log('\n----------------------------------------------------------\n');
}

void (async () => {
  for (let i = 0; i < 10; i++) {
    await main();
  }

  // Print out the player statistics
  console.log('Player statistics:');
  // get unique player ids
  const playerIds = [...new Set(playerStatistics.map(p => p.playerId))];
  for (const playerId of playerIds) {
    const stats = playerStatistics.filter(p => p.playerId === playerId);
    if (stats.length === 0) continue;

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = (arr: number[]) => Math.min(...arr);
    const max = (arr: number[]) => Math.max(...arr);

    const pointsFromPegging = stats.map(s => s.pointsFromPegging);
    const avgHandScore = stats.map(s => s.avgHandScore);
    const avgCribScore = stats.map(s => s.avgCribScore);
    const maxHandScore = stats.map(s => s.maxHandScore);
    const maxCribScore = stats.map(s => s.maxCribScore);

    console.log('\n------------------------------');
    console.log(`Player ${playerId}`);
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
})();
