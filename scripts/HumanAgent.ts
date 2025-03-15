import readline from 'readline';
import { Card, GameState, GameAgent } from '../src/types';
import { displayCard } from '../src/core/scoring';
import { isValidDiscard, isValidPeggingPlay } from '../src/core/utils';

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
  playerId: string;
  human = true;

  constructor(id: string) {
    this.playerId = id;
  }

  async discard(
    game: GameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    const requestDiscard = async (): Promise<Card[]> => {
      console.log('Your hand:');
      player.hand.forEach((card, index) => {
        console.log(`${index + 1}: ${displayCard(card)}`);
      });

      const input = await promptUser(
        `Select ${numberOfCardsToDiscard} cards to discard (comma-separated numbers): `
      );
      const selectedIndices = input
        .split(',')
        .map(num => parseInt(num.trim()) - 1);

      if (
        selectedIndices.length !== numberOfCardsToDiscard ||
        !selectedIndices.every(
          index => index >= 0 && index < player.hand.length
        )
      ) {
        console.log('Invalid selection. Try again.');
        return requestDiscard();
      }

      const selectedCards = selectedIndices.map(index => player.hand[index]);
      if (isValidDiscard(game, player, selectedCards)) {
        return selectedCards;
      } else {
        console.log('Invalid discard. Try again.');
        return requestDiscard();
      }
    };

    return requestDiscard();
  }

  async makeMove(game: GameState, playerId: string): Promise<Card> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    const requestMove = async (): Promise<Card> => {
      console.log('Your pegging hand:');
      player.peggingHand.forEach((card, index) => {
        console.log(`${index + 1}: ${displayCard(card)}`);
      });

      const input = await promptUser('Select a card to play (number): ');
      const selectedIndex = parseInt(input.trim()) - 1;

      if (selectedIndex < 0 || selectedIndex >= player.peggingHand.length) {
        console.log('Invalid card. Try again.');
        return requestMove();
      }

      const selectedCard = player.peggingHand[selectedIndex];
      if (isValidPeggingPlay(game, player, selectedCard)) {
        return selectedCard;
      } else {
        console.log('[HumanAgent] Invalid move. Try again.');
        return requestMove();
      }
    };

    return requestMove();
  }
}
