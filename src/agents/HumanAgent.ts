import readline from 'readline';
import { Card, Game, GameAgent } from '../types';
import { displayCard } from '../core/scoring';

// Utility function to prompt user input
export function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

// Human player agent
export class HumanAgent implements GameAgent {
  id: string;
  human = true;

  constructor(id: string) {
    this.id = id;
  }

  async discard(game: Game, playerId: string): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    console.log('Your hand:');
    player.hand.forEach((card, index) => {
      console.log(`${index + 1}: ${displayCard(card)}`);
    });

    const input = await promptUser(
      'Select 2 cards to discard (comma-separated numbers): '
    );
    const selectedIndices = input
      .split(',')
      .map(num => parseInt(num.trim()) - 1);

    // Validate the selected indices
    if (
      selectedIndices.length !== 2 ||
      !selectedIndices.every(index => index >= 0 && index < player.hand.length)
    ) {
      console.log('Invalid selection. Try again.');
      return this.discard(game, playerId); // Retry on invalid input
    }

    const selectedCards = selectedIndices.map(index => player.hand[index]);
    return selectedCards;
  }

  async makeMove(game: Game, playerId: string): Promise<Card> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    console.log('Your pegging hand:');
    player.peggingHand.forEach((card, index) => {
      console.log(`${index + 1}: ${displayCard(card)}`);
    });

    const input = await promptUser('Select a card to play (number): ');
    const selectedIndex = parseInt(input.trim()) - 1;

    // Validate the selected index
    if (selectedIndex < 0 || selectedIndex >= player.peggingHand.length) {
      console.log('Invalid card. Try again.');
      return this.makeMove(game, playerId); // Retry on invalid input
    }

    return player.peggingHand[selectedIndex];
  }
}
