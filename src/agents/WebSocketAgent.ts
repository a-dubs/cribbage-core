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
  AgentDecisionType,
} from '../types';
import { parseCard } from '../core/scoring';
import { Socket } from 'socket.io';
import { getInvalidPeggingPlayReason, isValidDiscard } from '../core/utils';

export class WebSocketAgent implements GameAgent {
  playerId: string;
  socket: Socket;
  human = true;
  mostRecentRequest: EmittedMakeMoveRequest | EmittedDiscardRequest | null =
    null;
  lastGameState: GameState | null = null;
  lastPlayerId: string | null = null;

  constructor(socket: Socket, playerId: string) {
    this.socket = socket;
    this.playerId = playerId;
  }

  updateSocket(newSocket: Socket): void {
    if (this.socket) {
      // Clean up any event listeners that this agent attached to the old socket.
      // Adjust the event names if you've added additional listeners.
      this.socket.removeAllListeners('makeMoveResponse');
      this.socket.removeAllListeners('discardResponse');
      this.socket.removeAllListeners('disconnect');
    }
    // Update the socket reference to the new socket.
    this.socket = newSocket;
  }

  async discard(
    game: GameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    this.lastGameState = game;
    this.lastPlayerId = playerId;
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    // Helper: Wait until the current socket is connected.
    const waitForSocketConnected = async (): Promise<void> => {
      while (!this.socket.connected) {
        console.log(
          `[WebSocketAgent.discard] Waiting for socket to connect (current id: ${this.socket.id})`
        );
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      console.log('[WebSocketAgent.discard] Top of loop');
      await waitForSocketConnected();

      // Capture the current socket instance.
      const currentSocket = this.socket;

      try {
        const selectedCards = await new Promise<Card[]>((resolve, reject) => {
          const requestDiscard = () => {
            const discardRequestData: EmittedDiscardRequest = {
              requestType: AgentDecisionType.DISCARD,
              playerId: this.playerId,
              hand: player.hand,
              numberOfCardsToDiscard,
            };

            this.mostRecentRequest = discardRequestData;
            currentSocket.emit('discardRequest', discardRequestData);

            const onResponse = (response: EmittedDiscardResponse) => {
              cleanup();
              if (currentSocket !== this.socket) {
                return reject(new Error('socket replaced'));
              }
              if (response.playerId !== this.playerId) {
                return reject(
                  new Error(
                    `Received discard from wrong player: ${response.playerId}`
                  )
                );
              }
              if (isValidDiscard(game, player, response.selectedCards)) {
                this.mostRecentRequest = null;
                return resolve(response.selectedCards);
              }
              // Notify server of the invalid discard and reissue the request.
              currentSocket.emit('discardInvalid', {
                playerId: this.playerId,
                reason: 'Invalid discard',
                discardRequest: discardRequestData,
              } as EmittedDiscardInvalid);
              requestDiscard();
            };

            const onDisconnect = () => {
              cleanup();
              if (currentSocket !== this.socket) {
                return reject(new Error('socket replaced'));
              }
              reject(new Error('socket disconnected'));
            };

            const cleanup = () => {
              currentSocket.off('discardResponse', onResponse);
              currentSocket.off('disconnect', onDisconnect);
            };

            currentSocket.once('discardResponse', onResponse);
            currentSocket.once('disconnect', onDisconnect);
          };

          requestDiscard();
        });
        return selectedCards;
      } catch (err: any) {
        if (
          (err as Error).message === 'socket disconnected' ||
          (err as Error).message === 'socket replaced'
        ) {
          console.log(
            '[WebSocketAgent.discard] Socket replaced/disconnected. Retrying...'
          );
          await waitForSocketConnected();
          continue;
        }
        console.error('[WebSocketAgent.discard] Unexpected error:', err);
        throw err;
      }
    }
  }

  async makeMove(game: GameState, playerId: string): Promise<Card | null> {
    this.lastGameState = game;
    this.lastPlayerId = playerId;
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    // Helper: Wait until the current socket is connected.
    const waitForSocketConnected = async (): Promise<void> => {
      while (!this.socket.connected) {
        console.log(
          `[WebSocketAgent.makeMove] Waiting for socket to connect (current id: ${this.socket.id})`
        );
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      console.log('[WebSocketAgent.makeMove] Top of loop');
      await waitForSocketConnected();

      // Capture the current socket instance.
      const currentSocket = this.socket;

      try {
        const selectedCard = await new Promise<Card | null>(
          (resolve, reject) => {
            const requestMove = () => {
              const requestMakeMoveData: EmittedMakeMoveRequest = {
                requestType: AgentDecisionType.PLAY_CARD,
                playerId: this.playerId,
                peggingHand: player.peggingHand,
                peggingStack: game.peggingStack,
                playedCards: game.playedCards,
                peggingTotal: game.peggingStack.reduce(
                  (total, card) => total + parseCard(card).runValue,
                  0
                ),
              };

              this.mostRecentRequest = requestMakeMoveData;
              currentSocket.emit('requestMakeMove', requestMakeMoveData);

              const onResponse = (response: EmittedMakeMoveResponse) => {
                cleanup();
                if (currentSocket !== this.socket) {
                  return reject(new Error('socket replaced'));
                }
                if (response.playerId !== this.playerId) {
                  return reject(
                    new Error(
                      `Received move from wrong player: ${response.playerId}`
                    )
                  );
                }
                const invalidReason = getInvalidPeggingPlayReason(
                  game,
                  player,
                  response.selectedCard
                );
                if (invalidReason === null) {
                  this.mostRecentRequest = null;
                  return resolve(response.selectedCard);
                } else {
                  // Notify server of the invalid move and reissue the request.
                  currentSocket.emit('makeMoveInvalid', {
                    playerId: this.playerId,
                    reason: invalidReason,
                    makeMoveRequest: requestMakeMoveData,
                  } as EmittedMakeMoveInvalid);
                  requestMove();
                }
              };

              const onDisconnect = () => {
                cleanup();
                if (currentSocket !== this.socket) {
                  return reject(new Error('socket replaced'));
                }
                reject(new Error('socket disconnected'));
              };

              const cleanup = () => {
                currentSocket.off('makeMoveResponse', onResponse);
                currentSocket.off('disconnect', onDisconnect);
              };

              currentSocket.once('makeMoveResponse', onResponse);
              currentSocket.once('disconnect', onDisconnect);
            };

            requestMove();
          }
        );
        return selectedCard;
      } catch (err: any) {
        if (
          (err as Error).message === 'socket disconnected' ||
          (err as Error).message === 'socket replaced'
        ) {
          console.log(
            '[WebSocketAgent.makeMove] Socket replaced/disconnected. Retrying...'
          );
          await waitForSocketConnected();
          continue;
        } else {
          console.error('[WebSocketAgent.makeMove] Unexpected error:', err);
          throw err;
        }
      }
    }
  }
}
