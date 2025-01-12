import readline from 'readline';
import { Card, Game, GameAgent } from '../types';

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

    console.log(`Your hand: ${player.hand.join(', ')}`);
    const input = await promptUser(
      'Select 2 cards to discard (comma-separated): '
    );
    const selectedCards = input.split(',').map(card => card.trim() as Card);

    // Validate the selected cards
    if (
      selectedCards.length !== 2 ||
      !selectedCards.every(card => player.hand.includes(card))
    ) {
      console.log('Invalid selection. Try again.');
      return this.discard(game, playerId); // Retry on invalid input
    }

    return selectedCards;
  }

  async makeMove(game: Game, playerId: string): Promise<Card> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    console.log(`Your pegging hand: ${player.peggingHand.join(', ')}`);
    const input = await promptUser('Select a card to play: ');
    const selectedCard = input.trim() as Card;

    // Validate the selected card
    if (!player.peggingHand.includes(selectedCard)) {
      console.log('Invalid card. Try again.');
      return this.makeMove(game, playerId); // Retry on invalid input
    }

    return selectedCard;
  }
}
