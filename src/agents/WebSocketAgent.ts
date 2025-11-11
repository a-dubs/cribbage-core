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
  EmittedContinueResponse,
  EmittedContinueRequest,
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

  constructor(socket: Socket, playerId: string) {
    this.socket = socket;
    this.playerId = playerId;
  }

  updateSocket(newSocket: Socket): void {
    if (this.socket && this.socket?.id !== newSocket.id) {
      console.log('[WebSocketAgent] Old socket id:', this.socket.id);
      // Clean up any event listeners that this agent attached to the old socket.
      // Adjust the event names if you've added additional listeners.
      this.socket.removeAllListeners('makeMoveResponse');
      this.socket.removeAllListeners('discardResponse');
      this.socket.removeAllListeners('disconnect');
      // Update the socket reference to the new socket.
      this.socket = newSocket;
      console.log('[WebSocketAgent] New socket id:', this.socket.id);
    }
  }
  // In your WebSocketAgent class:

  private async makeWebsocketRequest<T>(
    responseEvent: string,
    sendRequest: (socket: Socket) => void,
    processResponse: (response: any) => T | 'retry' | Error
  ): Promise<T> {
    // Helper: Wait until the current socket is connected.
    const waitForSocketConnected = async (): Promise<void> => {
      while (!this.socket.connected) {
        console.log(
          `[WebSocketAgent] Waiting for socket to connect (current id: ${this.socket.id})`
        );
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await waitForSocketConnected();
      const currentSocket = this.socket;
      try {
        const result = await new Promise<T>((resolve, reject) => {
          const request = () => {
            sendRequest(currentSocket);
            const onResponse = (response: any) => {
              cleanup();
              // Check if the socket instance is still the one we captured.
              if (currentSocket !== this.socket) {
                return reject(new Error('socket replaced'));
              }
              const processed = processResponse(response);
              if (processed === 'retry') {
                return request();
              } else if (processed instanceof Error) {
                return reject(processed);
              } else {
                return resolve(processed);
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
              currentSocket.off(responseEvent, onResponse);
              currentSocket.off('disconnect', onDisconnect);
            };

            currentSocket.once(responseEvent, onResponse);
            currentSocket.once('disconnect', onDisconnect);
          };
          request();
        });
        return result;
      } catch (err: any) {
        if (
          (err as Error).message === 'socket disconnected' ||
          (err as Error).message === 'socket replaced'
        ) {
          console.log(
            `[WebSocketAgent] ${
              (err as Error).message
            }. Retrying request for event ${responseEvent}...`
          );
          await waitForSocketConnected();
          continue;
        } else {
          throw err;
        }
      }
    }
  }

  // --- Updated makeMove ---

  async makeMove(game: GameState, playerId: string): Promise<Card | null> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    let requestData: EmittedMakeMoveRequest;
    return this.makeWebsocketRequest<Card | null>(
      'makeMoveResponse',
      currentSocket => {
        requestData = {
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
        this.mostRecentRequest = requestData;
        currentSocket.emit('requestMakeMove', requestData);
      },
      (response: EmittedMakeMoveResponse) => {
        if (response.playerId !== this.playerId) {
          return new Error(
            `Received move from wrong player: ${response.playerId}`
          );
        }
        const invalidReason = getInvalidPeggingPlayReason(
          game,
          player,
          response.selectedCard
        );
        if (invalidReason === null) {
          this.mostRecentRequest = null;
          return response.selectedCard;
        } else {
          // Notify server and reissue the request.
          this.socket.emit('makeMoveInvalid', {
            playerId: this.playerId,
            reason: invalidReason,
            makeMoveRequest: requestData,
          } as EmittedMakeMoveInvalid);
          return 'retry';
        }
      }
    );
  }

  // --- Updated discard ---

  async discard(
    game: GameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    let requestData: EmittedDiscardRequest;
    return this.makeWebsocketRequest<Card[]>(
      'discardResponse',
      currentSocket => {
        requestData = {
          requestType: AgentDecisionType.DISCARD,
          playerId: this.playerId,
          hand: player.hand,
          numberOfCardsToDiscard,
        };
        this.mostRecentRequest = requestData;
        currentSocket.emit('discardRequest', requestData);
      },
      (response: EmittedDiscardResponse) => {
        if (response.playerId !== this.playerId) {
          return new Error(
            `Received discard from wrong player: ${response.playerId}`
          );
        }
        if (isValidDiscard(game, player, response.selectedCards)) {
          this.mostRecentRequest = null;
          return response.selectedCards;
        } else {
          // Notify server and reissue the request.
          this.socket.emit('discardInvalid', {
            playerId: this.playerId,
            reason: 'Invalid discard',
            discardRequest: requestData,
          } as EmittedDiscardInvalid);
          return 'retry';
        }
      }
    );
  }

  // --- Updated continue ---
  async waitForContinue(
    game: GameState,
    playerId: string,
    continueDescription: string
  ): Promise<void> {
    // send request to player and once a response is received, return
    return this.makeWebsocketRequest<void>(
      'continueResponse',
      currentSocket => {
        const requestData: EmittedContinueRequest = {
          requestType: AgentDecisionType.CONTINUE,
          playerId: this.playerId,
          description: continueDescription,
        };
        currentSocket.emit('continueRequest', requestData);
      },
      (response: EmittedContinueResponse) => {
        if (response.playerId !== this.playerId) {
          return new Error(
            `Received continue from wrong player: ${response.playerId}`
          );
        }
        return;
      }
    );
  }
}
