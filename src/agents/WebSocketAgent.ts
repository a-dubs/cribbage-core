import { Card, Game, GameAgent } from '../types';
import { displayCard, parseCard } from '../core/scoring';
import { Socket } from 'socket.io';
import { isValidDiscard, isValidPeggingPlay } from '../core/utils';

export class WebSocketAgent implements GameAgent {
  id: string;
  socket: Socket;
  human = true;

  constructor(socket: Socket, id: string) {
    this.socket = socket;
    this.id = id;
  }

  async discard(game: Game, playerId: string): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    return new Promise(resolve => {
      const requestDiscard = () => {
        this.socket.emit('discard', {
          hand: player.hand.map(displayCard),
        });

        this.socket.once('discardResponse', (selectedCards: Card[]) => {
          if (isValidDiscard(game, player, selectedCards)) {
            resolve(selectedCards);
          } else {
            this.socket.emit('discardInvalid', { reason: 'Invalid discard' });
            requestDiscard();
          }
        });
      };

      requestDiscard();
    });
  }

  async makeMove(game: Game, playerId: string): Promise<Card> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');

    return new Promise(resolve => {
      const requestMove = () => {
        this.socket.emit('makeMove', {
          peggingHand: player.peggingHand.map(displayCard),
          peggingStack: game.peggingStack.map(displayCard),
          playedCards: game.playedCards.map(pc => ({
            playerId: pc.playerId,
            card: displayCard(pc.card),
          })),
          peggingTotal: game.peggingStack.reduce(
            (total, card) => total + parseCard(card).runValue,
            0
          ),
        });

        this.socket.once('makeMoveResponse', (selectedCard: Card) => {
          if (isValidPeggingPlay(game, player, selectedCard)) {
            resolve(selectedCard);
          } else {
            this.socket.emit('makeMoveInvalid', { reason: 'Invalid move' });
            requestMove();
          }
        });
      };

      requestMove();
    });
  }
}
