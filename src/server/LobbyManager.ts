import { Server, Socket } from 'socket.io';
import { GameLoop } from '../gameplay/GameLoop';
import { GameSnapshot, GameEvent } from '../types';
import { ConnectionManager } from './ConnectionManager';
import {
  createLobby,
  getPlayerActiveLobbyId,
  joinLobby as joinLobbyInSupabase,
  leaveLobby as leaveLobbyInSupabase,
  listLobbies as listLobbiesFromSupabase,
  removeLobbyPlayer,
  updateLobbyName,
  updateLobbySize,
  getServiceClient,
  type LobbyPayload,
} from '../services/supabaseService';
import { logger } from '../utils/logger';
import {
  uniqueNamesGenerator,
  adjectives,
  animals,
} from 'unique-names-generator';
import {
  Lobby,
  STALE_WAITING_LOBBY_MS,
  STALE_IN_PROGRESS_LOBBY_MS,
  FINISHED_LOBBY_TTL_MS,
  FINISHED_LOBBY_SWEEP_INTERVAL_MS,
} from './types';

export interface LobbyManagerDependencies {
  io: Server;
  connectionManager: ConnectionManager;
  disconnectGraceTimeouts: Map<string, NodeJS.Timeout>;
  gameLoopsByLobbyId: Map<string, GameLoop>;
  mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot>;
  currentRoundGameEventsByLobbyId: Map<string, GameEvent[]>;
  roundStartSnapshotByLobbyId: Map<string, GameSnapshot>;
  supabaseGameIdByLobbyId: Map<string, string>;
  currentGameBotIdsByLobbyId: Map<string, string[]>;
  cleanupBots: (lobbyId: string) => void;
  clearPlayerDisconnectTimer: (playerId: string) => void;
  lobbyFromSupabase: (payload: any) => Lobby;
  SUPABASE_LOBBIES_ENABLED: boolean;
}

export class LobbyManager {
  private readonly io: Server;
  private readonly connectionManager: ConnectionManager;
  private readonly disconnectGraceTimeouts: Map<string, NodeJS.Timeout>;
  private readonly gameLoopsByLobbyId: Map<string, GameLoop>;
  private readonly mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot>;
  private readonly currentRoundGameEventsByLobbyId: Map<string, GameEvent[]>;
  private readonly roundStartSnapshotByLobbyId: Map<string, GameSnapshot>;
  private readonly supabaseGameIdByLobbyId: Map<string, string>;
  private readonly currentGameBotIdsByLobbyId: Map<string, string[]>;
  private readonly cleanupBots: (lobbyId: string) => void;
  private readonly clearPlayerDisconnectTimer: (playerId: string) => void;
  private readonly lobbyFromSupabase: (payload: any) => Lobby;
  private readonly SUPABASE_LOBBIES_ENABLED: boolean;

  // Lobby state maps
  private readonly lobbiesById: Map<string, Lobby> = new Map();
  private readonly lobbyIdByPlayerId: Map<string, string> = new Map();

  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(deps: LobbyManagerDependencies) {
    this.io = deps.io;
    this.connectionManager = deps.connectionManager;
    this.disconnectGraceTimeouts = deps.disconnectGraceTimeouts;
    this.gameLoopsByLobbyId = deps.gameLoopsByLobbyId;
    this.mostRecentGameSnapshotByLobbyId = deps.mostRecentGameSnapshotByLobbyId;
    this.currentRoundGameEventsByLobbyId = deps.currentRoundGameEventsByLobbyId;
    this.roundStartSnapshotByLobbyId = deps.roundStartSnapshotByLobbyId;
    this.supabaseGameIdByLobbyId = deps.supabaseGameIdByLobbyId;
    this.currentGameBotIdsByLobbyId = deps.currentGameBotIdsByLobbyId;
    this.cleanupBots = deps.cleanupBots;
    this.clearPlayerDisconnectTimer = deps.clearPlayerDisconnectTimer;
    this.lobbyFromSupabase = deps.lobbyFromSupabase;
    this.SUPABASE_LOBBIES_ENABLED = deps.SUPABASE_LOBBIES_ENABLED;

    // Start cleanup timer
    this.cleanupInterval = setInterval(
      () => this.cleanupFinishedLobbies(),
      FINISHED_LOBBY_SWEEP_INTERVAL_MS
    );
  }

  /**
   * Stop the cleanup interval timer (useful for testing or shutdown)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get lobby by ID
   */
  getLobby(lobbyId: string): Lobby | undefined {
    return this.lobbiesById.get(lobbyId);
  }

  /**
   * Get lobby ID for a player
   */
  getLobbyIdForPlayer(playerId: string): string | undefined {
    return this.lobbyIdByPlayerId.get(playerId);
  }

  /**
   * Remove a player from the lobby mapping (used for disconnect cleanup)
   */
  removePlayerFromLobbyMapping(playerId: string): void {
    this.lobbyIdByPlayerId.delete(playerId);
  }

  /**
   * Get all lobbies
   */
  getAllLobbies(): Map<string, Lobby> {
    return this.lobbiesById;
  }

  /**
   * Cache a lobby from Supabase payload
   */
  cacheLobbyFromPayload(payload: LobbyPayload): Lobby {
    const mapped = this.lobbyFromSupabase(payload);
    const playerIds = new Set(mapped.players.map(p => p.playerId));
    mapped.players.forEach(p =>
      this.lobbyIdByPlayerId.set(p.playerId, mapped.id)
    );
    // Collect entries to delete first to avoid modifying Map during iteration
    const playerIdsToDelete: string[] = [];
    for (const [playerId, lobbyId] of this.lobbyIdByPlayerId.entries()) {
      if (lobbyId === mapped.id && !playerIds.has(playerId)) {
        playerIdsToDelete.push(playerId);
      }
    }
    // Delete collected entries after iteration completes
    playerIdsToDelete.forEach(playerId =>
      this.lobbyIdByPlayerId.delete(playerId)
    );
    this.lobbiesById.set(mapped.id, mapped);
    return mapped;
  }

  /**
   * Remove lobby from cache
   */
  removeLobbyFromCache(lobbyId: string): void {
    const lobby = this.lobbiesById.get(lobbyId);
    if (lobby) {
      lobby.players.forEach(player => {
        if (this.lobbyIdByPlayerId.get(player.playerId) === lobbyId) {
          this.lobbyIdByPlayerId.delete(player.playerId);
        }
      });
    }
    this.lobbiesById.delete(lobbyId);
  }

  /**
   * Generate a unique lobby name (adjective-animal) that doesn't collide with active lobbies
   */
  generateUniqueLobbyName(): string {
    const maxAttempts = 50;
    for (let i = 0; i < maxAttempts; i++) {
      const name = uniqueNamesGenerator({
        dictionaries: [adjectives, animals],
        separator: ' ',
        style: 'capital',
      });
      // Check if this name is already in use by a waiting or in_progress lobby
      const nameInUse = Array.from(this.lobbiesById.values()).some(
        lobby => lobby.name === name && lobby.status !== 'finished'
      );
      if (!nameInUse) {
        return name;
      }
    }
    // Fallback: append timestamp to guarantee uniqueness
    return `${uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      separator: ' ',
      style: 'capital',
    })} ${Date.now()}`;
  }

  /**
   * Check if a lobby is stale (all players disconnected with no active connections)
   */
  isLobbyStale(lobby: Lobby, now: number): boolean {
    // Only check waiting and in_progress lobbies
    if (lobby.status === 'finished') {
      return false;
    }

    // If the lobby has no human players, it's stale
    if (lobby.players.length === 0) {
      return true;
    }

    // Check if ALL players have no active socket connection
    const allPlayersDisconnected = lobby.players.every(
      player => !this.connectionManager.hasPlayer(player.playerId)
    );

    if (!allPlayersDisconnected) {
      return false; // At least one player is still connected
    }

    // Determine the stale threshold based on lobby status
    const staleThreshold =
      lobby.status === 'waiting'
        ? STALE_WAITING_LOBBY_MS
        : STALE_IN_PROGRESS_LOBBY_MS;

    // Check if lobby has been around longer than the stale threshold
    const lobbyAge = now - lobby.createdAt;
    if (lobbyAge < staleThreshold) {
      return false; // Not old enough to be considered stale
    }

    // Check if any players still have pending disconnect grace timeouts
    // If they do, we're still within the grace period for reconnection
    const anyPendingTimeouts = lobby.players.some(player =>
      this.disconnectGraceTimeouts.has(player.playerId)
    );

    if (anyPendingTimeouts) {
      return false; // Still waiting for grace period to expire
    }

    return true; // Lobby is stale - all conditions met
  }

  /**
   * Clean up a lobby (shared logic for finished and stale lobbies)
   */
  async cleanupLobby(
    lobbyId: string,
    lobby: Lobby,
    reason: 'finished' | 'stale'
  ): Promise<void> {
    lobby.players.forEach(player => {
      if (this.lobbyIdByPlayerId.get(player.playerId) === lobbyId) {
        this.lobbyIdByPlayerId.delete(player.playerId);
      }
    });

    lobby.disconnectedPlayerIds.forEach(this.clearPlayerDisconnectTimer);
    this.cleanupBots(lobbyId);
    this.gameLoopsByLobbyId.delete(lobbyId);
    this.mostRecentGameSnapshotByLobbyId.delete(lobbyId);
    this.currentRoundGameEventsByLobbyId.delete(lobbyId);
    this.roundStartSnapshotByLobbyId.delete(lobbyId);
    this.supabaseGameIdByLobbyId.delete(lobbyId);
    this.currentGameBotIdsByLobbyId.delete(lobbyId);

    this.lobbiesById.delete(lobbyId);
    this.io.emit('lobbyClosed', { lobbyId });

    // Update Supabase if lobby was stale (not already finished in DB)
    if (reason === 'stale' && this.SUPABASE_LOBBIES_ENABLED) {
      try {
        await getServiceClient()
          .from('lobbies')
          .update({ status: 'finished' })
          .eq('id', lobbyId);
      } catch (error) {
        logger.error(
          '[cleanupLobby] Failed to update stale lobby in DB:',
          error
        );
      }
    }

    logger.info(
      `[cleanupLobby] Removed ${reason} lobby ${
        lobby.name ?? lobbyId
      } (${lobbyId})`
    );
  }

  /**
   * Clean up finished and stale lobbies
   */
  cleanupFinishedLobbies(): void {
    const now = Date.now();

    // Collect lobbies to cleanup (can't modify map while iterating)
    const lobbiesToCleanup: Array<{
      lobbyId: string;
      lobby: Lobby;
      reason: 'finished' | 'stale';
    }> = [];

    this.lobbiesById.forEach((lobby, lobbyId) => {
      // Check for stale lobbies (waiting/in_progress with no connections)
      if (lobby.status !== 'finished' && this.isLobbyStale(lobby, now)) {
        lobbiesToCleanup.push({ lobbyId, lobby, reason: 'stale' });
        return;
      }

      // Check for finished lobbies past TTL
      if (lobby.status === 'finished') {
        const finishedAt = lobby.finishedAt ?? lobby.createdAt;
        const lobbyIsEmpty = lobby.players.length === 0;
        if (lobbyIsEmpty || now - finishedAt >= FINISHED_LOBBY_TTL_MS) {
          lobbiesToCleanup.push({ lobbyId, lobby, reason: 'finished' });
        }
      }
    });

    // Cleanup collected lobbies
    lobbiesToCleanup.forEach(({ lobbyId, lobby, reason }) => {
      void this.cleanupLobby(lobbyId, lobby, reason);
    });
  }

  /**
   * Handle createLobby socket event
   */
  handleCreateLobby(
    socket: Socket,
    data: {
      playerCount: number;
      name?: string;
      visibility?: 'public' | 'private' | 'friends';
      isFixedSize?: boolean;
    },
    callback?: (response: any) => void
  ): void {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    logger.info(
      `[handleCreateLobby] Starting for player: ${playerId}, callback present: ${!!callback}`
    );

    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const error = { error: 'Not logged in' };
      if (callback) {
        logger.info(
          '[handleCreateLobby] Sending error callback: Not logged in'
        );
        callback(error);
      }
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    // Check if player is already in a lobby (in-memory check first for speed)
    if (this.lobbyIdByPlayerId.has(playerId)) {
      const existingLobbyId = this.lobbyIdByPlayerId.get(playerId);
      logger.error(
        `[handleCreateLobby] Player ${playerId} already in lobby ${existingLobbyId} (in-memory)`
      );
      const error = { error: 'Already in a lobby', lobbyId: existingLobbyId };
      if (callback) {
        logger.info(
          '[handleCreateLobby] Sending error callback: Already in a lobby'
        );
        callback(error);
      }
      socket.emit('error', { message: 'Already in a lobby' });
      return;
    }

    const {
      playerCount,
      name: customName,
      visibility = 'public',
      isFixedSize = true,
    } = data;

    // Validate player count
    if (!playerCount || playerCount < 2 || playerCount > 4) {
      logger.error('Invalid player count:', playerCount);
      const error = { error: 'Player count must be between 2 and 4' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Player count must be between 2 and 4' });
      return;
    }

    // Get player info for host display name
    const playerInfo = this.connectionManager.getPlayer(playerId);
    const hostDisplayName = playerInfo?.name || 'Unknown';

    // Generate lobby name (either custom or default to "<host's name>'s lobby")
    const lobbyName = customName?.trim() || `${hostDisplayName}'s lobby`;

    const createLobbyAsync = async (): Promise<void> => {
      try {
        // Defense in depth: Check DB for existing lobby membership
        // This catches cases where in-memory map is out of sync (e.g., after server restart)
        const existingLobbyId = await getPlayerActiveLobbyId(playerId);
        if (existingLobbyId) {
          // Sync in-memory map with DB state
          this.lobbyIdByPlayerId.set(playerId, existingLobbyId);
          logger.warn(
            `[handleCreateLobby] Player ${playerId} already in lobby ${existingLobbyId} (DB check)`
          );
          const error = {
            error: 'Already in a lobby',
            lobbyId: existingLobbyId,
          };
          if (callback) callback(error);
          socket.emit('error', { message: 'Already in a lobby' });
          return;
        }

        const created = await createLobby({
          hostId: playerId,
          name: lobbyName,
          maxPlayers: playerCount,
          isFixedSize,
          visibility,
        });
        const mapped = this.cacheLobbyFromPayload(created);
        this.lobbyIdByPlayerId.set(playerId, mapped.id);
        socket.join(mapped.id);

        logger.info(
          `[handleCreateLobby] Lobby created: ${mapped.name} (${mapped.id}) by ${hostDisplayName}`
        );

        if (callback) {
          logger.info(
            '[handleCreateLobby] Sending success callback with lobby:',
            mapped.id
          );
          callback({ lobby: mapped });
        }

        this.io.emit('lobbyUpdated', mapped);
        socket.emit('lobbyCreated', { lobbyId: mapped.id, name: mapped.name });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to create lobby';
        logger.error('[handleCreateLobby] Supabase create failed', message);
        const response = { error: message };
        if (callback) callback(response);
        socket.emit('error', { message });
      }
    };

    void createLobbyAsync();
  }

  /**
   * Handle joinLobby socket event
   */
  handleJoinLobby(
    socket: Socket,
    data: { lobbyId: string },
    callback?: (response: any) => void
  ): void {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const error = { error: 'Not logged in' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    const { lobbyId } = data;

    // Check if player is already in a lobby (in-memory check first for speed)
    const memoryLobbyId = this.lobbyIdByPlayerId.get(playerId);
    if (memoryLobbyId) {
      // Allow rejoining the same lobby (idempotent)
      if (memoryLobbyId === lobbyId) {
        logger.info(
          `[handleJoinLobby] Player ${playerId} rejoining same lobby ${lobbyId}`
        );
        // Fall through to allow the join (will be idempotent in Supabase)
      } else {
        logger.error(
          `[handleJoinLobby] Player ${playerId} already in lobby ${memoryLobbyId} (in-memory)`
        );
        const error = { error: 'Already in a lobby', lobbyId: memoryLobbyId };
        if (callback) callback(error);
        socket.emit('error', { message: 'Already in a lobby' });
        return;
      }
    }

    const joinLobby = async (): Promise<void> => {
      try {
        // Defense in depth: Check DB for existing lobby membership in a DIFFERENT lobby
        // Exclude the target lobby since joining the same lobby is allowed (idempotent)
        const existingLobbyId = await getPlayerActiveLobbyId(playerId, lobbyId);
        if (existingLobbyId) {
          // Sync in-memory map with DB state
          this.lobbyIdByPlayerId.set(playerId, existingLobbyId);
          logger.warn(
            `[handleJoinLobby] Player ${playerId} already in different lobby ${existingLobbyId} (DB check)`
          );
          const error = {
            error: 'Already in a lobby',
            lobbyId: existingLobbyId,
          };
          if (callback) callback(error);
          socket.emit('error', { message: 'Already in a lobby' });
          return;
        }

        const joined = await joinLobbyInSupabase({ lobbyId, playerId });
        const mappedLobby = this.cacheLobbyFromPayload(joined);
        this.lobbyIdByPlayerId.set(playerId, lobbyId);
        socket.join(lobbyId);
        if (mappedLobby.disconnectedPlayerIds.length) {
          mappedLobby.disconnectedPlayerIds =
            mappedLobby.disconnectedPlayerIds.filter(id => id !== playerId);
        }
        logger.info(
          `Player ${playerId} joined lobby ${mappedLobby.name ?? lobbyId}`
        );
        if (callback) {
          callback({ lobby: mappedLobby });
        }
        this.io.emit('lobbyUpdated', mappedLobby);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Join failed';
        logger.error('Failed to join lobby via Supabase', message);
        const response = { error: message };
        if (callback) callback(response);
        socket.emit('error', { message });
      }
    };

    void joinLobby();
  }

  /**
   * Handle leaveLobby socket event
   */
  handleLeaveLobby(
    socket: Socket,
    data: { lobbyId: string },
    callback?: (response: any) => void
  ): void {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const error = { error: 'Not logged in' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    const { lobbyId } = data;

    // Get current lobby state to detect host transfer
    const lobbyBefore = this.lobbiesById.get(lobbyId);
    const previousHostId = lobbyBefore?.hostId;
    const wasHost = previousHostId === playerId;

    const leave = async (): Promise<void> => {
      try {
        const updatedLobby = await leaveLobbyInSupabase({ lobbyId, playerId });
        this.lobbyIdByPlayerId.delete(playerId);
        socket.leave(lobbyId);
        logger.info(`Player ${playerId} left lobby ${lobbyId}`);

        if (callback) {
          callback({ success: true });
        }

        if (updatedLobby) {
          const mapped = this.cacheLobbyFromPayload(updatedLobby);
          if (mapped.currentPlayers === 0) {
            mapped.status = 'finished';
            mapped.finishedAt = Date.now();
            this.removeLobbyFromCache(lobbyId);
            this.io.emit('lobbyClosed', { lobbyId });
          } else {
            // Check if host was transferred
            if (wasHost && mapped.hostId && mapped.hostId !== previousHostId) {
              const newHostPlayer = mapped.players.find(
                p => p.playerId === mapped.hostId
              );
              logger.info(
                `[handleLeaveLobby] Host transferred from ${previousHostId} to ${mapped.hostId} (${newHostPlayer?.displayName})`
              );
              this.io.to(lobbyId).emit('hostTransferred', {
                lobbyId,
                newHostId: mapped.hostId,
                newHostName: newHostPlayer?.displayName ?? 'Unknown',
                previousHostId,
              });
            }
            this.io.emit('lobbyUpdated', mapped);
          }
        } else {
          this.removeLobbyFromCache(lobbyId);
          this.io.emit('lobbyClosed', { lobbyId });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to leave lobby';
        logger.error('Failed to leave lobby via Supabase', message);
        const response = { error: message };
        if (callback) callback(response);
        socket.emit('error', { message });
      }
    };

    void leave();
  }

  /**
   * Handle kickPlayer socket event
   */
  handleKickPlayer(
    socket: Socket,
    data: { lobbyId: string; targetPlayerId: string },
    callback?: (response: any) => void
  ): void {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const error = { error: 'Not logged in' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    const { lobbyId, targetPlayerId } = data;

    // Check if lobby exists
    const lobby = this.lobbiesById.get(lobbyId);
    if (!lobby) {
      logger.error('Lobby not found:', lobbyId);
      const error = { error: 'Lobby not found' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    // Check if player is host
    if (playerId !== lobby.hostId) {
      logger.error('Not the host:', playerId, 'actual host:', lobby.hostId);
      const error = { error: 'Only the host can kick players' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Only the host can kick players' });
      return;
    }

    // Check if target is in this lobby
    const targetIndex = lobby.players.findIndex(
      p => p.playerId === targetPlayerId
    );
    if (targetIndex === -1) {
      logger.error('Target player not in lobby:', targetPlayerId, lobbyId);
      const error = { error: 'Player not in this lobby' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Player not in this lobby' });
      return;
    }

    const targetPlayerName = lobby.players[targetIndex].displayName;

    void (async () => {
      try {
        const updated = await removeLobbyPlayer({
          lobbyId,
          hostId: playerId,
          targetPlayerId,
        });
        this.lobbyIdByPlayerId.delete(targetPlayerId);
        lobby.disconnectedPlayerIds = lobby.disconnectedPlayerIds.filter(
          id => id !== targetPlayerId
        );

        logger.info(
          `Player ${targetPlayerName} was kicked from lobby ${lobby.name} (${lobbyId}) by host ${playerId}`
        );

        if (callback) {
          callback({ success: true });
        }

        const targetSocketId =
          this.connectionManager.getSocketId(targetPlayerId);
        if (targetSocketId) {
          const targetSocket = this.io.sockets.sockets.get(targetSocketId);
          targetSocket?.leave(lobbyId);
          this.io.to(targetSocketId).emit('kickedFromLobby', {
            lobbyId,
            reason: 'You were kicked by the host',
          });
        }

        const mapped = this.cacheLobbyFromPayload(updated);
        if (mapped.currentPlayers === 0 || mapped.status === 'finished') {
          mapped.status = 'finished';
          mapped.finishedAt = Date.now();
          this.removeLobbyFromCache(lobbyId);
          this.io.emit('lobbyClosed', { lobbyId });
          return;
        }

        this.io.emit('lobbyUpdated', mapped);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to kick player';
        logger.error('[handleKickPlayer] Supabase remove failed', message);
        if (callback) callback({ error: message });
        socket.emit('error', { message });
      }
    })();
  }

  /**
   * Handle updateLobbySize socket event
   */
  handleUpdateLobbySize(
    socket: Socket,
    data: { lobbyId: string; playerCount: number },
    callback?: (response: any) => void
  ): void {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const error = { error: 'Not logged in' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    const { lobbyId, playerCount } = data;

    // Validate player count
    if (!playerCount || playerCount < 2 || playerCount > 4) {
      const error = { error: 'Player count must be between 2 and 4' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Player count must be between 2 and 4' });
      return;
    }

    // Check if lobby exists
    const lobby = this.lobbiesById.get(lobbyId);
    if (!lobby) {
      const error = { error: 'Lobby not found' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    // Check if player is host
    if (playerId !== lobby.hostId) {
      const error = { error: 'Only the host can change lobby size' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Only the host can change lobby size' });
      return;
    }

    // Check if lobby is still waiting
    if (lobby.status !== 'waiting') {
      const error = { error: 'Cannot change size after game has started' };
      if (callback) callback(error);
      socket.emit('error', {
        message: 'Cannot change size after game has started',
      });
      return;
    }

    void (async () => {
      try {
        const updated = await updateLobbySize({
          lobbyId,
          hostId: playerId,
          maxPlayers: playerCount,
        });
        const mapped = this.cacheLobbyFromPayload(updated);
        logger.info(
          `Lobby ${lobby.name} size updated to ${playerCount} by host ${playerId}`
        );
        if (callback) {
          callback({ lobby: mapped });
        }
        this.io.emit('lobbyUpdated', mapped);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to update lobby size';
        logger.error('[handleUpdateLobbySize] Supabase update failed', message);
        if (callback) callback({ error: message });
        socket.emit('error', { message });
      }
    })();
  }

  /**
   * Handle updateLobbyName socket event
   */
  handleUpdateLobbyName(
    socket: Socket,
    data: { lobbyId: string; name: string },
    callback?: (response: any) => void
  ): void {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const error = { error: 'Not logged in' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    const { lobbyId, name } = data;

    // Validate name
    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName.length === 0) {
      const error = { error: 'Lobby name cannot be empty' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Lobby name cannot be empty' });
      return;
    }

    if (trimmedName.length > 50) {
      const error = { error: 'Lobby name must be 50 characters or less' };
      if (callback) callback(error);
      socket.emit('error', {
        message: 'Lobby name must be 50 characters or less',
      });
      return;
    }

    // Check if lobby exists
    const lobby = this.lobbiesById.get(lobbyId);
    if (!lobby) {
      const error = { error: 'Lobby not found' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    // Check if player is host
    if (playerId !== lobby.hostId) {
      const error = { error: 'Only the host can change lobby name' };
      if (callback) callback(error);
      socket.emit('error', { message: 'Only the host can change lobby name' });
      return;
    }

    // Check if lobby is still waiting
    if (lobby.status !== 'waiting') {
      const error = { error: 'Cannot change name after game has started' };
      if (callback) callback(error);
      socket.emit('error', {
        message: 'Cannot change name after game has started',
      });
      return;
    }

    void (async () => {
      try {
        const updated = await updateLobbyName({
          lobbyId,
          hostId: playerId,
          name: trimmedName,
        });
        const mapped = this.cacheLobbyFromPayload(updated);
        logger.info(
          `Lobby ${lobbyId} name updated to "${trimmedName}" by host ${playerId}`
        );
        if (callback) {
          callback({ lobby: mapped });
        }
        this.io.emit('lobbyUpdated', mapped);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to update lobby name';
        logger.error('[handleUpdateLobbyName] Supabase update failed', message);
        if (callback) callback({ error: message });
        socket.emit('error', { message });
      }
    })();
  }

  /**
   * Handle listLobbies socket event
   */
  handleListLobbies(socket: Socket): void {
    void (async () => {
      try {
        const lobbies = await listLobbiesFromSupabase();
        lobbies.forEach(l => this.cacheLobbyFromPayload(l));
        const waitingLobbies = lobbies
          .filter(l => l.status === 'waiting')
          .map(lobby => {
            const hostId = lobby.host_id as string | undefined;
            const hostPlayerInfo = hostId
              ? this.connectionManager.getPlayer(hostId)
              : undefined;
            const hostDisplayName = hostPlayerInfo?.name || 'Unknown';
            return {
              id: lobby.id,
              name: lobby.name,
              hostDisplayName,
              currentPlayers:
                lobby.current_players ?? lobby.players?.length ?? 0,
              playerCount: lobby.max_players ?? (lobby as any).playerCount,
              createdAt: lobby.created_at
                ? new Date(lobby.created_at).getTime()
                : Date.now(),
            };
          });
        logger.info(
          `Sending ${waitingLobbies.length} waiting lobbies to client`
        );
        socket.emit('lobbyList', { lobbies: waitingLobbies });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to list lobbies';
        logger.error('[handleListLobbies] Supabase list failed', message);
        socket.emit('error', { message: 'Failed to list lobbies' });
      }
    })();
  }
}
