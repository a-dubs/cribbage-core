import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { GameLoop } from './gameplay/GameLoop';
import {
  ActionType,
  GameAgent,
  GameEvent,
  PlayerIdAndName,
  GameSnapshot,
  Phase,
} from './types';
import { WebSocketAgent } from './agents/WebSocketAgent';
import { ExhaustiveSimpleAgent } from './agents/ExhaustiveSimpleAgent';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import {
  uniqueNamesGenerator,
  adjectives,
  animals,
} from 'unique-names-generator';
import { v4 as uuidv4 } from 'uuid';
import { registerHttpApi } from './httpApi';
import {
  createLobby,
  getLobbyWithPlayers,
  getPlayerActiveLobbyId,
  joinLobby as joinLobbyInSupabase,
  leaveLobby as leaveLobbyInSupabase,
  listLobbies as listLobbiesFromSupabase,
  completeGameRecord,
  getProfile,
  getServiceClient,
  removeLobbyPlayer,
  startLobby,
  toUuidOrNull,
  updateLobbyName,
  updateLobbySize,
  verifyAccessToken,
  type LobbyPayload,
} from './services/supabaseService';
import { applyAuthMiddleware } from './server/AuthMiddleware';
import { ConnectionManager } from './server/ConnectionManager';
import { DisconnectHandler } from './server/DisconnectHandler';
import { LobbyManager } from './server/LobbyManager';
import { PersistenceService } from './server/PersistenceService';
import { GameManager } from './server/GameManager';
import {
  PlayerInfo,
  PlayerInLobby,
  Lobby,
  LoginData,
  TestResetRequest,
  TestResetResponse,
  PLAYER_DISCONNECT_GRACE_MS,
  FINISHED_LOBBY_TTL_MS,
  FINISHED_LOBBY_SWEEP_INTERVAL_MS,
  STALE_WAITING_LOBBY_MS,
  STALE_IN_PROGRESS_LOBBY_MS,
  DEFAULT_LOBBY_ID,
} from './server/types';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const SUPABASE_AUTH_ENABLED = process.env.SUPABASE_AUTH_ENABLED === 'true';
const SUPABASE_LOBBIES_ENABLED =
  process.env.SUPABASE_LOBBIES_ENABLED === 'true';

logger.info('PORT:', PORT);
logger.info('WEB_APP_ORIGIN:', WEB_APP_ORIGIN);

logger.info('cribbage-core server starting...');

// Support multiple origins or wildcard for development
// Also automatically supports both HTTP and HTTPS versions of origins
const getAllowedOrigins = ():
  | string
  | string[]
  | ((
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => void) => {
  if (!WEB_APP_ORIGIN) {
    // If no origin specified, allow all (development only)
    logger.warn(
      'WEB_APP_ORIGIN not set - allowing all origins (development only)'
    );
    // Return a function that always allows
    return (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      callback(null, true);
    };
  }

  // Support comma-separated origins
  const origins = WEB_APP_ORIGIN.split(',').map(o => o.trim());

  // Expand origins to include both HTTP and HTTPS versions
  const expandedOrigins: string[] = [];
  origins.forEach(origin => {
    expandedOrigins.push(origin);
    // If origin is HTTP, also add HTTPS version
    if (origin.startsWith('http://')) {
      expandedOrigins.push(origin.replace('http://', 'https://'));
    }
    // If origin is HTTPS, also add HTTP version
    if (origin.startsWith('https://')) {
      expandedOrigins.push(origin.replace('https://', 'http://'));
    }
  });

  // Remove duplicates
  const uniqueOrigins = [...new Set(expandedOrigins)];

  // Check if any origin contains a wildcard - if so, use dynamic matcher
  const hasWildcard = uniqueOrigins.some(origin => origin.startsWith('*.'));

  // If single origin and no wildcard, return string directly for exact match
  if (uniqueOrigins.length === 1 && !hasWildcard) {
    return uniqueOrigins[0];
  }

  // Multiple origins or wildcard present - use function to check dynamically
  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    if (!origin) {
      callback(null, true); // Allow requests with no origin (e.g., mobile apps, Postman)
      return;
    }

    // Extract hostname from origin URL for proper comparison
    let originHostname: string;
    try {
      const originUrl = new URL(origin);
      originHostname = originUrl.hostname;
    } catch {
      // If origin is not a valid URL, fall back to treating it as hostname
      originHostname = origin.replace(/^https?:\/\//, '').split('/')[0];
    }

    const isAllowed = uniqueOrigins.some(allowedOrigin => {
      // Support wildcard subdomains
      if (allowedOrigin.startsWith('*.')) {
        const domain = allowedOrigin.slice(2);
        // Extract hostname from allowed origin if it's a full URL
        let allowedHostname = domain;
        try {
          const allowedUrl = new URL(domain);
          allowedHostname = allowedUrl.hostname;
        } catch {
          // If domain is not a valid URL, treat it as hostname
          allowedHostname = domain.replace(/^https?:\/\//, '').split('/')[0];
        }
        // Enforce dot boundary to prevent matches like badexample.com for *.example.com
        return (
          originHostname === allowedHostname ||
          originHostname.endsWith('.' + allowedHostname)
        );
      }
      // Exact match
      if (origin === allowedOrigin) {
        return true;
      }
      // Also check protocol-agnostic match (http vs https)
      const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
      const allowedWithoutProtocol = allowedOrigin.replace(/^https?:\/\//, '');
      return originWithoutProtocol === allowedWithoutProtocol;
    });
    callback(null, isAllowed);
  };
};

const allowedOrigins = getAllowedOrigins();
const app = express();
app.use(
  cors({
    origin: allowedOrigins as any,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  allowEIO3: true, // Allow Socket.IO v3 clients
  // Configuration for reverse proxy support
  transports: ['websocket', 'polling'], // Support both WebSocket and polling
  pingTimeout: 60000, // Increase timeout for slow connections/proxies
  pingInterval: 25000,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6,
  // Allow all handshake requests - auth is checked via middleware
  // Handshake validation (auth checked in middleware)
  allowRequest: (req, callback) => {
    logger.info('[Socket.IO] allowRequest called', {
      url: req.url,
      origin: req.headers?.origin,
    });
    callback(null, true);
  },
});

// Apply authentication middleware
applyAuthMiddleware(io);

// Connection manager for player/socket tracking
const connectionManager = new ConnectionManager(io, logger);

// Game state maps (shared with LobbyManager for cleanup)
const gameIdByLobbyId: Map<string, string> = new Map();
const gameLoopsByLobbyId: Map<string, GameLoop> = new Map();
const mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot> = new Map();
const currentRoundGameEventsByLobbyId: Map<string, GameEvent[]> = new Map();
const roundStartSnapshotByLobbyId: Map<string, GameSnapshot> = new Map();
const supabaseGameIdByLobbyId: Map<string, string> = new Map();
const currentGameBotIdsByLobbyId: Map<string, string[]> = new Map();
const disconnectGraceTimeouts: Map<string, NodeJS.Timeout> = new Map();

app.get('/ping', (_req, res) => {
  res.status(200).send('pong');
});

app.get('/connected-players', (_req, res) => {
  const playersIdAndName: PlayerIdAndName[] = [];
  connectionManager.getConnectedPlayers().forEach(playerInfo => {
    playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
  });
  res.status(200).json(playersIdAndName);
});

// Test-only endpoint for resetting server state between E2E tests
// Only available in non-production environments
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/test/reset', (req, res) => {
    const { userId, scopes = ['all'] } = req.body as TestResetRequest;

    logger.info(
      `[TEST] Reset requested - userId: ${userId ?? 'all'}, scopes: ${scopes.join(', ')}`
    );

    const response: TestResetResponse = {
      success: true,
      cleared: {},
    };

    const shouldClear = (scope: 'lobbies' | 'games' | 'connections'): boolean =>
      scopes.includes('all') || scopes.includes(scope);

    // Helper to check if a player matches the target (or if no target, match all)
    const matchesTarget = (playerId: string): boolean =>
      !userId || playerId === userId;

    // Clear lobby state
    if (shouldClear('lobbies')) {
      let lobbiesCleared = 0;
      const playersCleared: string[] = [];

      if (userId) {
        // Clear specific user's lobby membership
        const lobbyId = lobbyManager.getLobbyIdForPlayer(userId);
        if (lobbyId) {
          lobbyManager.removePlayerFromLobbyMapping(userId);
          playersCleared.push(userId);

          // Also leave the socket room
          const socketId = connectionManager.getSocketId(userId);
          if (socketId) {
            const socket = io.sockets.sockets.get(socketId);
            socket?.leave(lobbyId);
          }

          // Check if lobby should be cleaned up
          const lobby = lobbyManager.getLobby(lobbyId);
          if (lobby) {
            // Remove player from lobby's player list
            lobby.players = lobby.players.filter(p => p.playerId !== userId);
            lobby.disconnectedPlayerIds = lobby.disconnectedPlayerIds.filter(
              id => id !== userId
            );

            // If lobby is now empty, remove it
            if (lobby.players.length === 0) {
              lobbyManager.removeLobbyFromCache(lobbyId);
              lobbiesCleared++;
              logger.info(`[TEST] Removed empty lobby: ${lobbyId}`);
            }
          }
          logger.info(`[TEST] Cleared lobby membership for user: ${userId}`);
        }
      } else {
        // Clear all lobby state
        const allLobbies = lobbyManager.getAllLobbies();
        allLobbies.forEach((_, lobbyId) => {
          lobbyManager.removeLobbyFromCache(lobbyId);
          lobbiesCleared++;
        });
        // Note: lobbyIdByPlayerId is internal to LobbyManager, so we clear via removeLobbyFromCache
        // which already handles clearing player mappings
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
        // Find and clear games the user is in
        const lobbyId = lobbyManager.getLobbyIdForPlayer(userId);
        if (lobbyId && gameLoopsByLobbyId.has(lobbyId)) {
          gameManager.clearActiveGameArtifacts(lobbyId);
          gamesCleared++;
          logger.info(`[TEST] Cleared game for user ${userId} in lobby ${lobbyId}`);
        }
      } else {
        // Clear all games
        gameLoopsByLobbyId.forEach((gameLoop, lobbyId) => {
          gameManager.clearActiveGameArtifacts(lobbyId);
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
        // Disconnect specific user
        const socketId = connectionManager.getSocketId(userId);
        if (socketId) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.disconnect(true);
            connectionsCleared++;
          }
        }
        connectionManager.deletePlayer(userId);
        connectionManager.deleteSocketId(userId);
        if (socketId) {
          connectionManager.deletePlayerId(socketId);
        }
        disconnectHandler.clearPlayerDisconnectTimer(userId);
        logger.info(`[TEST] Cleared connection for user: ${userId}`);
      } else {
        // Disconnect all users
        connectionManager.getConnectedPlayers().forEach((_, playerId) => {
          const socketId = connectionManager.getSocketId(playerId);
          if (socketId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.disconnect(true);
              connectionsCleared++;
            }
            connectionManager.deletePlayerId(socketId);
          }
          disconnectHandler.clearPlayerDisconnectTimer(playerId);
        });
        connectionManager.clearAll();
        logger.info(`[TEST] Cleared all connections: ${connectionsCleared}`);
      }

      response.cleared.connections = connectionsCleared;
    }

    logger.info(`[TEST] Reset complete:`, response.cleared);
    res.status(200).json(response);
  });

  logger.info('[TEST] Test reset endpoint enabled at POST /api/test/reset');
}

// Helper function to convert Supabase payload to Lobby (used by LobbyManager and elsewhere)
function lobbyFromSupabase(payload: any): Lobby {
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

// Helper functions for cleanup (used by LobbyManager and elsewhere)
function cleanupBots(lobbyId: string): void {
  connectionManager.cleanupBots(lobbyId, currentGameBotIdsByLobbyId);
  emitConnectedPlayers();
}

// Wrapper object for clearPlayerDisconnectTimer to avoid circular dependency
const clearPlayerDisconnectTimerWrapper = {
  fn: (playerId: string) => {
    // Will be set after DisconnectHandler is created
  },
};

// Create LobbyManager instance
const lobbyManager = new LobbyManager({
  io,
  connectionManager,
  disconnectGraceTimeouts,
  gameLoopsByLobbyId,
  mostRecentGameSnapshotByLobbyId,
  currentRoundGameEventsByLobbyId,
  roundStartSnapshotByLobbyId,
  supabaseGameIdByLobbyId,
  currentGameBotIdsByLobbyId,
  cleanupBots,
  clearPlayerDisconnectTimer: (playerId: string) =>
    clearPlayerDisconnectTimerWrapper.fn(playerId),
  lobbyFromSupabase,
  SUPABASE_LOBBIES_ENABLED,
});

// Create DisconnectHandler instance
const disconnectHandler = new DisconnectHandler({
  io,
  lobbyManager,
  connectionManager,
  disconnectGraceTimeouts,
  gameLoopsByLobbyId,
  mostRecentGameSnapshotByLobbyId,
  currentRoundGameEventsByLobbyId,
  roundStartSnapshotByLobbyId,
  supabaseGameIdByLobbyId,
  gameIdByLobbyId,
  currentGameBotIdsByLobbyId,
  cleanupBots,
});

// Set the function reference now that disconnectHandler is created
clearPlayerDisconnectTimerWrapper.fn = (playerId: string) =>
  disconnectHandler.clearPlayerDisconnectTimer(playerId);

// Create PersistenceService instance
const persistenceService = new PersistenceService(logger);

/**
 * Clean up bots that are not part of any active game
 */
function cleanupInactiveBots(): void {
  connectionManager.cleanupInactiveBots(
    currentGameBotIdsByLobbyId,
    gameLoopsByLobbyId
  );
}

// Create GameManager instance
const gameManager = new GameManager({
  io,
  connectionManager,
  lobbyManager,
  disconnectHandler,
  persistenceService,
  gameLoopsByLobbyId,
  mostRecentGameSnapshotByLobbyId,
  currentRoundGameEventsByLobbyId,
  roundStartSnapshotByLobbyId,
  supabaseGameIdByLobbyId,
  currentGameBotIdsByLobbyId,
  gameIdByLobbyId,
  cleanupBots,
  emitConnectedPlayers,
  SUPABASE_AUTH_ENABLED,
});

// Cleanup timer is now managed by LobbyManager

registerHttpApi(app, {
  onLobbyUpdated: lobbyPayload => {
    const mapped = lobbyManager.cacheLobbyFromPayload(lobbyPayload);
    io.emit('lobbyUpdated', mapped);
  },
  onLobbyClosed: lobbyId => {
    lobbyManager.removeLobbyFromCache(lobbyId);
    io.emit('lobbyClosed', { lobbyId });
  },
  onPlayerLeftLobby: (playerId, lobbyId) => {
    // Clear in-memory lobby membership when player leaves via HTTP API
    lobbyManager.removePlayerFromLobbyMapping(playerId);
    // Make the player's socket leave the lobby room
    const socketId = connectionManager.getSocketId(playerId);
    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      socket?.leave(lobbyId);
    }
    logger.info(
      `Player ${playerId} left lobby ${lobbyId} via HTTP API - cleared in-memory state`
    );
  },
  onStartLobbyGame: (lobbyId, hostId) => gameManager.startLobbyGameForHost(lobbyId, hostId),
});

async function refreshLobbyFromSupabase(
  lobbyId: string
): Promise<Lobby | null> {
  try {
    const payload = await getLobbyWithPlayers(lobbyId);
    if (!payload) return null;
    return lobbyManager.cacheLobbyFromPayload(payload);
  } catch (error) {
    logger.error('[Supabase] Failed to refresh lobby', lobbyId, error);
    return null;
  }
}

// Generate unique player ID from username, handling conflicts
function getUniquePlayerId(username: string, socketId: string): string {
  return connectionManager.getUniquePlayerId(username, socketId);
}

io.on('connection', socket => {
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

  if (SUPABASE_AUTH_ENABLED) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) {
      logger.warn(
        `[Connection] ❌ Connection without userId, disconnecting socket ${socket.id}`
      );
      socket.disconnect(true);
      return;
    }
    logger.info(`[Connection] ✅ Socket ${socket.id} has userId: ${userId}`);
  }

  // Auth was already checked in middleware, so this socket is authenticated
  logger.info(
    `[Connection] ✓ Socket connected: ${socket.id} from ${
      origin || 'proxy'
    } (${address})`
  );

  // send the connected players to the clients even before login
  // so they can see who is already connected
  emitConnectedPlayers();

  socket.on('login', (data: LoginData) => {
    logger.info('Received login event from socket:', socket.id);
    handleLogin(socket, data).catch(err => {
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
      lobbyManager.handleCreateLobby(socket, data, callback);
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
      lobbyManager.handleJoinLobby(socket, data, callback);
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
      lobbyManager.handleLeaveLobby(socket, data, callback);
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
      lobbyManager.handleKickPlayer(socket, data, callback);
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
      lobbyManager.handleUpdateLobbySize(socket, data, callback);
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
      lobbyManager.handleUpdateLobbyName(socket, data, callback);
    }
  );

  socket.on('listLobbies', () => {
    logger.info('Received listLobbies request from socket:', socket.id);
    lobbyManager.handleListLobbies(socket);
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
      gameManager.handleStartLobbyGame(socket, data, callback).catch(error => {
        logger.error('Error starting lobby game:', error);
        if (callback) callback({ error: 'Failed to start game' });
        socket.emit('error', { message: 'Failed to start game' });
      });
    }
  );

  socket.on('restartGame', () => {
    logger.info('Received restartGame event from socket:', socket.id);
    gameManager.handleRestartGame(socket).catch(error => {
      logger.error('Error restarting game:', error);
      socket.emit('error', { message: 'Failed to restart game' });
    });
  });

  socket.on('getConnectedPlayers', () => {
    logger.info('Received getConnectedPlayers request from socket:', socket.id);
    // Clean up inactive bots before responding
    cleanupInactiveBots();

    const playerId = connectionManager.getPlayerId(socket.id);
    const playerLobbyId = playerId ? lobbyManager.getLobbyIdForPlayer(playerId) : null;

    // Collect bot IDs from the requesting player's lobby (if they're in a lobby with an active game)
    const activeBotIds = new Set<string>();
    if (playerLobbyId && gameLoopsByLobbyId.has(playerLobbyId)) {
      const botIds = currentGameBotIdsByLobbyId.get(playerLobbyId);
      if (botIds) {
        botIds.forEach(botId => activeBotIds.add(botId));
      }
    }

    // Send current connected players to this specific client
    const playersIdAndName: PlayerIdAndName[] = [];
    connectionManager.getConnectedPlayers().forEach(playerInfo => {
      const isBot = !(playerInfo.agent instanceof WebSocketAgent);
      // Include all human players, and only bots from the requesting player's lobby
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

  // NOTE: Old startGame/startGameWithPlayerCount/restartGame handlers removed.
  // Use lobby system instead: createLobby -> joinLobby -> startLobbyGame.

  // NOTE: playAgain handler removed - use lobby system for rematch.

  socket.on('disconnect', reason => {
    disconnectHandler.handleSocketDisconnect(socket.id, reason, emitConnectedPlayers);
  });

  socket.on('heartbeat', () => {
    logger.info('Received heartbeat from client');
  });
});

// Lobby handlers moved to LobbyManager
// Game lifecycle functions moved to GameManager

// Lobby handlers moved to LobbyManager

async function handleLogin(socket: Socket, data: LoginData): Promise<void> {
  if (!SUPABASE_AUTH_ENABLED) {
    socket.emit('loginRejected', {
      reason: 'AUTH_DISABLED',
      message: 'Supabase auth is disabled',
    });
    return;
  }

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

    // Defense-in-depth: if the client also sends an access token in the
    // login payload, ensure it cannot switch identities after connection.
    const payloadToken = data?.accessToken;
    if (payloadToken) {
      try {
        const { userId: payloadUserId } = await verifyAccessToken(payloadToken);
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
        // The socket is already authenticated via middleware; do not allow a
        // bad/expired payload token to block login as the authenticated user.
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
    // Check if this playerId already has an agent (reconnection scenario)
    const existingPlayerInfo = connectionManager.getPlayer(playerId);

    if (
      existingPlayerInfo &&
      existingPlayerInfo.agent instanceof WebSocketAgent
    ) {
      agent = existingPlayerInfo.agent;
      // If the socket ID is different, this is a reconnection - update the socket
      if (existingPlayerInfo.agent.socket.id !== socket.id) {
        logger.info(
          `[handleLogin] Player ${playerId} reconnecting: old socket ${existingPlayerInfo.agent.socket.id}, new socket ${socket.id}`
        );
        // Disconnect the old socket if it's still connected
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

    connectionManager.setSocketId(playerId, socket.id);
    connectionManager.setPlayerId(socket.id, playerId);
    connectionManager.setPlayer(playerId, playerInfo);

    let reconnectLobbyId = lobbyManager.getLobbyIdForPlayer(playerId);
    let reconnectLobby = reconnectLobbyId
      ? lobbyManager.getLobby(reconnectLobbyId)
      : null;

    // If not found in memory, check database (handles server restart scenario)
    if (!reconnectLobby) {
      // First check in-memory maps
      const allLobbies = lobbyManager.getAllLobbies();
      for (const [lobbyId, lobby] of allLobbies.entries()) {
        if (lobby.players.some(p => p.playerId === playerId)) {
          reconnectLobbyId = lobbyId;
          reconnectLobby = lobby;
          // Note: lobbyIdByPlayerId is managed by LobbyManager, but we need to ensure it's set
          // This is handled by cacheLobbyFromPayload when we refresh from DB
          break;
        }
      }

      // If still not found, check database for active lobby membership
      if (!reconnectLobby) {
        try {
          const dbLobbyId = await getPlayerActiveLobbyId(playerId);
          if (dbLobbyId) {
            logger.info(
              `[handleLogin] Found active lobby ${dbLobbyId} in database for player ${playerId}, restoring...`
            );
            reconnectLobbyId = dbLobbyId;
            reconnectLobby = await refreshLobbyFromSupabase(dbLobbyId);
            if (reconnectLobby) {
              // refreshLobbyFromSupabase already calls cacheLobbyFromPayload which sets the mapping
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
          // Continue without restoring lobby - player can still create/join new lobbies
        }
      }
    }

    if (reconnectLobbyId && reconnectLobby) {
      if (reconnectLobby.disconnectedPlayerIds.includes(playerId)) {
        disconnectHandler.clearPlayerDisconnectTimer(playerId);
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

      const hasActiveGame = gameLoopsByLobbyId.has(reconnectLobbyId);
      const hasGameSnapshot =
        mostRecentGameSnapshotByLobbyId.has(reconnectLobbyId);
      const gameWasFinished =
        reconnectLobby.status === 'finished' &&
        (hasGameSnapshot || reconnectLobby.finishedAt);

      // If lobby is 'in_progress' but no active game is running (server restart scenario),
      // reset to 'waiting' so players can start a new game
      if (reconnectLobby.status === 'in_progress' && !hasActiveGame) {
        reconnectLobby.status = 'waiting';
        reconnectLobby.finishedAt = null;
        // Update database to reflect the status change
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
      io.emit('lobbyUpdated', reconnectLobby);
      io.emit('playerReconnectedToLobby', {
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
    emitConnectedPlayers();

    gameManager.sendMostRecentGameData(socket);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    logger.error('Supabase login failed:', message);
    socket.emit('loginRejected', { reason: 'INVALID_TOKEN', message });
  }
}

// create function that emits the current connected players to all clients
// Note: Only includes human players. Bots are included per-lobby in getConnectedPlayers handler.
function emitConnectedPlayers(): void {
  connectionManager.emitConnectedPlayers(
    currentGameBotIdsByLobbyId,
    gameLoopsByLobbyId
  );
}

function emitToLobbyPlayers(
  lobbyId: string,
  event: string,
  payload?: unknown
): void {
  io.to(lobbyId).emit(event, payload);
}

// Start the server
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
