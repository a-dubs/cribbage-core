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
  DecisionRequest,
  DecisionResponse,
  PlayCardResponse,
  DiscardResponse,
  DealResponse,
  CutDeckResponse,
  SelectDealerCardResponse,
  AcknowledgeResponse,
  GameSnapshot,
} from '../types';
import { parseCard } from '../core/scoring';
import { Socket } from 'socket.io';
import { getInvalidPeggingPlayReason, isValidDiscard } from '../core/utils';
import { logger } from '../utils/logger';

export class WebSocketAgent implements GameAgent {
  playerId: string;
  socket: Socket;
  human = true;
  mostRecentRequest: EmittedMakeMoveRequest | EmittedDiscardRequest | null =
    null;
  mostRecentGameSnapshot: GameSnapshot | null = null; // Track latest snapshot for finding pending requests

  constructor(socket: Socket, playerId: string) {
    this.socket = socket;
    this.playerId = playerId;
  }

  updateSocket(newSocket: Socket): void {
    if (this.socket && this.socket?.id !== newSocket.id) {
      logger.debug('[WebSocketAgent] Old socket id:', this.socket.id);
      // Clean up any event listeners that this agent attached to the old socket.
      // Remove all listeners to ensure no stale listeners remain
      this.socket.removeAllListeners('makeMoveResponse');
      this.socket.removeAllListeners('discardResponse');
      this.socket.removeAllListeners('decisionResponse');
      this.socket.removeAllListeners('disconnect');
      // Update the socket reference to the new socket.
      this.socket = newSocket;
      logger.debug('[WebSocketAgent] New socket id:', this.socket.id);
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
        logger.debug(
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
          let responseListener: ((response: any) => void) | null = null;
          let disconnectListener: (() => void) | null = null;

          const cleanup = () => {
            if (responseListener) {
              currentSocket.off(responseEvent, responseListener);
              responseListener = null;
            }
            if (disconnectListener) {
              currentSocket.off('disconnect', disconnectListener);
              disconnectListener = null;
            }
          };

          const request = () => {
            sendRequest(currentSocket);
            
            // Only set up listeners if they're not already set up
            if (!responseListener) {
              responseListener = (response: any) => {
                // Check if the socket instance is still the one we captured.
                if (currentSocket !== this.socket) {
                  cleanup();
                  return reject(new Error('socket replaced'));
                }
                const processed = processResponse(response);
                if (processed === 'retry') {
                  // Re-register disconnect listener for retry since .once() removes it after first use
                  if (disconnectListener) {
                    currentSocket.off('disconnect', disconnectListener);
                    disconnectListener = null;
                  }
                  return request();
                } else if (processed instanceof Error) {
                  // Check if this is a requestId mismatch - if so, ignore and keep listening
                  if (processed.message.includes('requestId mismatch')) {
                    logger.debug(
                      `[WebSocketAgent] Ignoring stale response with mismatched requestId`
                    );
                    return; // Don't cleanup, keep listening for the correct response
                  }
                  cleanup();
                  return reject(processed);
                } else {
                  cleanup();
                  return resolve(processed);
                }
              };
              currentSocket.on(responseEvent, responseListener);
            }

            if (!disconnectListener) {
              disconnectListener = () => {
                cleanup();
                if (currentSocket !== this.socket) {
                  return reject(new Error('socket replaced'));
                }
                reject(new Error('socket disconnected'));
              };
              currentSocket.once('disconnect', disconnectListener);
            }
          };
          request();
        });
        return result;
      } catch (err: any) {
        if (
          (err as Error).message === 'socket disconnected' ||
          (err as Error).message === 'socket replaced'
        ) {
          logger.debug(
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

  async makeMove(snapshot: GameSnapshot, playerId: string): Promise<Card | null> {
    const game = snapshot.gameState;
    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found.');
    if (playerId !== this.playerId) throw new Error('Invalid playerId.');

    // Find the pending request from snapshot
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.PLAY_CARD
    );
    if (!request) throw new Error('No pending PLAY_CARD request');

    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.PLAY_CARD) {
        return new Error('Invalid response type');
      }
      const playResponse = response as PlayCardResponse;
      const invalidReason = getInvalidPeggingPlayReason(
        game,
        player,
        playResponse.selectedCard
      );
      if (invalidReason === null) {
        return playResponse.selectedCard;
      } else {
        // Notify server and reissue the request.
        this.socket.emit('makeMoveInvalid', {
          playerId: this.playerId,
          reason: invalidReason,
          makeMoveRequest: request.requestData,
        } as EmittedMakeMoveInvalid);
        // Return 'retry' to allow the request to be reissued
        return 'retry' as any;
      }
    });
  }

  // --- Updated discard ---

  async discard(
    snapshot: GameSnapshot,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const game = snapshot.gameState;
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.DISCARD
    );
    if (!request) throw new Error('No pending DISCARD request');

    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.DISCARD) {
        return new Error('Invalid response type');
      }
      const discardResponse = response as DiscardResponse;
      const player = game.players.find(p => p.id === playerId);
      if (!player) throw new Error('Player not found.');
      if (isValidDiscard(game, player, discardResponse.selectedCards)) {
        return discardResponse.selectedCards;
      } else {
        // Notify server and reissue the request.
        this.socket.emit('discardInvalid', {
          playerId: this.playerId,
          reason: 'Invalid discard',
          discardRequest: request.requestData,
        } as EmittedDiscardInvalid);
        return new Error('Invalid discard');
      }
    });
  }

  // REMOVED: findPendingRequest() - no longer needed, requests come from snapshot parameter

  /**
   * Unified decision response handler
   * Waits for client to send decisionResponse event
   */
  private async waitForDecisionResponse<T>(
    request: DecisionRequest,
    responseHandler: (response: DecisionResponse) => T | Error
  ): Promise<T> {
    return this.makeWebsocketRequest<T>(
      'decisionResponse',
      currentSocket => {
        // Request is already in GameSnapshot.pendingDecisionRequests
        // Client will respond with decisionResponse event
      },
      (response: DecisionResponse) => {
        if (response.requestId !== request.requestId) {
          return new Error(`Response requestId mismatch`);
        }
        if (response.playerId !== this.playerId) {
          return new Error(`Response from wrong player`);
        }
        return responseHandler(response);
      }
    );
  }

  /**
   * Update the most recent game snapshot (called by server when receiving gameSnapshot events)
   */
  public updateGameSnapshot(snapshot: GameSnapshot): void {
    this.mostRecentGameSnapshot = snapshot;
  }

  // --- New agent methods ---

  async deal(snapshot: GameSnapshot, playerId: string): Promise<void> {
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.DEAL
    );
    if (!request) throw new Error('No pending DEAL request');

    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.DEAL) {
        return new Error('Invalid response type');
      }
      return;
    });
  }

  async cutDeck(
    snapshot: GameSnapshot,
    playerId: string,
    maxIndex: number
  ): Promise<number> {
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.CUT_DECK
    );
    if (!request) throw new Error('No pending CUT_DECK request');

    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.CUT_DECK) {
        return new Error('Invalid response type');
      }
      const cutResponse = response as CutDeckResponse;
      if (cutResponse.cutIndex < 0 || cutResponse.cutIndex > maxIndex) {
        return new Error(`Invalid cut index: ${cutResponse.cutIndex}`);
      }
      return cutResponse.cutIndex;
    });
  }

  async selectDealerCard(
    snapshot: GameSnapshot,
    playerId: string,
    maxIndex: number
  ): Promise<number> {
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.SELECT_DEALER_CARD
    );
    if (!request) throw new Error('No pending SELECT_DEALER_CARD request');

    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.SELECT_DEALER_CARD) {
        return new Error('Invalid response type');
      }
      const selectResponse = response as SelectDealerCardResponse;
      if (selectResponse.cardIndex < 0 || selectResponse.cardIndex > maxIndex) {
        return new Error(`Invalid card index: ${selectResponse.cardIndex}`);
      }
      return selectResponse.cardIndex;
    });
  }

  async acknowledgeReadyForGameStart(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.READY_FOR_GAME_START
    );
    if (!request) throw new Error('No pending READY_FOR_GAME_START request');

    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.READY_FOR_GAME_START) {
        return new Error('Invalid response type');
      }
      return;
    });
  }

  async acknowledgeReadyForCounting(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.READY_FOR_COUNTING
    );
    if (!request) throw new Error('No pending READY_FOR_COUNTING request');

    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.READY_FOR_COUNTING) {
        return new Error('Invalid response type');
      }
      return;
    });
  }

  async acknowledgeReadyForNextRound(
    snapshot: GameSnapshot,
    playerId: string
  ): Promise<void> {
    const request = snapshot.pendingDecisionRequests.find(
      r => r.playerId === playerId && r.decisionType === AgentDecisionType.READY_FOR_NEXT_ROUND
    );
    if (!request) throw new Error('No pending READY_FOR_NEXT_ROUND request');

    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.READY_FOR_NEXT_ROUND) {
        return new Error('Invalid response type');
      }
      return;
    });
  }
}
