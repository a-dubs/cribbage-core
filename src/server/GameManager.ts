import { Server, Socket } from 'socket.io';
import { GameLoop } from '../gameplay/GameLoop';
import {
  ActionType,
  GameAgent,
  GameEvent,
  PlayerIdAndName,
  GameSnapshot,
} from '../types';
import { WebSocketAgent } from '../agents/WebSocketAgent';
import { HeuristicSimpleAgent } from '../agents/HeuristicSimpleAgent';
import { logger } from '../utils/logger';
import { ConnectionManager } from './ConnectionManager';
import { LobbyManager } from './LobbyManager';
import { DisconnectHandler } from './DisconnectHandler';
import { PersistenceService } from './PersistenceService';
import { PlayerInfo, Lobby } from './types';
import {
  startLobby,
  getServiceClient,
  completeGameRecord,
  toUuidOrNull,
  getLobbyWithPlayers,
  type LobbyPayload,
} from '../services/supabaseService';

export interface GameManagerDependencies {
  io: Server;
  connectionManager: ConnectionManager;
  lobbyManager: LobbyManager;
  disconnectHandler: DisconnectHandler;
  persistenceService: PersistenceService;
  gameLoopsByLobbyId: Map<string, GameLoop>;
  mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot>;
  currentRoundGameEventsByLobbyId: Map<string, GameEvent[]>;
  roundStartSnapshotByLobbyId: Map<string, GameSnapshot>;
  supabaseGameIdByLobbyId: Map<string, string>;
  currentGameBotIdsByLobbyId: Map<string, string[]>;
  gameIdByLobbyId: Map<string, string>;
  cleanupBots: (lobbyId: string) => void;
  emitConnectedPlayers: () => void;
}

/**
 * Manages game lifecycle and snapshot broadcasting.
 * Encapsulates game start, restart, snapshot distribution, and cleanup operations.
 */
export class GameManager {
  private readonly io: Server;
  private readonly connectionManager: ConnectionManager;
  private readonly lobbyManager: LobbyManager;
  private readonly disconnectHandler: DisconnectHandler;
  private readonly persistenceService: PersistenceService;
  private readonly gameLoopsByLobbyId: Map<string, GameLoop>;
  private readonly mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot>;
  private readonly currentRoundGameEventsByLobbyId: Map<string, GameEvent[]>;
  private readonly roundStartSnapshotByLobbyId: Map<string, GameSnapshot>;
  private readonly supabaseGameIdByLobbyId: Map<string, string>;
  private readonly currentGameBotIdsByLobbyId: Map<string, string[]>;
  private readonly gameIdByLobbyId: Map<string, string>;
  private readonly cleanupBots: (lobbyId: string) => void;
  private readonly emitConnectedPlayers: () => void;
  // Dedupe persistence triggers caused by acknowledgment snapshots that can
  // replay the same round-end gameEvent multiple times.
  private readonly lastPersistenceTriggerKeyByLobbyId = new Map<string, string>();

  constructor(deps: GameManagerDependencies) {
    this.io = deps.io;
    this.connectionManager = deps.connectionManager;
    this.lobbyManager = deps.lobbyManager;
    this.disconnectHandler = deps.disconnectHandler;
    this.persistenceService = deps.persistenceService;
    this.gameLoopsByLobbyId = deps.gameLoopsByLobbyId;
    this.mostRecentGameSnapshotByLobbyId = deps.mostRecentGameSnapshotByLobbyId;
    this.currentRoundGameEventsByLobbyId = deps.currentRoundGameEventsByLobbyId;
    this.roundStartSnapshotByLobbyId = deps.roundStartSnapshotByLobbyId;
    this.supabaseGameIdByLobbyId = deps.supabaseGameIdByLobbyId;
    this.currentGameBotIdsByLobbyId = deps.currentGameBotIdsByLobbyId;
    this.gameIdByLobbyId = deps.gameIdByLobbyId;
    this.cleanupBots = deps.cleanupBots;
    this.emitConnectedPlayers = deps.emitConnectedPlayers;
  }

  private shouldTriggerRoundPersistence(gameEvent: GameEvent): boolean {
    const isRoundEndCountingEvent =
      gameEvent.actionType === ActionType.END_PHASE &&
      gameEvent.phase === 'COUNTING';
    return isRoundEndCountingEvent || gameEvent.actionType === ActionType.WIN;
  }

  private shouldPersistForEventOnce(
    lobbyId: string,
    gameEvent: GameEvent
  ): boolean {
    if (!this.shouldTriggerRoundPersistence(gameEvent)) {
      return false;
    }

    const key = `${gameEvent.actionType}:${gameEvent.snapshotId}`;
    const lastKey = this.lastPersistenceTriggerKeyByLobbyId.get(lobbyId);
    if (lastKey === key) {
      return false;
    }

    this.lastPersistenceTriggerKeyByLobbyId.set(lobbyId, key);
    return true;
  }

  /**
   * Start a game for a lobby (called by host or HTTP API)
   */
  async startLobbyGameForHost(
    lobbyId: string,
    hostId: string
  ): Promise<{ lobby: LobbyPayload; gameId: string }> {
    if (this.gameLoopsByLobbyId.has(lobbyId)) {
      throw new Error('GAME_IN_PROGRESS');
    }

    const startedLobby = await startLobby({ lobbyId, hostId });
    const lobby = this.lobbyManager.cacheLobbyFromPayload(startedLobby);
    const newBotIds: string[] = [];

    try {
      // Clean up any existing bots before creating new ones
      this.cleanupBots(lobby.id);

      // Build playersInfo from lobby members (humans only, no bots yet)
      const playersInfo: PlayerIdAndName[] = lobby.players.map(p => ({
        id: p.playerId,
        name: p.displayName,
      }));

      // Calculate bots needed
      const targetCount =
        lobby.maxPlayers ?? lobby.playerCount ?? playersInfo.length;
      const botsNeeded = Math.max(0, targetCount - playersInfo.length);
      logger.info(
        `Starting lobby game: ${lobby.name} with ${playersInfo.length} humans and ${botsNeeded} bots needed`
      );

      // Create bots (use HeuristicSimpleAgent for faster decisions)
      const botNames = ['Bot Alex', 'Bot Morgan', 'Bot Jordan'];
      for (let i = 0; i < botsNeeded; i++) {
        const botName = botNames[i] || `Bot ${i + 1}`;
        const botAgent = new HeuristicSimpleAgent();
        const botId = `${botAgent.playerId}-${Date.now()}-${i}`;
        // Update the agent's playerId to match the generated botId
        botAgent.playerId = botId;
        playersInfo.push({ id: botId, name: botName });
        const botPlayerInfo: PlayerInfo = {
          id: botId,
          name: botName,
          agent: botAgent,
        };
        this.connectionManager.setPlayer(botId, botPlayerInfo);
        newBotIds.push(botId);
        logger.info(`Added bot: ${botName} (ID: ${botId})`);
      }

      // Create GameLoop using players from the lobby
      const agents: Map<string, GameAgent> = new Map();
      // Populate human agents
      lobby.players.forEach(p => {
        const info = this.connectionManager.getPlayer(p.playerId);
        if (info) agents.set(info.id, info.agent);
      });
      // Populate bot agents
      newBotIds.forEach(id => {
        const info = this.connectionManager.getPlayer(id);
        if (info) agents.set(info.id, info.agent);
      });

      // Filter out disconnected players - only include players who have agents
      const validPlayersInfo = playersInfo.filter(p => agents.has(p.id));
      if (validPlayersInfo.length !== playersInfo.length) {
        const disconnectedPlayers = playersInfo.filter(p => !agents.has(p.id));
        logger.warn(
          `[startLobbyGameForHost] Filtering out ${
            disconnectedPlayers.length
          } disconnected players: ${disconnectedPlayers
            .map(p => p.name)
            .join(', ')}`
        );
      }
      if (validPlayersInfo.length < 2) {
        throw new Error('Not enough connected players to start game');
      }

      // Store bot IDs for cleanup after game ends
      this.currentGameBotIdsByLobbyId.set(lobby.id, newBotIds);

      const gameLoop = new GameLoop(validPlayersInfo);
      agents.forEach((agent, id) => gameLoop.addAgent(id, agent));
      this.gameLoopsByLobbyId.set(lobby.id, gameLoop);
      this.currentRoundGameEventsByLobbyId.set(lobby.id, []);
      this.lastPersistenceTriggerKeyByLobbyId.delete(lobby.id);
      await this.persistenceService.createSupabaseGameForLobby(
        lobby,
        validPlayersInfo,
        gameLoop,
        this.supabaseGameIdByLobbyId
      );

      // Set up gameSnapshot listener to send redacted snapshots to all clients
      let firstSnapshotEmitted = false;
      gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
        this.mostRecentGameSnapshotByLobbyId.set(lobby.id, newSnapshot);
        const existingEvents =
          this.currentRoundGameEventsByLobbyId.get(lobby.id) || [];
        const updatedEvents = [...existingEvents, newSnapshot.gameEvent];
        const isStartRound =
          newSnapshot.gameEvent.actionType === ActionType.START_ROUND;
        const roundEvents = isStartRound
          ? [newSnapshot.gameEvent]
          : updatedEvents;
        if (isStartRound) {
          logger.debug(
            `[Supabase] START_ROUND detected, resetting event collection for lobby ${lobby.id}`
          );
          this.roundStartSnapshotByLobbyId.set(lobby.id, newSnapshot);
          this.currentRoundGameEventsByLobbyId.set(lobby.id, roundEvents);
        } else {
          this.currentRoundGameEventsByLobbyId.set(lobby.id, updatedEvents);
          logger.debug(
            `[Supabase] Collected event ${newSnapshot.gameEvent.actionType} (lobby ${lobby.id}, total events: ${updatedEvents.length})`
          );
        }

        if (this.shouldPersistForEventOnce(lobby.id, newSnapshot.gameEvent)) {
          const eventsToPersist =
            this.currentRoundGameEventsByLobbyId.get(lobby.id) || [];
          logger.info(
            `[Supabase] Triggering persistence for ${newSnapshot.gameEvent.actionType} (lobby ${lobby.id}, ${eventsToPersist.length} events collected)`
          );
          // Use void to fire-and-forget, but ensure errors are logged in persistRoundHistory
          void this.persistenceService
            .persistRoundHistory(
              lobby.id,
              newSnapshot,
              this.supabaseGameIdByLobbyId,
              this.currentRoundGameEventsByLobbyId,
              this.roundStartSnapshotByLobbyId
            )
            .catch(error => {
              logger.error(
                `[Supabase] Unhandled error in persistRoundHistory for lobby ${lobby.id}`,
                error
              );
            });
        }

        // Send redacted snapshots to all players
        this.sendRedactedSnapshotToAllPlayers(
          gameLoop,
          newSnapshot,
          roundEvents,
          lobby.id
        );

        // After the first snapshot, ensure all clients received it by re-emitting
        // This helps clients that reset state after gameStartedFromLobby
        if (!firstSnapshotEmitted) {
          firstSnapshotEmitted = true;
          // Small delay to ensure clients have processed gameStartedFromLobby and set up listeners
          setTimeout(() => {
            const latestSnapshot = this.mostRecentGameSnapshotByLobbyId.get(
              lobby.id
            );
            const latestEvents =
              this.currentRoundGameEventsByLobbyId.get(lobby.id) || [];
            if (latestSnapshot === newSnapshot) {
              logger.info(
                'Re-emitting first game snapshot to ensure all clients received it'
              );
              this.sendRedactedSnapshotToAllPlayers(
                gameLoop,
                latestSnapshot,
                latestEvents,
                lobby.id
              );
            }
          }, 100);
        }
      });

      // Map lobby -> game
      const gameId = gameLoop.cribbageGame.getGameState().id;
      this.gameIdByLobbyId.set(lobby.id, gameId);

      // Update lobby status and broadcast updates
      lobby.status = 'in_progress';
      lobby.finishedAt = null;
      lobby.disconnectedPlayerIds = [];
      this.io.emit('lobbyUpdated', lobby);

      // Notify lobby members of the game start
      this.io.emit('gameStartedFromLobby', {
        lobbyId: lobby.id,
        gameId,
        players: validPlayersInfo,
      });

      // Start the game loop (this will emit snapshots as the game progresses)
      // Don't await - let it run in the background
      this.startGame(lobby.id).catch(error => {
        logger.error('[startLobbyGameForHost] Error in game loop:', error);
      });

      return { lobby: startedLobby, gameId };
    } catch (error) {
      // Rollback lobby status to 'waiting' if game start fails
      try {
        const client = getServiceClient();
        await client
          .from('lobbies')
          .update({ status: 'waiting' })
          .eq('id', lobbyId);
        logger.info(
          `[startLobbyGameForHost] Rolled back lobby ${lobbyId} status to 'waiting' due to error`
        );
      } catch (rollbackError) {
        logger.error(
          `[startLobbyGameForHost] Failed to rollback lobby ${lobbyId} status:`,
          rollbackError
        );
      }

      // Clean up any bots that were created
      newBotIds.forEach(botId => {
        this.connectionManager.deletePlayer(botId);
      });
      if (newBotIds.length > 0) {
        logger.info(
          `[startLobbyGameForHost] Cleaned up ${newBotIds.length} bots after error`
        );
      }

      // Clean up any partial game state that may have been created
      this.gameLoopsByLobbyId.delete(lobby.id);
      this.currentGameBotIdsByLobbyId.delete(lobby.id);
      this.gameIdByLobbyId.delete(lobby.id);
      this.currentRoundGameEventsByLobbyId.delete(lobby.id);
      this.mostRecentGameSnapshotByLobbyId.delete(lobby.id);
      this.roundStartSnapshotByLobbyId.delete(lobby.id);

      // Re-throw the original error
      throw error;
    }
  }

  /**
   * Handle startLobbyGame socket event
   */
  async handleStartLobbyGame(
    socket: Socket,
    data: { lobbyId: string },
    callback?: (response: any) => void
  ): Promise<void> {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      const errorMsg = 'Not logged in';
      socket.emit('error', { message: errorMsg });
      if (callback) {
        callback({ error: errorMsg });
      }
      return;
    }

    const { lobbyId } = data;

    const lobby =
      this.lobbyManager.getLobby(lobbyId) ??
      (await this.refreshLobbyFromSupabase(lobbyId));
    if (!lobby) {
      const errorMsg = 'Lobby not found';
      socket.emit('error', { message: errorMsg });
      if (callback) {
        callback({ error: errorMsg });
      }
      return;
    }

    if (playerId !== lobby.hostId) {
      const errorMsg = 'Only the host can start the game';
      socket.emit('error', { message: errorMsg });
      if (callback) {
        callback({ error: errorMsg });
      }
      return;
    }

    try {
      const { gameId } = await this.startLobbyGameForHost(lobbyId, playerId);
      if (callback) {
        callback({ success: true, gameId });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start game';
      logger.error('Error starting lobby game:', message);
      if (callback) {
        callback({ error: message });
      }
      socket.emit('error', { message });
    }
  }

  /**
   * Handle restartGame socket event
   */
  async handleRestartGame(socket: Socket): Promise<void> {
    const playerId = this.connectionManager.getPlayerId(socket.id);
    if (!playerId) {
      logger.error('Player ID not found for socket:', socket.id);
      socket.emit('error', { message: 'Not logged in' });
      return;
    }

    // Get the lobby this player is in
    const lobbyId = this.lobbyManager.getLobbyIdForPlayer(playerId);
    if (!lobbyId) {
      logger.error('Player not in a lobby:', playerId);
      socket.emit('error', { message: 'Not in a lobby' });
      return;
    }

    const lobby = this.lobbyManager.getLobby(lobbyId);
    if (!lobby) {
      logger.error('Lobby not found:', lobbyId);
      socket.emit('error', { message: 'Lobby not found' });
      return;
    }

    // Only allow the host to restart the game
    if (playerId !== lobby.hostId) {
      logger.error(
        'Cannot restart game - player is not the host:',
        playerId,
        'host:',
        lobby.hostId
      );
      socket.emit('error', { message: 'Only the host can restart the game' });
      return;
    }

    // Check if the game is finished (not in progress)
    if (lobby.status !== 'in_progress' && lobby.status !== 'finished') {
      logger.error('Cannot restart game - lobby is not in progress:', lobbyId);
      socket.emit('error', { message: 'Game is not in progress' });
      return;
    }

    logger.info(`Restarting game for lobby: ${lobby.name} (${lobbyId})`);

    // Cancel current game loop and clear artifacts
    this.clearActiveGameArtifacts(lobbyId);

    // Emit gameReset to clear client state
    this.io.to(lobby.id).emit('gameReset');

    // Immediately start a new game with the same lobby/players
    // Reuse the logic from handleStartLobbyGame but without the waiting status check
    // Clean up any existing bots before creating new ones
    this.cleanupBots(lobby.id);

    // Build playersInfo from lobby members (humans only, no bots yet)
    const playersInfo: PlayerIdAndName[] = lobby.players.map(p => ({
      id: p.playerId,
      name: p.displayName,
    }));

    // Calculate bots needed
    const targetCount =
      lobby.maxPlayers ?? lobby.playerCount ?? playersInfo.length;
    const botsNeeded = Math.max(0, targetCount - playersInfo.length);
    logger.info(
      `Restarting lobby game: ${lobby.name} with ${playersInfo.length} humans and ${botsNeeded} bots needed`
    );

    // Create bots
    const botNames = ['Bot Alex', 'Bot Morgan', 'Bot Jordan'];
    const newBotIds: string[] = [];
    for (let i = 0; i < botsNeeded; i++) {
      const botName = botNames[i] || `Bot ${i + 1}`;
      const botAgent = new HeuristicSimpleAgent();
      const botId = `${botAgent.playerId}-${Date.now()}-${i}`;
      // Update the agent's playerId to match the generated botId
      botAgent.playerId = botId;
      playersInfo.push({ id: botId, name: botName });
      const botPlayerInfo: PlayerInfo = {
        id: botId,
        name: botName,
        agent: botAgent,
      };
      this.connectionManager.setPlayer(botId, botPlayerInfo);
      newBotIds.push(botId);
      logger.info(`Added bot: ${botName} (ID: ${botId})`);
    }

    // Create GameLoop using players from the lobby
    const agents: Map<string, GameAgent> = new Map();
    // Populate human agents
    lobby.players.forEach(p => {
      const info = this.connectionManager.getPlayer(p.playerId);
      if (info) agents.set(info.id, info.agent);
    });
    // Populate bot agents
    newBotIds.forEach(id => {
      const info = this.connectionManager.getPlayer(id);
      if (info) agents.set(info.id, info.agent);
    });

    // Store bot IDs for cleanup after game ends
    this.currentGameBotIdsByLobbyId.set(lobby.id, newBotIds);

    // Filter out disconnected players - only include players who have agents
    const validPlayersInfo = playersInfo.filter(p => agents.has(p.id));
    if (validPlayersInfo.length !== playersInfo.length) {
      const disconnectedPlayers = playersInfo.filter(p => !agents.has(p.id));
      logger.warn(
        `[handleRestartGame] Filtering out ${
          disconnectedPlayers.length
        } disconnected players: ${disconnectedPlayers
          .map(p => p.name)
          .join(', ')}`
      );
    }
    if (validPlayersInfo.length < 2) {
      throw new Error('Not enough connected players to restart game');
    }

    const gameLoop = new GameLoop(validPlayersInfo);
    agents.forEach((agent, id) => gameLoop.addAgent(id, agent));
    this.gameLoopsByLobbyId.set(lobby.id, gameLoop);
    this.currentRoundGameEventsByLobbyId.set(lobby.id, []);
    this.lastPersistenceTriggerKeyByLobbyId.delete(lobby.id);
    await this.persistenceService.createSupabaseGameForLobby(
      lobby,
      validPlayersInfo,
      gameLoop,
      this.supabaseGameIdByLobbyId
    );

    // Set up gameSnapshot listener to send redacted snapshots to all clients
    let firstSnapshotEmitted = false;
    gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
      this.mostRecentGameSnapshotByLobbyId.set(lobby.id, newSnapshot);
      const existingEvents =
        this.currentRoundGameEventsByLobbyId.get(lobby.id) || [];
      const updatedEvents = [...existingEvents, newSnapshot.gameEvent];
      const isStartRound =
        newSnapshot.gameEvent.actionType === ActionType.START_ROUND;
      const roundEvents = isStartRound
        ? [newSnapshot.gameEvent]
        : updatedEvents;
      if (isStartRound) {
        logger.debug(
          `[Supabase] START_ROUND detected, resetting event collection for lobby ${lobby.id}`
        );
        this.roundStartSnapshotByLobbyId.set(lobby.id, newSnapshot);
        this.currentRoundGameEventsByLobbyId.set(lobby.id, roundEvents);
      } else {
        this.currentRoundGameEventsByLobbyId.set(lobby.id, updatedEvents);
        logger.debug(
          `[Supabase] Collected event ${newSnapshot.gameEvent.actionType} (lobby ${lobby.id}, total events: ${updatedEvents.length})`
        );
      }

      if (this.shouldPersistForEventOnce(lobby.id, newSnapshot.gameEvent)) {
        const eventsToPersist =
          this.currentRoundGameEventsByLobbyId.get(lobby.id) || [];
        logger.info(
          `[Supabase] Triggering persistence for ${newSnapshot.gameEvent.actionType} (lobby ${lobby.id}, ${eventsToPersist.length} events collected)`
        );
        // Use void to fire-and-forget, but ensure errors are logged in persistRoundHistory
        void this.persistenceService
          .persistRoundHistory(
            lobby.id,
            newSnapshot,
            this.supabaseGameIdByLobbyId,
            this.currentRoundGameEventsByLobbyId,
            this.roundStartSnapshotByLobbyId
          )
          .catch(error => {
            logger.error(
              `[Supabase] Unhandled error in persistRoundHistory for lobby ${lobby.id}`,
              error
            );
          });
      }

      // Send redacted snapshots to all players
      this.sendRedactedSnapshotToAllPlayers(
        gameLoop,
        newSnapshot,
        roundEvents,
        lobby.id
      );

      // After the first snapshot, ensure all clients received it by re-emitting
      if (!firstSnapshotEmitted) {
        firstSnapshotEmitted = true;
        setTimeout(() => {
          const latestSnapshot = this.mostRecentGameSnapshotByLobbyId.get(
            lobby.id
          );
          const latestEvents =
            this.currentRoundGameEventsByLobbyId.get(lobby.id) || [];
          if (latestSnapshot === newSnapshot) {
            logger.info(
              'Re-emitting first game snapshot to ensure all clients received it'
            );
            this.sendRedactedSnapshotToAllPlayers(
              gameLoop,
              latestSnapshot,
              latestEvents,
              lobby.id
            );
          }
        }, 100);
      }
    });

    // Map lobby -> game
    const gameId = gameLoop.cribbageGame.getGameState().id;
    this.gameIdByLobbyId.set(lobby.id, gameId);

    // Update lobby status (keep as in_progress, don't reset to waiting)
    lobby.status = 'in_progress';
    lobby.finishedAt = null;
    lobby.disconnectedPlayerIds = [];
    this.io.emit('lobbyUpdated', lobby);

    // Notify lobby members of the game restart (same as game start)
    // Small delay to ensure clients have processed gameReset
    setTimeout(() => {
      this.io.emit('gameStartedFromLobby', {
        lobbyId: lobby.id,
        gameId,
        players: validPlayersInfo,
      });
    }, 50);

    // Start the game loop (this will emit snapshots as the game progresses)
    this.startGame(lobby.id).catch(error => {
      logger.error('[handleRestartGame] Error in game loop:', error);
    });

    logger.info(`Game restarted. New game started for lobby ${lobby.name}.`);
  }

  /**
   * Start the game loop for a lobby
   */
  async startGame(lobbyId: string): Promise<void> {
    const gameLoop = this.gameLoopsByLobbyId.get(lobbyId);
    if (!gameLoop) {
      logger.error(
        `[startGame()] Game loop not initialized for lobby ${lobbyId}. Cannot start game.`
      );
      return;
    }

    // Store reference to current game loop to check if it was cancelled or replaced
    const currentGameLoop = gameLoop;

    try {
      logger.info('Starting game loop...');
      const winner = await currentGameLoop.playGame();

      // Check if this game loop was cancelled (replaced by a new one)
      if (this.gameLoopsByLobbyId.get(lobbyId) !== currentGameLoop) {
        logger.info(
          '[startGame()] Game loop was replaced, ignoring completion'
        );
        return;
      }

      const supabaseGameId = this.supabaseGameIdByLobbyId.get(lobbyId);
      if (supabaseGameId) {
        const latestSnapshot =
          this.mostRecentGameSnapshotByLobbyId.get(lobbyId);
        if (latestSnapshot) {
          await this.persistenceService.persistRoundHistory(
            lobbyId,
            latestSnapshot,
            this.supabaseGameIdByLobbyId,
            this.currentRoundGameEventsByLobbyId,
            this.roundStartSnapshotByLobbyId
          );
        }
        const finalState = currentGameLoop.cribbageGame.getGameState();
        const finalScores = finalState.players.map(player => ({
          playerId: toUuidOrNull(player.id),
          playerName: player.name,
          score: player.score,
          isWinner: winner ? player.id === winner : false,
        }));
        await completeGameRecord({
          gameId: supabaseGameId,
          winnerId: toUuidOrNull(winner),
          finalState,
          finalScores,
          roundCount: finalState.roundNumber,
          endedAt: new Date(),
        });
      }

      // Wait a brief moment to ensure the final snapshot with Phase.END is sent to all clients
      // The endGame() call emits a gameSnapshot event which needs to be processed and sent
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check again if game loop was replaced during the wait
      if (this.gameLoopsByLobbyId.get(lobbyId) !== currentGameLoop) {
        logger.info(
          '[startGame()] Game loop was replaced during wait, ignoring completion'
        );
        return;
      }

      // Clear gameLoop after game ends so a new game can be started
      // Only clear if this is still the current game loop (hasn't been replaced)
      if (this.gameLoopsByLobbyId.get(lobbyId) === currentGameLoop) {
        logger.info('Game ended. Clearing game loop to allow new game.');
        currentGameLoop.removeAllListeners();
        this.gameLoopsByLobbyId.delete(lobbyId);
      } else {
        logger.info(
          '[startGame()] Game loop was replaced, not clearing (new game already started)'
        );
      }

      // Clean up bots that were created for this game
      this.cleanupBots(lobbyId);

      this.gameIdByLobbyId.delete(lobbyId);
      this.supabaseGameIdByLobbyId.delete(lobbyId);
      this.roundStartSnapshotByLobbyId.delete(lobbyId);
      this.lastPersistenceTriggerKeyByLobbyId.delete(lobbyId);

      const completedLobby = this.lobbyManager.getLobby(lobbyId);
      if (completedLobby) {
        completedLobby.status = 'finished';
        completedLobby.finishedAt = Date.now();
        completedLobby.disconnectedPlayerIds = [];
        this.io.emit('lobbyUpdated', completedLobby);
      }

      try {
        await getServiceClient()
          .from('lobbies')
          .update({ status: 'finished' })
          .eq('id', lobbyId);
      } catch (updateError) {
        logger.error(
          '[startGame] Failed to mark lobby finished in Supabase. ' +
            'This is a critical error - lobby status update is required.',
          updateError
        );
      }

      this.io.emit('gameOver', winner);
    } catch (error) {
      // If game loop was cancelled, that's expected - just log and return
      if (
        error instanceof Error &&
        error.message === 'Game loop was cancelled'
      ) {
        logger.info('[startGame()] Game loop was cancelled, cleaning up');
        // Clean up bots even if cancelled
        if (this.gameLoopsByLobbyId.get(lobbyId) === currentGameLoop) {
          this.cleanupBots(lobbyId);
          this.gameLoopsByLobbyId.delete(lobbyId);
        }
        this.gameIdByLobbyId.delete(lobbyId);
        this.supabaseGameIdByLobbyId.delete(lobbyId);
        this.roundStartSnapshotByLobbyId.delete(lobbyId);
        this.lastPersistenceTriggerKeyByLobbyId.delete(lobbyId);
        this.currentRoundGameEventsByLobbyId.delete(lobbyId);
        this.mostRecentGameSnapshotByLobbyId.delete(lobbyId);
        return;
      }
      // Otherwise, rethrow the error
      logger.error('[startGame()] Error during game:', error);
      throw error;
    }
  }

  /**
   * Send redacted game snapshot and events to all players in a game
   */
  sendRedactedSnapshotToAllPlayers(
    gameLoop: GameLoop,
    snapshot: GameSnapshot,
    roundEvents: GameEvent[],
    lobbyId: string
  ): void {
    const gameState = gameLoop.cribbageGame.getGameState();

    // Send redacted snapshot to each player
    gameState.players.forEach(player => {
      const socketId = this.connectionManager.getSocketId(player.id);
      if (!socketId) {
        // Player might be a bot or disconnected - skip
        return;
      }

      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        // Socket not found - skip
        return;
      }

      // Update WebSocketAgent with the latest snapshot if this is a human player
      const playerInfo = this.connectionManager.getPlayer(player.id);
      if (playerInfo && playerInfo.agent instanceof WebSocketAgent) {
        playerInfo.agent.updateGameSnapshot(snapshot);
      }

      // Get redacted state and event for this player
      const redactedGameState = gameLoop.cribbageGame.getRedactedGameState(
        player.id
      );
      const redactedGameEvent = gameLoop.cribbageGame.getRedactedGameEvent(
        snapshot.gameEvent,
        player.id
      );
      const redactedSnapshot: GameSnapshot = {
        gameState: redactedGameState,
        gameEvent: redactedGameEvent,
        pendingDecisionRequests: snapshot.pendingDecisionRequests,
      };

      // Send redacted snapshot
      socket.emit('gameSnapshot', redactedSnapshot);

      // Send redacted round events
      const redactedRoundEvents = roundEvents.map(event =>
        gameLoop.cribbageGame.getRedactedGameEvent(event, player.id)
      );
      socket.emit('currentRoundGameEvents', redactedRoundEvents);
    });
  }

  /**
   * Send most recent game data to a socket (for reconnection)
   */
  sendMostRecentGameData(socket: Socket): void {
    logger.info('Sending most recent game data to client');

    // Find which player this socket belongs to
    const playerId = this.connectionManager.getPlayerId(socket.id);

    if (!playerId) {
      logger.error('Could not find player ID for socket:', socket.id);
      return;
    }

    const lobbyId = this.lobbyManager.getLobbyIdForPlayer(playerId);
    if (!lobbyId) {
      logger.warn(
        `Player ${playerId} is not in a lobby; skipping game state send.`
      );
      socket.emit('currentRoundGameEvents', []);
      return;
    }

    const activeGameLoop = this.gameLoopsByLobbyId.get(lobbyId);
    const mostRecentGameSnapshot =
      this.mostRecentGameSnapshotByLobbyId.get(lobbyId);
    const roundEvents = this.currentRoundGameEventsByLobbyId.get(lobbyId) || [];

    if (!activeGameLoop || !mostRecentGameSnapshot) {
      logger.warn(
        `No active game loop or snapshot for lobby ${lobbyId} when attempting to send game data`
      );
      socket.emit('currentRoundGameEvents', []);
      return;
    }

    // Check if player exists in the game before trying to get redacted state
    const currentGameState = activeGameLoop.cribbageGame.getGameState();
    const playerExistsInGame = currentGameState.players.some(
      p => p.id === playerId
    );

    if (!playerExistsInGame) {
      logger.info(
        `Player ${playerId} not found in game for lobby ${lobbyId}. Skipping game state send.`
      );
      // Still send empty arrays for consistency
      socket.emit('currentRoundGameEvents', []);
      return;
    }

    // Update WebSocketAgent with the latest snapshot
    const playerInfo = this.connectionManager.getPlayer(playerId);
    if (playerInfo && playerInfo.agent instanceof WebSocketAgent) {
      playerInfo.agent.updateGameSnapshot(mostRecentGameSnapshot);
    }

    const redactedGameState =
      activeGameLoop.cribbageGame.getRedactedGameState(playerId);
    const redactedGameEvent = activeGameLoop.cribbageGame.getRedactedGameEvent(
      mostRecentGameSnapshot.gameEvent,
      playerId
    );
    const redactedSnapshot: GameSnapshot = {
      gameState: redactedGameState,
      gameEvent: redactedGameEvent,
      pendingDecisionRequests: mostRecentGameSnapshot.pendingDecisionRequests, // Include pending requests
    };
    socket.emit('gameSnapshot', redactedSnapshot);

    const redactedRoundEvents = roundEvents.map(event =>
      activeGameLoop.cribbageGame.getRedactedGameEvent(event, playerId)
    );
    socket.emit('currentRoundGameEvents', redactedRoundEvents);
  }

  /**
   * Clear active game artifacts for a lobby
   */
  clearActiveGameArtifacts(lobbyId: string): Lobby | undefined {
    const loop = this.gameLoopsByLobbyId.get(lobbyId);
    if (loop) {
      loop.cancel();
      loop.removeAllListeners();
      this.gameLoopsByLobbyId.delete(lobbyId);
    }

    this.mostRecentGameSnapshotByLobbyId.delete(lobbyId);
    this.currentRoundGameEventsByLobbyId.delete(lobbyId);
    this.roundStartSnapshotByLobbyId.delete(lobbyId);
    this.lastPersistenceTriggerKeyByLobbyId.delete(lobbyId);
    this.supabaseGameIdByLobbyId.delete(lobbyId);
    this.gameIdByLobbyId.delete(lobbyId);
    this.cleanupBots(lobbyId);

    const lobby = this.lobbyManager.getLobby(lobbyId);
    if (lobby) {
      lobby.disconnectedPlayerIds.forEach(playerId =>
        this.disconnectHandler.clearPlayerDisconnectTimer(playerId)
      );
    }

    return lobby;
  }

  /**
   * Refresh lobby from Supabase (helper method)
   */
  private async refreshLobbyFromSupabase(
    lobbyId: string
  ): Promise<Lobby | null> {
    try {
      const payload = await getLobbyWithPlayers(lobbyId);
      if (!payload) return null;
      return this.lobbyManager.cacheLobbyFromPayload(payload);
    } catch (error) {
      logger.error('[Supabase] Failed to refresh lobby', lobbyId, error);
      return null;
    }
  }
}
