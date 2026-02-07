import { Server } from 'socket.io';
import { GameLoop } from '../gameplay/GameLoop';
import { GameSnapshot } from '../types';
import { logger } from '../utils/logger';
import { ConnectionManager } from './ConnectionManager';
import { LobbyManager } from './LobbyManager';
import { Lobby, PLAYER_DISCONNECT_GRACE_MS } from './types';

export interface DisconnectHandlerDependencies {
  io: Server;
  lobbyManager: LobbyManager;
  connectionManager: ConnectionManager;
  disconnectGraceTimeouts: Map<string, NodeJS.Timeout>;
  gameLoopsByLobbyId: Map<string, GameLoop>;
  mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot>;
  currentRoundGameEventsByLobbyId: Map<string, any[]>;
  roundStartSnapshotByLobbyId: Map<string, GameSnapshot>;
  supabaseGameIdByLobbyId: Map<string, string>;
  gameIdByLobbyId: Map<string, string>;
  currentGameBotIdsByLobbyId: Map<string, string[]>;
  cleanupBots: (lobbyId: string) => void;
}

/**
 * Handles player disconnect grace period logic and cleanup.
 * Manages timers for disconnected players and handles cleanup when grace period expires.
 */
export class DisconnectHandler {
  private readonly disconnectGraceTimeouts: Map<string, NodeJS.Timeout>;
  private readonly io: Server;
  private readonly lobbyManager: LobbyManager;
  private readonly connectionManager: ConnectionManager;
  private readonly gameLoopsByLobbyId: Map<string, GameLoop>;
  private readonly mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot>;
  private readonly currentRoundGameEventsByLobbyId: Map<string, any[]>;
  private readonly roundStartSnapshotByLobbyId: Map<string, GameSnapshot>;
  private readonly supabaseGameIdByLobbyId: Map<string, string>;
  private readonly gameIdByLobbyId: Map<string, string>;
  private readonly currentGameBotIdsByLobbyId: Map<string, string[]>;
  private readonly cleanupBots: (lobbyId: string) => void;

  constructor(deps: DisconnectHandlerDependencies) {
    this.io = deps.io;
    this.lobbyManager = deps.lobbyManager;
    this.connectionManager = deps.connectionManager;
    this.disconnectGraceTimeouts = deps.disconnectGraceTimeouts;
    this.gameLoopsByLobbyId = deps.gameLoopsByLobbyId;
    this.mostRecentGameSnapshotByLobbyId =
      deps.mostRecentGameSnapshotByLobbyId;
    this.currentRoundGameEventsByLobbyId = deps.currentRoundGameEventsByLobbyId;
    this.roundStartSnapshotByLobbyId = deps.roundStartSnapshotByLobbyId;
    this.supabaseGameIdByLobbyId = deps.supabaseGameIdByLobbyId;
    this.gameIdByLobbyId = deps.gameIdByLobbyId;
    this.currentGameBotIdsByLobbyId = deps.currentGameBotIdsByLobbyId;
    this.cleanupBots = deps.cleanupBots;
  }

  /**
   * Clear the disconnect timer for a player (if one exists)
   */
  clearPlayerDisconnectTimer(playerId: string): void {
    const timeout = this.disconnectGraceTimeouts.get(playerId);
    if (timeout) {
      clearTimeout(timeout);
      this.disconnectGraceTimeouts.delete(playerId);
    }
  }

  /**
   * Schedule a disconnect grace period timer for a player
   */
  schedulePlayerDisconnectTimer(lobbyId: string, playerId: string): void {
    this.clearPlayerDisconnectTimer(playerId);
    const timeout = setTimeout(() => {
      this.handleDisconnectGracePeriodExpired(playerId, lobbyId);
    }, PLAYER_DISCONNECT_GRACE_MS);
    this.disconnectGraceTimeouts.set(playerId, timeout);
  }

  /**
   * Handle when a player disconnects during an active game
   */
  handlePlayerInGameDisconnect(lobby: Lobby, playerId: string): void {
    if (!lobby.disconnectedPlayerIds.includes(playerId)) {
      lobby.disconnectedPlayerIds.push(playerId);
    }
    this.schedulePlayerDisconnectTimer(lobby.id, playerId);
    this.io.emit('lobbyUpdated', lobby);
    this.io.emit('playerDisconnectedFromLobby', {
      lobbyId: lobby.id,
      playerId,
      gracePeriodMs: PLAYER_DISCONNECT_GRACE_MS,
    });
  }

  /**
   * Handle when the disconnect grace period expires for a player
   */
  private handleDisconnectGracePeriodExpired(
    playerId: string,
    lobbyId: string
  ): void {
    this.disconnectGraceTimeouts.delete(playerId);
    const lobby = this.clearActiveGameArtifacts(lobbyId);
    if (!lobby) {
      return;
    }

    const wasTracked = lobby.disconnectedPlayerIds.includes(playerId);
    lobby.disconnectedPlayerIds = lobby.disconnectedPlayerIds.filter(
      id => id !== playerId
    );

    const playerIndex = lobby.players.findIndex(p => p.playerId === playerId);
    if (playerIndex !== -1) {
      lobby.players.splice(playerIndex, 1);
    }
    this.lobbyManager.removePlayerFromLobbyMapping(playerId);

    if (lobby.players.length === 0) {
      lobby.status = 'finished';
      lobby.finishedAt = Date.now();
      logger.warn(
        `[Disconnect] Lobby ${lobbyId} is now empty after grace expiry; closing lobby.`
      );
      this.io.emit('lobbyClosed', { lobbyId });
      return;
    }

    if (lobby.hostId === playerId) {
      lobby.hostId = lobby.players[0].playerId;
      logger.warn(
        `[Disconnect] Host ${playerId} dropped. Transferring host to ${lobby.hostId} for lobby ${lobbyId}.`
      );
    }

    if (wasTracked) {
      logger.warn(
        `[Disconnect] Grace period expired for player ${playerId} in lobby ${lobbyId}`
      );
    }

    lobby.status = 'waiting';
    lobby.finishedAt = null;
    this.io.emit('lobbyUpdated', lobby);
    this.io.emit('gameCancelledDueToDisconnect', {
      lobbyId,
      playerId,
      timeoutMs: PLAYER_DISCONNECT_GRACE_MS,
    });
  }

  /**
   * Clear all active game artifacts for a lobby
   */
  private clearActiveGameArtifacts(lobbyId: string): Lobby | undefined {
    const loop = this.gameLoopsByLobbyId.get(lobbyId);
    if (loop) {
      loop.cancel();
      loop.removeAllListeners();
      this.gameLoopsByLobbyId.delete(lobbyId);
    }

    this.mostRecentGameSnapshotByLobbyId.delete(lobbyId);
    this.currentRoundGameEventsByLobbyId.delete(lobbyId);
    this.roundStartSnapshotByLobbyId.delete(lobbyId);
    this.supabaseGameIdByLobbyId.delete(lobbyId);
    this.gameIdByLobbyId.delete(lobbyId);
    this.cleanupBots(lobbyId);

    const lobby = this.lobbyManager.getLobby(lobbyId);
    if (lobby) {
      lobby.disconnectedPlayerIds.forEach(playerId =>
        this.clearPlayerDisconnectTimer(playerId)
      );
    }

    return lobby;
  }

  /**
   * Handle socket disconnect event
   */
  handleSocketDisconnect(
    socketId: string,
    reason: string,
    emitConnectedPlayers: () => void
  ): void {
    logger.info(`A socket disconnected: ${socketId}, Reason: ${reason}`);
    const playerId = this.connectionManager.getPlayerId(socketId);

    if (playerId) {
      // If player is in a lobby, remove them and handle cleanup
      const lobbyId = this.lobbyManager.getLobbyIdForPlayer(playerId);
      if (lobbyId) {
        const lobby = this.lobbyManager.getLobby(lobbyId);
        if (lobby) {
          if (lobby.status === 'waiting') {
            // For waiting lobbies, don't remove players immediately on disconnect
            // They can reconnect and resume. Only remove if they explicitly leave or are kicked.
            // Keep the lobbyIdByPlayerId mapping so handleLogin can restore them
            logger.info(
              `Player ${playerId} disconnected from waiting lobby ${lobby.name} - keeping lobby membership for reconnection`
            );
            // Don't remove from lobby or delete mapping - let them reconnect
          } else if (lobby.status === 'in_progress') {
            logger.info(
              `Player ${playerId} disconnected during an active game in lobby ${lobby.name}`
            );
            this.handlePlayerInGameDisconnect(lobby, playerId);
          }
        }
      }

      // Only remove the player if they are not part of an active lobby game
      const playerLobbyId = this.lobbyManager.getLobbyIdForPlayer(playerId);
      const playerInActiveGame = playerLobbyId
        ? this.gameLoopsByLobbyId.has(playerLobbyId)
        : false;
      if (!playerInActiveGame) {
        this.connectionManager.deletePlayer(playerId);
        this.connectionManager.deleteSocketId(playerId);
        this.connectionManager.deletePlayerId(socketId);
        logger.info(`Removed player ${playerId} (socket ${socketId})`);
        // send updated connected players to all clients
        emitConnectedPlayers();
      } else {
        logger.info(
          'Player is part of an active game. Keeping player record for reconnection.'
        );
      }
    }
  }
}
