import http from 'http';
import express, { type Express } from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { GameLoop } from '../gameplay/GameLoop';
import { PlayerIdAndName, GameSnapshot, GameEvent } from '../types';
import { WebSocketAgent } from '../agents/WebSocketAgent';
import { logger } from '../utils/logger';
import { registerHttpApi } from '../httpApi';
import {
  getLobbyWithPlayers,
  getPlayerActiveLobbyId,
  getProfile,
  getServiceClient,
  getGameHistoryCountsByLobbyId,
  verifyAccessToken,
  type LobbyPayload,
} from '../services/supabaseService';
import { applyAuthMiddleware } from './AuthMiddleware';
import { ConnectionManager } from './ConnectionManager';
import { DisconnectHandler } from './DisconnectHandler';
import { LobbyManager } from './LobbyManager';
import { PersistenceService } from './PersistenceService';
import { GameManager } from './GameManager';
import {
  PlayerInfo,
  Lobby,
  LoginData,
  TestResetRequest,
  TestResetResponse,
} from './types';

export interface WebSocketServerConfig {
  port: number;
  webAppOrigin: string;
}

export class WebSocketServer {
  private readonly config: WebSocketServerConfig;
  private readonly app: Express;
  private readonly httpServer: http.Server;
  private readonly io: Server;
  private readonly connectionManager: ConnectionManager;
  private readonly lobbyManager: LobbyManager;
  private readonly disconnectHandler: DisconnectHandler;
  private readonly persistenceService: PersistenceService;
  private readonly gameManager: GameManager;

  // Game state maps (shared with managers)
  private readonly gameIdByLobbyId: Map<string, string> = new Map();
  private readonly gameLoopsByLobbyId: Map<string, GameLoop> = new Map();
  private readonly mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot> =
    new Map();
  private readonly currentRoundGameEventsByLobbyId: Map<string, GameEvent[]> =
    new Map();
  private readonly roundStartSnapshotByLobbyId: Map<string, GameSnapshot> =
    new Map();
  private readonly supabaseGameIdByLobbyId: Map<string, string> = new Map();
  private readonly currentGameBotIdsByLobbyId: Map<string, string[]> =
    new Map();
  private readonly disconnectGraceTimeouts: Map<string, NodeJS.Timeout> =
    new Map();

  // Wrapper for clearPlayerDisconnectTimer to avoid circular dependency
  private readonly clearPlayerDisconnectTimerWrapper = {
    fn: (playerId: string) => {
      // Will be set after DisconnectHandler is created
    },
  };

  constructor(config: WebSocketServerConfig) {
    this.config = config;

    // Setup CORS and Express app
    const allowedOrigins = this.getAllowedOrigins();
    this.app = express();
    this.app.use(
      cors({
        origin: allowedOrigins as any,
        credentials: true,
      })
    );
    this.app.use(express.json({ limit: '2mb' }));

    // Create HTTP server
    this.httpServer = http.createServer(this.app);

    // Create Socket.IO server
    this.io = new Server(this.httpServer, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      allowEIO3: true,
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      upgradeTimeout: 10000,
      maxHttpBufferSize: 1e6,
      allowRequest: (req, callback) => {
        logger.info('[Socket.IO] allowRequest called', {
          url: req.url,
          origin: req.headers?.origin,
        });
        callback(null, true);
      },
    });

    // Apply authentication middleware
    applyAuthMiddleware(this.io);

    // Create ConnectionManager
    this.connectionManager = new ConnectionManager(this.io, logger);

    // Create managers (order matters due to dependencies)
    this.lobbyManager = new LobbyManager({
      io: this.io,
      connectionManager: this.connectionManager,
      disconnectGraceTimeouts: this.disconnectGraceTimeouts,
      gameLoopsByLobbyId: this.gameLoopsByLobbyId,
      mostRecentGameSnapshotByLobbyId: this.mostRecentGameSnapshotByLobbyId,
      currentRoundGameEventsByLobbyId: this.currentRoundGameEventsByLobbyId,
      roundStartSnapshotByLobbyId: this.roundStartSnapshotByLobbyId,
      supabaseGameIdByLobbyId: this.supabaseGameIdByLobbyId,
      currentGameBotIdsByLobbyId: this.currentGameBotIdsByLobbyId,
      cleanupBots: (lobbyId: string) => this.cleanupBots(lobbyId),
      clearPlayerDisconnectTimer: (playerId: string) =>
        this.clearPlayerDisconnectTimerWrapper.fn(playerId),
      lobbyFromSupabase: (payload: any) => this.lobbyFromSupabase(payload),
    });

    // Create DisconnectHandler
    this.disconnectHandler = new DisconnectHandler({
      io: this.io,
      lobbyManager: this.lobbyManager,
      connectionManager: this.connectionManager,
      disconnectGraceTimeouts: this.disconnectGraceTimeouts,
      gameLoopsByLobbyId: this.gameLoopsByLobbyId,
      mostRecentGameSnapshotByLobbyId: this.mostRecentGameSnapshotByLobbyId,
      currentRoundGameEventsByLobbyId: this.currentRoundGameEventsByLobbyId,
      roundStartSnapshotByLobbyId: this.roundStartSnapshotByLobbyId,
      supabaseGameIdByLobbyId: this.supabaseGameIdByLobbyId,
      gameIdByLobbyId: this.gameIdByLobbyId,
      currentGameBotIdsByLobbyId: this.currentGameBotIdsByLobbyId,
      cleanupBots: (lobbyId: string) => this.cleanupBots(lobbyId),
    });

    // Set the function reference now that disconnectHandler is created
    this.clearPlayerDisconnectTimerWrapper.fn = (playerId: string) =>
      this.disconnectHandler.clearPlayerDisconnectTimer(playerId);

    // Create PersistenceService
    this.persistenceService = new PersistenceService(logger);

    // Create GameManager
    this.gameManager = new GameManager({
      io: this.io,
      connectionManager: this.connectionManager,
      lobbyManager: this.lobbyManager,
      disconnectHandler: this.disconnectHandler,
      persistenceService: this.persistenceService,
      gameLoopsByLobbyId: this.gameLoopsByLobbyId,
      mostRecentGameSnapshotByLobbyId: this.mostRecentGameSnapshotByLobbyId,
      currentRoundGameEventsByLobbyId: this.currentRoundGameEventsByLobbyId,
      roundStartSnapshotByLobbyId: this.roundStartSnapshotByLobbyId,
      supabaseGameIdByLobbyId: this.supabaseGameIdByLobbyId,
      currentGameBotIdsByLobbyId: this.currentGameBotIdsByLobbyId,
      gameIdByLobbyId: this.gameIdByLobbyId,
      cleanupBots: (lobbyId: string) => this.cleanupBots(lobbyId),
      emitConnectedPlayers: () => this.emitConnectedPlayers(),
    });

    // Setup HTTP routes
    this.setupHttpRoutes();

    // Setup Socket.IO event handlers
    this.setupSocketHandlers();

    // Register HTTP API
    registerHttpApi(this.app, {
      onLobbyUpdated: lobbyPayload => {
        const mapped = this.lobbyManager.cacheLobbyFromPayload(lobbyPayload);
        this.io.emit('lobbyUpdated', mapped);
      },
      onLobbyClosed: lobbyId => {
        this.lobbyManager.removeLobbyFromCache(lobbyId);
        this.io.emit('lobbyClosed', { lobbyId });
      },
      onPlayerLeftLobby: (playerId, lobbyId) => {
        this.lobbyManager.removePlayerFromLobbyMapping(playerId);
        const socketId = this.connectionManager.getSocketId(playerId);
        if (socketId) {
          const socket = this.io.sockets.sockets.get(socketId);
          socket?.leave(lobbyId);
        }
        logger.info(
          `Player ${playerId} left lobby ${lobbyId} via HTTP API - cleared in-memory state`
        );
      },
      onStartLobbyGame: (lobbyId, hostId) =>
        this.gameManager.startLobbyGameForHost(lobbyId, hostId),
    });
  }

  /**
   * Get allowed origins for CORS configuration
   */
  private getAllowedOrigins():
    | string
    | string[]
    | ((
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void) {
    const { webAppOrigin } = this.config;
    if (!webAppOrigin) {
      logger.warn(
        'WEB_APP_ORIGIN not set - allowing all origins (development only)'
      );
      return (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => {
        callback(null, true);
      };
    }

    // Support comma-separated origins
    const origins = webAppOrigin.split(',').map(o => o.trim());

    // Expand origins to include both HTTP and HTTPS versions
    const expandedOrigins: string[] = [];
    origins.forEach(origin => {
      expandedOrigins.push(origin);
      if (origin.startsWith('http://')) {
        expandedOrigins.push(origin.replace('http://', 'https://'));
      }
      if (origin.startsWith('https://')) {
        expandedOrigins.push(origin.replace('https://', 'http://'));
      }
    });

    // Remove duplicates
    const uniqueOrigins = [...new Set(expandedOrigins)];

    // Check if any origin contains a wildcard
    const hasWildcard = uniqueOrigins.some(origin => origin.startsWith('*.'));

    // If single origin and no wildcard, return string directly
    if (uniqueOrigins.length === 1 && !hasWildcard) {
      return uniqueOrigins[0];
    }

    // Multiple origins or wildcard present - use function to check dynamically
    return (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      let originHostname: string;
      try {
        const originUrl = new URL(origin);
        originHostname = originUrl.hostname;
      } catch {
        originHostname = origin.replace(/^https?:\/\//, '').split('/')[0];
      }

      const isAllowed = uniqueOrigins.some(allowedOrigin => {
        if (allowedOrigin.startsWith('*.')) {
          const domain = allowedOrigin.slice(2);
          let allowedHostname: string;
          try {
            const allowedUrl = new URL(domain);
            allowedHostname = allowedUrl.hostname;
          } catch {
            allowedHostname = domain.replace(/^https?:\/\//, '').split('/')[0];
          }
          return (
            originHostname === allowedHostname ||
            originHostname.endsWith('.' + allowedHostname)
          );
        }
        if (origin === allowedOrigin) {
          return true;
        }
        const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
        const allowedWithoutProtocol = allowedOrigin.replace(
          /^https?:\/\//,
          ''
        );
        return originWithoutProtocol === allowedWithoutProtocol;
      });
      callback(null, isAllowed);
    };
  }

  /**
   * Setup HTTP routes
   */
  private setupHttpRoutes(): void {
    this.app.get('/ping', (_req, res) => {
      res.status(200).send('pong');
    });

    this.app.get('/connected-players', (_req, res) => {
      const playersIdAndName: PlayerIdAndName[] = [];
      this.connectionManager.getConnectedPlayers().forEach(playerInfo => {
        playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
      });
      res.status(200).json(playersIdAndName);
    });

    // Test-only endpoint for resetting server state between E2E tests
    if (process.env.NODE_ENV !== 'production') {
      this.app.post('/api/test/reset', (req, res) => {
        const { userId, scopes = ['all'] } = req.body as TestResetRequest;

        logger.info(
          `[TEST] Reset requested - userId: ${
            userId ?? 'all'
          }, scopes: ${scopes.join(', ')}`
        );

        const response: TestResetResponse = {
          success: true,
          cleared: {},
        };

        const shouldClear = (
          scope: 'lobbies' | 'games' | 'connections'
        ): boolean => scopes.includes('all') || scopes.includes(scope);

        // Clear lobby state
        if (shouldClear('lobbies')) {
          let lobbiesCleared = 0;
          const playersCleared: string[] = [];

          if (userId) {
            const lobbyId = this.lobbyManager.getLobbyIdForPlayer(userId);
            if (lobbyId) {
              this.lobbyManager.removePlayerFromLobbyMapping(userId);
              playersCleared.push(userId);

              const socketId = this.connectionManager.getSocketId(userId);
              if (socketId) {
                const socket = this.io.sockets.sockets.get(socketId);
                socket?.leave(lobbyId);
              }

              const lobby = this.lobbyManager.getLobby(lobbyId);
              if (lobby) {
                lobby.players = lobby.players.filter(
                  p => p.playerId !== userId
                );
                lobby.disconnectedPlayerIds =
                  lobby.disconnectedPlayerIds.filter(id => id !== userId);

                if (lobby.players.length === 0) {
                  this.lobbyManager.removeLobbyFromCache(lobbyId);
                  lobbiesCleared++;
                  logger.info(`[TEST] Removed empty lobby: ${lobbyId}`);
                }
              }
              logger.info(
                `[TEST] Cleared lobby membership for user: ${userId}`
              );
            }
          } else {
            const allLobbies = this.lobbyManager.getAllLobbies();
            allLobbies.forEach((_, lobbyId) => {
              this.lobbyManager.removeLobbyFromCache(lobbyId);
              lobbiesCleared++;
            });
            logger.info(`[TEST] Cleared all lobbies: ${lobbiesCleared}`);
          }

          response.cleared.lobbies = lobbiesCleared;
          if (playersCleared.length > 0) {
            response.cleared.players = playersCleared;
          }
        }

        // Clear game state
        if (shouldClear('games')) {
          let gamesCleared = 0;

          if (userId) {
            const lobbyId = this.lobbyManager.getLobbyIdForPlayer(userId);
            if (lobbyId && this.gameLoopsByLobbyId.has(lobbyId)) {
              this.gameManager.clearActiveGameArtifacts(lobbyId);
              gamesCleared++;
              logger.info(
                `[TEST] Cleared game for user ${userId} in lobby ${lobbyId}`
              );
            }
          } else {
            this.gameLoopsByLobbyId.forEach((_gameLoop, lobbyId) => {
              this.gameManager.clearActiveGameArtifacts(lobbyId);
              gamesCleared++;
            });
            logger.info(`[TEST] Cleared all games: ${gamesCleared}`);
          }

          response.cleared.games = gamesCleared;
        }

        // Clear connection state
        if (shouldClear('connections')) {
          let connectionsCleared = 0;

          if (userId) {
            const socketId = this.connectionManager.getSocketId(userId);
            if (socketId) {
              const socket = this.io.sockets.sockets.get(socketId);
              if (socket) {
                socket.disconnect(true);
                connectionsCleared++;
              }
            }
            this.connectionManager.deletePlayer(userId);
            this.connectionManager.deleteSocketId(userId);
            if (socketId) {
              this.connectionManager.deletePlayerId(socketId);
            }
            this.disconnectHandler.clearPlayerDisconnectTimer(userId);
            logger.info(`[TEST] Cleared connection for user: ${userId}`);
          } else {
            this.connectionManager
              .getConnectedPlayers()
              .forEach((_, playerId) => {
                const socketId = this.connectionManager.getSocketId(playerId);
                if (socketId) {
                  const socket = this.io.sockets.sockets.get(socketId);
                  if (socket) {
                    socket.disconnect(true);
                    connectionsCleared++;
                  }
                  this.connectionManager.deletePlayerId(socketId);
                }
                this.disconnectHandler.clearPlayerDisconnectTimer(playerId);
              });
            this.connectionManager.clearAll();
            logger.info(
              `[TEST] Cleared all connections: ${connectionsCleared}`
            );
          }

          response.cleared.connections = connectionsCleared;
        }

        logger.info('[TEST] Reset complete:', response.cleared);
        res.status(200).json(response);
      });

      logger.info('[TEST] Test reset endpoint enabled at POST /api/test/reset');

      // Test-only endpoint for fetching game history counts
      this.app.get('/api/test/game-history', async (req, res) => {
        const { lobbyId } = req.query;

        if (!lobbyId || typeof lobbyId !== 'string') {
          res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'lobbyId query parameter is required',
          });
          return;
        }

        try {
          const counts = await getGameHistoryCountsByLobbyId(lobbyId);
          res.status(200).json(counts);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to fetch game history';
          logger.error(
            `[TEST] Error fetching game history for lobby ${lobbyId}:`,
            error
          );
          res.status(500).json({
            error: 'GAME_HISTORY_FETCH_FAILED',
            message,
          });
        }
      });

      logger.info(
        '[TEST] Test game history endpoint enabled at GET /api/test/game-history'
      );
    }
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupSocketHandlers(): void {
    this.io.on('connection', socket => {
      const origin = socket.handshake.headers.origin;
      const address = socket.handshake.address;

      logger.info(
        `[Connection] 🔌 Connection event received for socket ${socket.id}`,
        {
          origin: origin || 'proxy',
          address,
          hasUserId: !!(socket.data as { userId?: string }).userId,
        }
      );

      const userId = (socket.data as { userId?: string }).userId;
      if (!userId) {
        logger.warn(
          `[Connection] ❌ Connection without userId, disconnecting socket ${socket.id}`
        );
        socket.disconnect(true);
        return;
      }
      logger.info(`[Connection] ✅ Socket ${socket.id} has userId: ${userId}`);

      logger.info(
        `[Connection] ✓ Socket connected: ${socket.id} from ${
          origin || 'proxy'
        } (${address})`
      );

      // Send connected players to clients even before login
      this.emitConnectedPlayers();

      socket.on('login', (data: LoginData) => {
        logger.info('Received login event from socket:', socket.id);
        this.handleLogin(socket, data).catch(err => {
          logger.error('Login failed', err);
          socket.emit('loginRejected', {
            reason: 'INVALID_TOKEN',
            message: 'Login failed',
          });
        });
      });

      socket.on(
        'createLobby',
        (
          data: {
            playerCount: number;
            name?: string;
            visibility?: 'public' | 'private' | 'friends';
            isFixedSize?: boolean;
          },
          callback?: (response: any) => void
        ) => {
          logger.info(
            'Received createLobby event from socket:',
            socket.id,
            'playerCount:',
            data?.playerCount
          );
          this.lobbyManager.handleCreateLobby(socket, data, callback);
        }
      );

      socket.on(
        'joinLobby',
        (data: { lobbyId: string }, callback?: (response: any) => void) => {
          logger.info(
            'Received joinLobby event from socket:',
            socket.id,
            'lobbyId:',
            data?.lobbyId
          );
          this.lobbyManager.handleJoinLobby(socket, data, callback);
        }
      );

      socket.on(
        'leaveLobby',
        (data: { lobbyId: string }, callback?: (response: any) => void) => {
          logger.info(
            'Received leaveLobby event from socket:',
            socket.id,
            'lobbyId:',
            data?.lobbyId
          );
          this.lobbyManager.handleLeaveLobby(socket, data, callback);
        }
      );

      socket.on(
        'kickPlayer',
        (
          data: { lobbyId: string; targetPlayerId: string },
          callback?: (response: any) => void
        ) => {
          logger.info(
            'Received kickPlayer event from socket:',
            socket.id,
            'lobbyId:',
            data?.lobbyId,
            'target:',
            data?.targetPlayerId
          );
          this.lobbyManager.handleKickPlayer(socket, data, callback);
        }
      );

      socket.on(
        'updateLobbySize',
        (
          data: { lobbyId: string; playerCount: number },
          callback?: (response: any) => void
        ) => {
          logger.info(
            'Received updateLobbySize event from socket:',
            socket.id,
            'lobbyId:',
            data?.lobbyId,
            'playerCount:',
            data?.playerCount
          );
          this.lobbyManager.handleUpdateLobbySize(socket, data, callback);
        }
      );

      socket.on(
        'updateLobbyName',
        (
          data: { lobbyId: string; name: string },
          callback?: (response: any) => void
        ) => {
          logger.info(
            'Received updateLobbyName event from socket:',
            socket.id,
            'lobbyId:',
            data?.lobbyId,
            'name:',
            data?.name
          );
          this.lobbyManager.handleUpdateLobbyName(socket, data, callback);
        }
      );

      socket.on('listLobbies', () => {
        logger.info('Received listLobbies request from socket:', socket.id);
        this.lobbyManager.handleListLobbies(socket);
      });

      socket.on(
        'startLobbyGame',
        (data: { lobbyId: string }, callback?: (response: any) => void) => {
          logger.info(
            'Received startLobbyGame event from socket:',
            socket.id,
            'lobbyId:',
            data?.lobbyId
          );
          this.gameManager
            .handleStartLobbyGame(socket, data, callback)
            .catch(error => {
              logger.error('Error starting lobby game:', error);
              if (callback) callback({ error: 'Failed to start game' });
              socket.emit('error', { message: 'Failed to start game' });
            });
        }
      );

      socket.on('restartGame', () => {
        logger.info('Received restartGame event from socket:', socket.id);
        this.gameManager.handleRestartGame(socket).catch(error => {
          logger.error('Error restarting game:', error);
          socket.emit('error', { message: 'Failed to restart game' });
        });
      });

      socket.on('getConnectedPlayers', () => {
        logger.info(
          'Received getConnectedPlayers request from socket:',
          socket.id
        );
        this.cleanupInactiveBots();

        const playerId = this.connectionManager.getPlayerId(socket.id);
        const playerLobbyId = playerId
          ? this.lobbyManager.getLobbyIdForPlayer(playerId)
          : null;

        const activeBotIds = new Set<string>();
        if (playerLobbyId && this.gameLoopsByLobbyId.has(playerLobbyId)) {
          const botIds = this.currentGameBotIdsByLobbyId.get(playerLobbyId);
          if (botIds) {
            botIds.forEach(botId => activeBotIds.add(botId));
          }
        }

        const playersIdAndName: PlayerIdAndName[] = [];
        this.connectionManager.getConnectedPlayers().forEach(playerInfo => {
          const isBot = !(playerInfo.agent instanceof WebSocketAgent);
          if (!isBot || activeBotIds.has(playerInfo.id)) {
            playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
          }
        });
        logger.info(
          'Sending connected players to requesting client:',
          playersIdAndName
        );
        socket.emit('connectedPlayers', playersIdAndName);
      });

      socket.on('disconnect', reason => {
        this.disconnectHandler.handleSocketDisconnect(socket.id, reason, () =>
          this.emitConnectedPlayers()
        );
      });

      socket.on('heartbeat', () => {
        logger.info('Received heartbeat from client');
      });
    });
  }

  /**
   * Handle login event
   */
  private async handleLogin(socket: Socket, data: LoginData): Promise<void> {
    try {
      const socketAuthedUserId = (socket.data as { userId?: string }).userId;
      if (!socketAuthedUserId) {
        logger.warn(
          `[handleLogin] Missing middleware-authenticated userId for socket ${socket.id}`
        );
        socket.emit('loginRejected', {
          reason: 'INVALID_TOKEN',
          message: 'Socket is not authenticated',
        });
        return;
      }

      const payloadToken = data?.accessToken;
      if (payloadToken) {
        try {
          const { userId: payloadUserId } = await verifyAccessToken(
            payloadToken
          );
          if (payloadUserId !== socketAuthedUserId) {
            logger.warn(
              `[handleLogin] Token/user mismatch for socket ${socket.id}: ` +
                `handshake user ${socketAuthedUserId} vs login user ${payloadUserId}`
            );
            socket.emit('loginRejected', {
              reason: 'TOKEN_MISMATCH',
              message: 'Login token does not match authenticated socket',
            });
            return;
          }
        } catch (error) {
          logger.warn(
            `[handleLogin] Ignoring invalid login token for socket ${socket.id} ` +
              '(socket already authenticated)',
            error
          );
        }
      }

      const profile = await getProfile(socketAuthedUserId);
      const displayName = profile?.display_name ?? 'Player';
      const playerId = socketAuthedUserId;

      let agent: WebSocketAgent | null = null;
      const existingPlayerInfo = this.connectionManager.getPlayer(playerId);

      if (
        existingPlayerInfo &&
        existingPlayerInfo.agent instanceof WebSocketAgent
      ) {
        agent = existingPlayerInfo.agent;
        if (existingPlayerInfo.agent.socket.id !== socket.id) {
          logger.info(
            `[handleLogin] Player ${playerId} reconnecting: old socket ${existingPlayerInfo.agent.socket.id}, new socket ${socket.id}`
          );
          if (existingPlayerInfo.agent.socket.connected) {
            existingPlayerInfo.agent.socket.disconnect(true);
          }
          existingPlayerInfo.agent.updateSocket(socket);
        }
        existingPlayerInfo.name = displayName;
      }

      if (!agent) {
        agent = new WebSocketAgent(socket, playerId);
      }

      const playerInfo: PlayerInfo = { id: playerId, name: displayName, agent };

      this.connectionManager.setSocketId(playerId, socket.id);
      this.connectionManager.setPlayerId(socket.id, playerId);
      this.connectionManager.setPlayer(playerId, playerInfo);

      let reconnectLobbyId = this.lobbyManager.getLobbyIdForPlayer(playerId);
      let reconnectLobby = reconnectLobbyId
        ? this.lobbyManager.getLobby(reconnectLobbyId)
        : null;

      if (!reconnectLobby) {
        const allLobbies = this.lobbyManager.getAllLobbies();
        for (const [lobbyId, lobby] of allLobbies.entries()) {
          if (lobby.players.some(p => p.playerId === playerId)) {
            reconnectLobbyId = lobbyId;
            reconnectLobby = lobby;
            break;
          }
        }

        if (!reconnectLobby) {
          try {
            const dbLobbyId = await getPlayerActiveLobbyId(playerId);
            if (dbLobbyId) {
              logger.info(
                `[handleLogin] Found active lobby ${dbLobbyId} in database for player ${playerId}, restoring...`
              );
              reconnectLobbyId = dbLobbyId;
              reconnectLobby = await this.refreshLobbyFromSupabase(dbLobbyId);
              if (reconnectLobby) {
                logger.info(
                  `[handleLogin] Successfully restored lobby ${reconnectLobby.name} from database`
                );
              } else {
                logger.warn(
                  `[handleLogin] Failed to load lobby ${dbLobbyId} from database`
                );
                reconnectLobbyId = undefined;
              }
            }
          } catch (error) {
            logger.error(
              '[handleLogin] Error checking database for active lobby:',
              error
            );
          }
        }
      }

      if (reconnectLobbyId && reconnectLobby) {
        if (reconnectLobby.disconnectedPlayerIds.includes(playerId)) {
          this.disconnectHandler.clearPlayerDisconnectTimer(playerId);
          reconnectLobby.disconnectedPlayerIds =
            reconnectLobby.disconnectedPlayerIds.filter(id => id !== playerId);
        }

        const playerInLobby = reconnectLobby.players.some(
          p => p.playerId === playerId
        );
        if (!playerInLobby) {
          reconnectLobby.players.push({
            playerId,
            displayName,
          });
          logger.info(
            `Restored player ${displayName} to lobby ${reconnectLobby.name}`
          );
        }

        const hasActiveGame = this.gameLoopsByLobbyId.has(reconnectLobbyId);
        const hasGameSnapshot =
          this.mostRecentGameSnapshotByLobbyId.has(reconnectLobbyId);
        const gameWasFinished =
          reconnectLobby.status === 'finished' &&
          (hasGameSnapshot || reconnectLobby.finishedAt);

        if (reconnectLobby.status === 'in_progress' && !hasActiveGame) {
          reconnectLobby.status = 'waiting';
          reconnectLobby.finishedAt = null;
          try {
            const client = getServiceClient();
            await client
              .from('lobbies')
              .update({ status: 'waiting' })
              .eq('id', reconnectLobbyId);
            logger.info(
              `[handleLogin] Reset lobby ${reconnectLobby.name} from 'in_progress' to 'waiting' (no active game after server restart)`
            );
          } catch (error) {
            logger.error(
              '[handleLogin] Failed to update lobby status in database:',
              error
            );
          }
        } else if (
          reconnectLobby.status === 'finished' &&
          reconnectLobby.players.length > 0 &&
          !gameWasFinished
        ) {
          reconnectLobby.status = 'waiting';
          reconnectLobby.finishedAt = null;
          logger.info(
            `Restored lobby ${reconnectLobby.name} to waiting status (was empty, now has players)`
          );
        } else if (gameWasFinished) {
          logger.info(
            `Lobby ${reconnectLobby.name} has finished game - keeping 'finished' status to allow restart`
          );
        }

        socket.join(reconnectLobbyId);
        this.io.emit('lobbyUpdated', reconnectLobby);
        this.io.emit('playerReconnectedToLobby', {
          lobbyId: reconnectLobbyId,
          playerId,
        });
      }

      logger.info('emitting loggedIn event to client:', playerId);
      const loggedInData: PlayerIdAndName = {
        id: playerId,
        name: displayName,
      };
      socket.emit('loggedIn', loggedInData);
      this.emitConnectedPlayers();

      this.gameManager.sendMostRecentGameData(socket);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      logger.error('Supabase login failed:', message);
      socket.emit('loginRejected', { reason: 'INVALID_TOKEN', message });
    }
  }

  /**
   * Helper function to convert Supabase payload to Lobby
   */
  private lobbyFromSupabase(payload: any): Lobby {
    return {
      id: payload.id,
      name: payload.name ?? undefined,
      hostId: payload.host_id ?? '',
      maxPlayers: payload.max_players ?? payload.playerCount ?? 2,
      playerCount: payload.max_players ?? payload.playerCount ?? 2,
      currentPlayers: payload.current_players ?? payload.players?.length ?? 0,
      players: (payload.players ?? []).map((p: any) => ({
        playerId: p.playerId,
        displayName: p.displayName,
      })),
      status: payload.status ?? 'waiting',
      createdAt: payload.created_at
        ? new Date(payload.created_at).getTime()
        : Date.now(),
      finishedAt: payload.finished_at ?? null,
      disconnectedPlayerIds: [],
      isFixedSize: payload.is_fixed_size ?? true,
    };
  }

  /**
   * Helper function to cleanup bots for a lobby
   */
  private cleanupBots(lobbyId: string): void {
    this.connectionManager.cleanupBots(
      lobbyId,
      this.currentGameBotIdsByLobbyId
    );
    this.emitConnectedPlayers();
  }

  /**
   * Clean up bots that are not part of any active game
   */
  private cleanupInactiveBots(): void {
    this.connectionManager.cleanupInactiveBots(
      this.currentGameBotIdsByLobbyId,
      this.gameLoopsByLobbyId
    );
  }

  /**
   * Refresh lobby from Supabase
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

  /**
   * Emit connected players to all clients
   */
  private emitConnectedPlayers(): void {
    this.connectionManager.emitConnectedPlayers(
      this.currentGameBotIdsByLobbyId,
      this.gameLoopsByLobbyId
    );
  }

  /**
   * Start the server
   */
  start(): void {
    this.httpServer.listen(this.config.port, () => {
      logger.info(`Server is running on port ${this.config.port}`);
    });
  }
}
