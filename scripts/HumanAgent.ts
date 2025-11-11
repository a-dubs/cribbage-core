import readline from 'readline';
import { Card, GameState, GameAgent, DecisionRequest, DecisionResponse } from '../src/types';
import { displayCard, parseCard, sumOfPeggingStack } from '../src/core/scoring';
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

  async makeMove(game: GameState, playerId: string): Promise<Card | null> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    const requestMove = async (): Promise<Card | null> => {
      console.log('Your pegging hand:');
      player.peggingHand.forEach((card, index) => {
        console.log(`${index + 1}: ${displayCard(card)}`);
      });

      const input = await promptUser('Select a card to play (number, or "go" to pass): ');
      const trimmedInput = input.trim().toLowerCase();
      
      if (trimmedInput === 'go' || trimmedInput === 'g') {
        // Validate that "go" is allowed (only if no valid cards to play)
        if (!isValidPeggingPlay(game, player, null)) {
          const currentSum = sumOfPeggingStack(game.peggingStack);
          const validCards = player.peggingHand.filter(card => {
            const cardValue = parseCard(card).pegValue;
            return currentSum + cardValue <= 31;
          });
          console.log(`You have valid cards to play. Cannot say "Go".`);
          console.log(`Valid cards: ${validCards.map(c => displayCard(c)).join(', ')}`);
          return requestMove();
        }
        return null;
      }

      const selectedIndex = parseInt(trimmedInput) - 1;

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

  async respondToDecision(
    request: DecisionRequest,
    game: GameState
  ): Promise<DecisionResponse | null> {
    const { requestId, playerId, type, payload, minSelections, maxSelections } = request;

    switch (type) {
      case 'PLAY_CARD': {
        const card = await this.makeMove(game, playerId);
        return {
          requestId,
          playerId,
          type: 'PLAY_CARD',
          payload: card,
        };
      }

      case 'DISCARD': {
        const numToDiscard = minSelections && maxSelections === minSelections
          ? minSelections
          : 2;
        const cards = await this.discard(game, playerId, numToDiscard);
        return {
          requestId,
          playerId,
          type: 'DISCARD',
          payload: { cards },
        };
      }

      case 'CONTINUE': {
        const description = (payload as { description?: string } | undefined)?.description || 'Continue';
        await promptUser(`${description} (press Enter to continue): `);
        return {
          requestId,
          playerId,
          type: 'CONTINUE',
        };
      }

      case 'CUT_DECK': {
        const maxIndex = (payload as { maxIndex?: number } | undefined)?.maxIndex ?? 0;
        const input = await promptUser(`Cut the deck (enter index 0-${maxIndex}): `);
        const index = parseInt(input.trim());
        
        if (isNaN(index) || index < 0 || index > maxIndex) {
          console.log(`Invalid index. Using random index.`);
          const randomIndex = Math.floor(Math.random() * (maxIndex + 1));
          return {
            requestId,
            playerId,
            type: 'CUT_DECK',
            payload: { index: randomIndex },
          };
        }

        return {
          requestId,
          playerId,
          type: 'CUT_DECK',
          payload: { index },
        };
      }

      default:
        console.warn(`[HumanAgent] Unknown decision type: ${type}`);
        return null;
    }
  }
}
