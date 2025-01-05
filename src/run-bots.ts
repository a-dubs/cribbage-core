import { GameLoop } from './gameplay/GameLoop';
import { RandomAgent } from './agents/RandomAgent';
import { SimpleAgent } from './agents/SimpleAgent';
// import { HumanAgent } from './agents/HumanAgent';

async function main() {
  const gameLoop = new GameLoop(['bot-1', 'bot-2']);

  // Add a human player for Alice
  const botAgent1 = new RandomAgent('bot-1');
  gameLoop.addAgent('player-1', botAgent1);

  // Add a random agent for Bob
  const botAgent2 = new SimpleAgent('bot-2');
  gameLoop.addAgent('player-2', botAgent2);

  const result = await gameLoop.start();
  console.log('Winner: ' + result);
  const p1_score = gameLoop.game.getGameState().players[0].score;
  const p2_score = gameLoop.game.getGameState().players[1].score;
  console.log(`Player 1 score: ${p1_score}`);
  console.log(`Player 2 score: ${p2_score}`);
}

void (async () => {
  for (let i = 0; i < 10; i++) {
    await main();
  }
})();
