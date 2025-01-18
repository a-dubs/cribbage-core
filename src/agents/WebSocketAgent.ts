import {
  Card,
  GameState,
  GameAgent,
  EmittedMakeMoveInvalid,
  EmittedMakeMoveResponse,
  EmittedMakeMoveRequest,
  EmittedDiscardRequest,
  EmittedDiscardInvalid,
  EmittedDiscardResponse,
} from '../types';
import { parseCard } from '../core/scoring';
import { Socket } from 'socket.io';
import { getInvalidPeggingPlayReason, isValidDiscard } from '../core/utils';

export class WebSocketAgent implements GameAgent {
  playerId: string;
  socket: Socket;
  human = true;

  constructor(socket: Socket, playerId: string) {
    this.socket = socket;
    this.playerId = playerId;
  }

  async discard(game: GameState, playerId: string): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    return new Promise(resolve => {
      const requestDiscard = () => {
        const discardRequestData: EmittedDiscardRequest = {
          playerId: this.playerId,
          hand: player.hand,
        };
        this.socket.emit('discardRequest', discardRequestData);

        this.socket.once(
          'discardResponse',
          (response: EmittedDiscardResponse) => {
            if (response.playerId !== this.playerId) {
              console.error(
                `Received discard from wrong player: ${response.playerId}`
              );
              throw new Error(
                'Received discard from wrong player: ' + response.playerId
              );
            }
            if (isValidDiscard(game, player, response.selectedCards)) {
              resolve(response.selectedCards);
            } else {
              const invalidDiscardResponse: EmittedDiscardInvalid = {
                playerId: this.playerId,
                reason: 'Invalid discard',
                discardRequest: discardRequestData,
              };
              this.socket.emit('discardInvalid', invalidDiscardResponse);
              requestDiscard();
            }
          }
        );
      };

      requestDiscard();
    });
  }

  async makeMove(game: GameState, playerId: string): Promise<Card> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    return new Promise(resolve => {
      const requestMove = () => {
        const requestMakeMoveData: EmittedMakeMoveRequest = {
          playerId: this.playerId,
          peggingHand: player.peggingHand,
          peggingStack: game.peggingStack,
          playedCards: game.playedCards,
          peggingTotal: game.peggingStack.reduce(
            (total, card) => total + parseCard(card).runValue,
            0
          ),
        };
        this.socket.emit('requestMakeMove', requestMakeMoveData);

        this.socket.once(
          'makeMoveResponse',
          (response: EmittedMakeMoveResponse) => {
            if (response.playerId !== this.playerId) {
              console.error(
                `Received move from wrong player: ${response.playerId}`
              );
              throw new Error(
                'Received move from wrong player: ' + response.playerId
              );
            }
            const invalidPeggingPlayReason = getInvalidPeggingPlayReason(
              game,
              player,
              response.selectedCard
            );
            if (invalidPeggingPlayReason === null) {
              resolve(response.selectedCard);
            } else {
              const invalidMoveResponse: EmittedMakeMoveInvalid = {
                playerId: this.playerId,
                reason: invalidPeggingPlayReason,
                makeMoveRequest: requestMakeMoveData,
              };
              this.socket.emit('makeMoveInvalid', invalidMoveResponse);
              requestMove();
            }
          }
        );
      };
      requestMove();
    });
  }
}
