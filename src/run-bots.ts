import { GameLoop } from './gameplay/GameLoop';
import { RandomAgent } from './agents/RandomAgent';
import { SimpleAgent } from './agents/SimpleAgent';
// import { HumanAgent } from './agents/HumanAgent';
import { GameStatistics } from './core/statistics';
import { GameState } from './types';
import { scoreHand } from './core/scoring';

function printStatistics(playerId: string, gameHistory: GameState[]) {
  // Calculate statistics
  const avgHandScore = GameStatistics.averageHandScore(playerId, gameHistory);
  const avgCribScore = GameStatistics.averageCribScore(playerId, gameHistory);
  const maxHandScore = GameStatistics.maximumHandScore(playerId, gameHistory);
  const maxCribScore = GameStatistics.maximumCribScore(playerId, gameHistory);
  const bestHand = GameStatistics.bestPlayedHand(playerId, gameHistory);
  const hisHeelsCount = GameStatistics.scoredHisHeels(playerId, gameHistory);

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
}

async function main() {
  const gameLoop = new GameLoop(['bot-1', 'bot-2']);

  // Add a human player for Alice
  const botAgent1 = new RandomAgent('bot-1');
  gameLoop.addAgent('player-1', botAgent1);

  // Add a random agent for Bob
  const botAgent2 = new SimpleAgent('bot-2');
  gameLoop.addAgent('player-2', botAgent2);

  const result = await gameLoop.start();

  const gameHistory = gameLoop.game.getGameState().gameStateLog;

  const NumberOfRounds = GameStatistics.numberOfRounds(gameHistory);
  console.log(`Winner: ${result} after ${NumberOfRounds} rounds`);
  const p1_score = gameLoop.game.getGameState().players[0].score;
  const p2_score = gameLoop.game.getGameState().players[1].score;
  console.log(`Player 1 score: ${p1_score}`);
  console.log(`Player 2 score: ${p2_score}`);

  const playerIds = gameLoop.game.getGameState().players.map(p => p.id);
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
})();
