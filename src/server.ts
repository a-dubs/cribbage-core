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
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import { v4 as uuidv4 } from 'uuid';
import { registerHttpApi } from './httpApi';
import {
  createLobby,
  getLobbyWithPlayers,
  joinLobby as joinLobbyInSupabase,
  leaveLobby as leaveLobbyInSupabase,
  listLobbies as listLobbiesFromSupabase,
  completeGameRecord,
  createGameRecord,
  getProfile,
  getServiceClient,
  persistGameEvents,
  removeLobbyPlayer,
  startLobby,
  toUuidOrNull,
  updateLobbyName,
  updateLobbySize,
  verifyAccessToken,
  type LobbyPayload,
} from './services/supabaseService';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const SUPABASE_AUTH_ENABLED = process.env.SUPABASE_AUTH_ENABLED === 'true';
const SUPABASE_LOBBIES_ENABLED = process.env.SUPABASE_LOBBIES_ENABLED === 'true';

logger.info('PORT:', PORT);
logger.info('WEB_APP_ORIGIN:', WEB_APP_ORIGIN);

logger.info('Cribbage-core server starting...');

// Support multiple origins or wildcard for development
// Also automatically supports both HTTP and HTTPS versions of origins
const getAllowedOrigins = (): string | string[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void) => {
  if (!WEB_APP_ORIGIN) {
    // If no origin specified, allow all (development only)
    logger.warn('WEB_APP_ORIGIN not set - allowing all origins (development only)');
    // Return a function that always allows
    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
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
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
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
        return originHostname === allowedHostname || originHostname.endsWith('.' + allowedHostname);
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
    callback(null, true);
  },
});

// Auth middleware (Supabase JWT required when flag enabled)
io.use((socket, next) => {
  if (!SUPABASE_AUTH_ENABLED) {
    return next();
  }
  const token = (socket.handshake.auth as { accessToken?: string } | undefined)?.accessToken;
  if (!token) {
    logger.warn(`[Auth] Missing access token from socket ${socket.id}`);
    return next(new Error('Missing access token'));
  }
  verifyAccessToken(token)
    .then(({ userId }) => {
      (socket.data as { userId?: string }).userId = userId;
      logger.info(`[Auth] Socket ${socket.id} authenticated as user ${userId}`);
      next();
    })
    .catch(err => {
      const tokenPreview = token.length > 20 ? `${token.substring(0, 20)}...` : token;
      logger.error(`[Auth] Socket auth failed for socket ${socket.id}. Token preview: ${tokenPreview}`, err);
      next(new Error('Invalid token'));
    });
});

interface PlayerInfo {
  id: string;
  name: string;
  agent: GameAgent;
}

interface PlayerInLobby {
  playerId: string;
  displayName: string;
}

interface Lobby {
  id: string;
  name?: string;
  hostId: string;
  maxPlayers: number; // 2–4
  playerCount?: number; // legacy field
  currentPlayers: number;
  players: PlayerInLobby[]; // humans only; bots are added when starting game
  status: 'waiting' | 'in_progress' | 'finished';
  createdAt: number;
  finishedAt?: number | null;
  disconnectedPlayerIds: string[];
  isFixedSize?: boolean;
}

interface LoginData {
  // Optional because auth is established at handshake time via middleware.
  // If provided, it must match the middleware-authenticated user.
  accessToken?: string;
}

const connectedPlayers: Map<string, PlayerInfo> = new Map();
const playerIdToSocketId: Map<string, string> = new Map();
const socketIdToPlayerId: Map<string, string> = new Map(); // Track socket -> player ID mapping for reconnection

app.get('/ping', (_req, res) => {
  res.status(200).send('pong');
});

app.get('/connected-players', (_req, res) => {
  const playersIdAndName: PlayerIdAndName[] = [];
  connectedPlayers.forEach(playerInfo => {
    playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
  });
  res.status(200).json(playersIdAndName);
});

// In-memory lobby state (foundational data structures for future lobby support)
const lobbiesById: Map<string, Lobby> = new Map();
const lobbyIdByPlayerId: Map<string, string> = new Map(); // Each player can be in at most one lobby
const gameIdByLobbyId: Map<string, string> = new Map();

const gameLoopsByLobbyId: Map<string, GameLoop> = new Map();
const mostRecentGameSnapshotByLobbyId: Map<string, GameSnapshot> = new Map();
const currentRoundGameEventsByLobbyId: Map<string, GameEvent[]> = new Map();
const roundStartSnapshotByLobbyId: Map<string, GameSnapshot> = new Map();
const supabaseGameIdByLobbyId: Map<string, string> = new Map();
const currentGameBotIdsByLobbyId: Map<string, string[]> = new Map();

function cacheLobbyFromPayload(payload: LobbyPayload): Lobby {
  const mapped = lobbyFromSupabase(payload);
  const playerIds = new Set(mapped.players.map(p => p.playerId));
  mapped.players.forEach(p => lobbyIdByPlayerId.set(p.playerId, mapped.id));
  // Collect entries to delete first to avoid modifying Map during iteration
  const playerIdsToDelete: string[] = [];
  for (const [playerId, lobbyId] of lobbyIdByPlayerId.entries()) {
    if (lobbyId === mapped.id && !playerIds.has(playerId)) {
      playerIdsToDelete.push(playerId);
    }
  }
  // Delete collected entries after iteration completes
  playerIdsToDelete.forEach(playerId => lobbyIdByPlayerId.delete(playerId));
  lobbiesById.set(mapped.id, mapped);
  return mapped;
}

function removeLobbyFromCache(lobbyId: string): void {
  const lobby = lobbiesById.get(lobbyId);
  if (lobby) {
    lobby.players.forEach(player => {
      if (lobbyIdByPlayerId.get(player.playerId) === lobbyId) {
        lobbyIdByPlayerId.delete(player.playerId);
      }
    });
  }
  lobbiesById.delete(lobbyId);
}

function mapPlayersForGameRecord(players: PlayerIdAndName[]): Array<{ playerId: string | null; playerName: string }> {
  return players.map(player => ({
    playerId: toUuidOrNull(player.id),
    playerName: player.name,
  }));
}

async function createSupabaseGameForLobby(lobby: Lobby, playersInfo: PlayerIdAndName[], gameLoop: GameLoop): Promise<string | null> {
  if (!SUPABASE_AUTH_ENABLED) return null;
  try {
    const gameId = await createGameRecord({
      lobbyId: lobby.id,
      players: mapPlayersForGameRecord(playersInfo),
      initialState: gameLoop.cribbageGame.getGameState(),
      startedAt: new Date(),
    });
    supabaseGameIdByLobbyId.set(lobby.id, gameId);
    return gameId;
  } catch (error) {
    logger.error('[Supabase] Failed to create game record', error);
    return null;
  }
}

function shouldStoreSnapshotForEvent(event: GameEvent): boolean {
  return (
    event.actionType === ActionType.START_ROUND ||
    event.actionType === ActionType.READY_FOR_NEXT_ROUND ||
    event.actionType === ActionType.WIN
  );
}

function snapshotForEvent(event: GameEvent, latestSnapshot: GameSnapshot, roundStartSnapshot?: GameSnapshot): GameSnapshot | undefined {
  if (event.actionType === ActionType.START_ROUND) {
    return roundStartSnapshot ?? latestSnapshot;
  }
  if (event.actionType === ActionType.READY_FOR_NEXT_ROUND || event.actionType === ActionType.WIN) {
    return latestSnapshot;
  }
  return undefined;
}

async function persistRoundHistory(lobbyId: string, latestSnapshot: GameSnapshot): Promise<void> {
  const supabaseGameId = supabaseGameIdByLobbyId.get(lobbyId);
  if (!SUPABASE_AUTH_ENABLED || !supabaseGameId) return;
  
  // Atomically capture and clear events to prevent race conditions
  // If START_ROUND fires during persistence, it won't be lost
  const roundEvents = currentRoundGameEventsByLobbyId.get(lobbyId) ?? [];
  if (roundEvents.length === 0) return;
  
  // Clear immediately before async operation to prevent race conditions
  currentRoundGameEventsByLobbyId.set(lobbyId, []);

  const roundStartSnapshot = roundStartSnapshotByLobbyId.get(lobbyId);
  const eventsWithSnapshots = roundEvents.map(event => {
    const snapshot = snapshotForEvent(event, latestSnapshot, roundStartSnapshot);
    return {
      event,
      snapshot,
      storeSnapshot: snapshot ? shouldStoreSnapshotForEvent(event) : false,
    };
  });

  try {
    await persistGameEvents({ gameId: supabaseGameId, events: eventsWithSnapshots });
  } catch (error) {
    logger.error('[Supabase] Failed to persist round history', error);
    // Note: Events are already cleared, so they won't be retried
    // This is acceptable since persistence failures are logged for monitoring
  }
}

const PLAYER_DISCONNECT_GRACE_MS = 60 * 1000; // 1 minute to reconnect before cancelling the game
const FINISHED_LOBBY_TTL_MS = 60 * 60 * 1000; // 1 hour retention for finished lobbies before cleanup
const FINISHED_LOBBY_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // Sweep finished lobbies every 5 minutes

// Temporary default lobby ID used until full lobby management is implemented
const DEFAULT_LOBBY_ID = 'default-lobby';

// Generate a unique lobby name (adjective-animal) that doesn't collide with active lobbies
function generateUniqueLobbyName(): string {
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const name = uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      separator: ' ',
      style: 'capital',
    });
    // Check if this name is already in use by a waiting or in_progress lobby
    const nameInUse = Array.from(lobbiesById.values()).some(
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

const disconnectGraceTimeouts: Map<string, NodeJS.Timeout> = new Map();

/**
 * Clean up bots from connectedPlayers and related maps
 */
function cleanupBots(lobbyId: string): void {
  const botIds = currentGameBotIdsByLobbyId.get(lobbyId);
  if (!botIds || botIds.length === 0) {
    return;
  }
  logger.info(`Cleaning up ${botIds.length} bots for lobby ${lobbyId}`);
  botIds.forEach(botId => {
    connectedPlayers.delete(botId);
    playerIdToSocketId.delete(botId);
    socketIdToPlayerId.delete(botId);
    logger.info(`Removed bot: ${botId}`);
  });
  currentGameBotIdsByLobbyId.delete(lobbyId);
  emitConnectedPlayers();
}

/**
 * Clean up bots that are not part of any active game
 */
function cleanupInactiveBots(): void {
  // Collect all bot IDs that are part of active games
  const activeBotIds = new Set<string>();
  currentGameBotIdsByLobbyId.forEach((botIds, lobbyId) => {
    // Only include bots from lobbies with active games
    if (gameLoopsByLobbyId.has(lobbyId)) {
      botIds.forEach(botId => activeBotIds.add(botId));
    }
  });

  // Find and remove bots that aren't part of active games
  const botsToRemove: string[] = [];
  connectedPlayers.forEach((playerInfo, playerId) => {
    const isBot = !(playerInfo.agent instanceof WebSocketAgent);
    if (isBot && !activeBotIds.has(playerId)) {
      botsToRemove.push(playerId);
    }
  });

  if (botsToRemove.length > 0) {
    logger.info(`Cleaning up ${botsToRemove.length} inactive bots`);
    botsToRemove.forEach(botId => {
      connectedPlayers.delete(botId);
      playerIdToSocketId.delete(botId);
      socketIdToPlayerId.delete(botId);
      logger.info(`Removed inactive bot: ${botId}`);
    });
  }
}

function clearPlayerDisconnectTimer(playerId: string): void {
  const timeout = disconnectGraceTimeouts.get(playerId);
  if (timeout) {
    clearTimeout(timeout);
    disconnectGraceTimeouts.delete(playerId);
  }
}

function clearActiveGameArtifacts(lobbyId: string): Lobby | undefined {
  const loop = gameLoopsByLobbyId.get(lobbyId);
  if (loop) {
    loop.cancel();
    loop.removeAllListeners();
    gameLoopsByLobbyId.delete(lobbyId);
  }

  mostRecentGameSnapshotByLobbyId.delete(lobbyId);
  currentRoundGameEventsByLobbyId.delete(lobbyId);
  roundStartSnapshotByLobbyId.delete(lobbyId);
  supabaseGameIdByLobbyId.delete(lobbyId);
  gameIdByLobbyId.delete(lobbyId);
  cleanupBots(lobbyId);

  const lobby = lobbiesById.get(lobbyId);
  if (lobby) {
    lobby.disconnectedPlayerIds.forEach(clearPlayerDisconnectTimer);
  }

  return lobby;
}

function handleDisconnectGracePeriodExpired(playerId: string, lobbyId: string): void {
  disconnectGraceTimeouts.delete(playerId);
  const lobby = clearActiveGameArtifacts(lobbyId);
  if (!lobby) {
    return;
  }

  const wasTracked = lobby.disconnectedPlayerIds.includes(playerId);
  lobby.disconnectedPlayerIds = lobby.disconnectedPlayerIds.filter(id => id !== playerId);

  const playerIndex = lobby.players.findIndex(p => p.playerId === playerId);
  if (playerIndex !== -1) {
    lobby.players.splice(playerIndex, 1);
  }
  lobbyIdByPlayerId.delete(playerId);

  if (lobby.players.length === 0) {
    lobby.status = 'finished';
    lobby.finishedAt = Date.now();
    logger.warn(`[Disconnect] Lobby ${lobbyId} is now empty after grace expiry; closing lobby.`);
    io.emit('lobbyClosed', { lobbyId });
    return;
  }

  if (lobby.hostId === playerId) {
    lobby.hostId = lobby.players[0].playerId;
    logger.warn(`[Disconnect] Host ${playerId} dropped. Transferring host to ${lobby.hostId} for lobby ${lobbyId}.`);
  }

  if (wasTracked) {
    logger.warn(`[Disconnect] Grace period expired for player ${playerId} in lobby ${lobbyId}`);
  }

  lobby.status = 'waiting';
  lobby.finishedAt = null;
  io.emit('lobbyUpdated', lobby);
  io.emit('gameCancelledDueToDisconnect', {
    lobbyId,
    playerId,
    timeoutMs: PLAYER_DISCONNECT_GRACE_MS,
  });
}

function schedulePlayerDisconnectTimer(lobbyId: string, playerId: string): void {
  clearPlayerDisconnectTimer(playerId);
  const timeout = setTimeout(() => {
    handleDisconnectGracePeriodExpired(playerId, lobbyId);
  }, PLAYER_DISCONNECT_GRACE_MS);
  disconnectGraceTimeouts.set(playerId, timeout);
}

function handlePlayerInGameDisconnect(lobby: Lobby, playerId: string): void {
  if (!lobby.disconnectedPlayerIds.includes(playerId)) {
    lobby.disconnectedPlayerIds.push(playerId);
  }
  schedulePlayerDisconnectTimer(lobby.id, playerId);
  io.emit('lobbyUpdated', lobby);
  io.emit('playerDisconnectedFromLobby', {
    lobbyId: lobby.id,
    playerId,
    gracePeriodMs: PLAYER_DISCONNECT_GRACE_MS,
  });
}

function cleanupFinishedLobbies(): void {
  const now = Date.now();
  lobbiesById.forEach((lobby, lobbyId) => {
    if (lobby.status !== 'finished') {
      return;
    }

    const finishedAt = lobby.finishedAt ?? lobby.createdAt;
    const lobbyIsEmpty = lobby.players.length === 0;
    if (!lobbyIsEmpty && now - finishedAt < FINISHED_LOBBY_TTL_MS) {
      return;
    }

    lobby.players.forEach(player => {
      if (lobbyIdByPlayerId.get(player.playerId) === lobbyId) {
        lobbyIdByPlayerId.delete(player.playerId);
      }
    });

    lobby.disconnectedPlayerIds.forEach(clearPlayerDisconnectTimer);
    cleanupBots(lobbyId);
    gameLoopsByLobbyId.delete(lobbyId);
    mostRecentGameSnapshotByLobbyId.delete(lobbyId);
    currentRoundGameEventsByLobbyId.delete(lobbyId);
    roundStartSnapshotByLobbyId.delete(lobbyId);
    supabaseGameIdByLobbyId.delete(lobbyId);
    currentGameBotIdsByLobbyId.delete(lobbyId);

    lobbiesById.delete(lobbyId);
    io.emit('lobbyClosed', { lobbyId });
    logger.info(`[cleanupFinishedLobbies] Removed finished lobby ${lobbyId}`);
  });
}

setInterval(cleanupFinishedLobbies, FINISHED_LOBBY_SWEEP_INTERVAL_MS);

registerHttpApi(app, {
  onLobbyUpdated: lobbyPayload => {
    const mapped = cacheLobbyFromPayload(lobbyPayload);
    io.emit('lobbyUpdated', mapped);
  },
  onLobbyClosed: lobbyId => {
    removeLobbyFromCache(lobbyId);
    io.emit('lobbyClosed', { lobbyId });
  },
  onStartLobbyGame: (lobbyId, hostId) => startLobbyGameForHost(lobbyId, hostId),
});

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
    createdAt: payload.created_at ? new Date(payload.created_at).getTime() : Date.now(),
    finishedAt: payload.finished_at ?? null,
    disconnectedPlayerIds: [],
    isFixedSize: payload.is_fixed_size ?? true,
  };
}

async function refreshLobbyFromSupabase(lobbyId: string): Promise<Lobby | null> {
  try {
    const payload = await getLobbyWithPlayers(lobbyId);
    if (!payload) return null;
    return cacheLobbyFromPayload(payload);
  } catch (error) {
    logger.error('[Supabase] Failed to refresh lobby', lobbyId, error);
    return null;
  }
}

// Generate unique player ID from username, handling conflicts
function getUniquePlayerId(username: string, socketId: string): string {
  // First, try using the username directly
  if (!connectedPlayers.has(username)) {
    return username;
  }
  
  // If username is taken, append socket ID to make it unique
  // This allows multiple users with the same username
  const uniqueId = `${username}_${socketId}`;
  return uniqueId;
}

io.on('connection', socket => {
  const origin = socket.handshake.headers.origin;
  const address = socket.handshake.address;
  if (SUPABASE_AUTH_ENABLED) {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) {
      logger.warn('Connection without userId, disconnecting');
      socket.disconnect(true);
      return;
    }
  }
  
  // Auth was already checked in middleware, so this socket is authenticated
  logger.info(`[Connection] ✓ Socket connected: ${socket.id} from ${origin || 'proxy'} (${address})`);

  // send the connected players to the clients even before login
  // so they can see who is already connected
  emitConnectedPlayers();

  socket.on('login', (data: LoginData) => {
    logger.info('Received login event from socket:', socket.id);
    handleLogin(socket, data).catch(err => {
      logger.error('Login failed', err);
      socket.emit('loginRejected', { reason: 'INVALID_TOKEN', message: 'Login failed' });
    });
  });

  socket.on('createLobby', (data: { playerCount: number; name?: string; visibility?: 'public' | 'private' | 'friends'; isFixedSize?: boolean }, callback?: (response: any) => void) => {
    logger.info('Received createLobby event from socket:', socket.id, 'playerCount:', data?.playerCount);
    handleCreateLobby(socket, data, callback);
  });

  socket.on('joinLobby', (data: { lobbyId: string }, callback?: (response: any) => void) => {
    logger.info('Received joinLobby event from socket:', socket.id, 'lobbyId:', data?.lobbyId);
    handleJoinLobby(socket, data, callback);
  });

  socket.on('leaveLobby', (data: { lobbyId: string }, callback?: (response: any) => void) => {
    logger.info('Received leaveLobby event from socket:', socket.id, 'lobbyId:', data?.lobbyId);
    handleLeaveLobby(socket, data, callback);
  });

  socket.on('kickPlayer', (data: { lobbyId: string; targetPlayerId: string }, callback?: (response: any) => void) => {
    logger.info('Received kickPlayer event from socket:', socket.id, 'lobbyId:', data?.lobbyId, 'target:', data?.targetPlayerId);
    handleKickPlayer(socket, data, callback);
  });

  socket.on('updateLobbySize', (data: { lobbyId: string; playerCount: number }, callback?: (response: any) => void) => {
    logger.info('Received updateLobbySize event from socket:', socket.id, 'lobbyId:', data?.lobbyId, 'playerCount:', data?.playerCount);
    handleUpdateLobbySize(socket, data, callback);
  });

  socket.on('updateLobbyName', (data: { lobbyId: string; name: string }, callback?: (response: any) => void) => {
    logger.info('Received updateLobbyName event from socket:', socket.id, 'lobbyId:', data?.lobbyId, 'name:', data?.name);
    handleUpdateLobbyName(socket, data, callback);
  });

  socket.on('listLobbies', () => {
    logger.info('Received listLobbies request from socket:', socket.id);
    handleListLobbies(socket);
  });

  socket.on('startLobbyGame', (data: { lobbyId: string }, callback?: (response: any) => void) => {
    logger.info('Received startLobbyGame event from socket:', socket.id, 'lobbyId:', data?.lobbyId);
    handleStartLobbyGame(socket, data, callback).catch(error => {
      logger.error('Error starting lobby game:', error);
      if (callback) callback({ error: 'Failed to start game' });
      socket.emit('error', { message: 'Failed to start game' });
    });
  });

  socket.on('restartGame', () => {
    logger.info('Received restartGame event from socket:', socket.id);
    handleRestartGame(socket).catch(error => {
      logger.error('Error restarting game:', error);
      socket.emit('error', { message: 'Failed to restart game' });
    });
  });

  socket.on('getConnectedPlayers', () => {
    logger.info('Received getConnectedPlayers request from socket:', socket.id);
    // Clean up inactive bots before responding
    cleanupInactiveBots();

    const playerId = socketIdToPlayerId.get(socket.id);
    const playerLobbyId = playerId ? lobbyIdByPlayerId.get(playerId) : null;

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
    connectedPlayers.forEach(playerInfo => {
      const isBot = !(playerInfo.agent instanceof WebSocketAgent);
      // Include all human players, and only bots from the requesting player's lobby
      if (!isBot || activeBotIds.has(playerInfo.id)) {
        playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
      }
    });
    logger.info('Sending connected players to requesting client:', playersIdAndName);
    socket.emit('connectedPlayers', playersIdAndName);
  });

  // NOTE: Old startGame/startGameWithPlayerCount/restartGame handlers removed.
  // Use lobby system instead: createLobby -> joinLobby -> startLobbyGame.

  // NOTE: playAgain handler removed - use lobby system for rematch.

  socket.on('disconnect', (reason) => {
    logger.info(`A socket disconnected: ${socket.id}, Reason: ${reason}`);
    const playerId = socketIdToPlayerId.get(socket.id);
    
    if (playerId) {
      // If player is in a lobby, remove them and handle cleanup
      const lobbyId = lobbyIdByPlayerId.get(playerId);
      if (lobbyId) {
        const lobby = lobbiesById.get(lobbyId);
        if (lobby) {
          if (lobby.status === 'waiting') {
            // For waiting lobbies, don't remove players immediately on disconnect
            // They can reconnect and resume. Only remove if they explicitly leave or are kicked.
            // Keep the lobbyIdByPlayerId mapping so handleLogin can restore them
            logger.info(`Player ${playerId} disconnected from waiting lobby ${lobby.name} - keeping lobby membership for reconnection`);
            // Don't remove from lobby or delete mapping - let them reconnect
          } else if (lobby.status === 'in_progress') {
            logger.info(`Player ${playerId} disconnected during an active game in lobby ${lobby.name}`);
            handlePlayerInGameDisconnect(lobby, playerId);
          }
        }
      }
      
      // Only remove the player if they are not part of an active lobby game
      const playerLobbyId = lobbyIdByPlayerId.get(playerId);
      const playerInActiveGame = playerLobbyId ? gameLoopsByLobbyId.has(playerLobbyId) : false;
      if (!playerInActiveGame) {
        connectedPlayers.delete(playerId);
        playerIdToSocketId.delete(playerId);
        socketIdToPlayerId.delete(socket.id);
        logger.info(`Removed player ${playerId} (socket ${socket.id})`);
        // send updated connected players to all clients
        emitConnectedPlayers();
      } else {
        logger.info('Player is part of an active game. Keeping player record for reconnection.');
      }
    }
  });

  socket.on('heartbeat', () => {
    logger.info('Received heartbeat from client');
  });
});

function handleJoinLobby(socket: Socket, data: { lobbyId: string }, callback?: (response: any) => void): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    logger.error('Player ID not found for socket:', socket.id);
    const error = { error: 'Not logged in' };
    if (callback) callback(error);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId } = data;

  // Check if player is already in a lobby
  if (lobbyIdByPlayerId.has(playerId)) {
    logger.error('Player already in a lobby:', playerId);
    const error = { error: 'Already in a lobby' };
    if (callback) callback(error);
    socket.emit('error', { message: 'Already in a lobby' });
    return;
  }

  const joinLobby = async (): Promise<void> => {
    try {
      const joined = await joinLobbyInSupabase({ lobbyId, playerId });
      const mappedLobby = cacheLobbyFromPayload(joined);
      lobbyIdByPlayerId.set(playerId, lobbyId);
      socket.join(lobbyId);
      if (mappedLobby.disconnectedPlayerIds.length) {
        mappedLobby.disconnectedPlayerIds = mappedLobby.disconnectedPlayerIds.filter(id => id !== playerId);
      }
      logger.info(`Player ${playerId} joined lobby ${mappedLobby.name ?? lobbyId}`);
      if (callback) {
        callback({ lobby: mappedLobby });
      }
      io.emit('lobbyUpdated', mappedLobby);
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

function handleLeaveLobby(socket: Socket, data: { lobbyId: string }, callback?: (response: any) => void): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    logger.error('Player ID not found for socket:', socket.id);
    const error = { error: 'Not logged in' };
    if (callback) callback(error);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId } = data;

  const leave = async (): Promise<void> => {
    try {
      const updatedLobby = await leaveLobbyInSupabase({ lobbyId, playerId });
      lobbyIdByPlayerId.delete(playerId);
      socket.leave(lobbyId);
      logger.info(`Player ${playerId} left lobby ${lobbyId}`);

      if (callback) {
        callback({ success: true });
      }

      if (updatedLobby) {
        const mapped = cacheLobbyFromPayload(updatedLobby);
        if (mapped.currentPlayers === 0) {
          mapped.status = 'finished';
          mapped.finishedAt = Date.now();
          removeLobbyFromCache(lobbyId);
          io.emit('lobbyClosed', { lobbyId });
        } else {
          io.emit('lobbyUpdated', mapped);
        }
      } else {
        removeLobbyFromCache(lobbyId);
        io.emit('lobbyClosed', { lobbyId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to leave lobby';
      logger.error('Failed to leave lobby via Supabase', message);
      const response = { error: message };
      if (callback) callback(response);
      socket.emit('error', { message });
    }
  };

  void leave();
}

function handleKickPlayer(socket: Socket, data: { lobbyId: string; targetPlayerId: string }, callback?: (response: any) => void): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    logger.error('Player ID not found for socket:', socket.id);
    const error = { error: 'Not logged in' };
    if (callback) callback(error);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId, targetPlayerId } = data;

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
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
  const targetIndex = lobby.players.findIndex(p => p.playerId === targetPlayerId);
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
      const updated = await removeLobbyPlayer({ lobbyId, hostId: playerId, targetPlayerId });
      lobbyIdByPlayerId.delete(targetPlayerId);
      lobby.disconnectedPlayerIds = lobby.disconnectedPlayerIds.filter(id => id !== targetPlayerId);

      logger.info(`Player ${targetPlayerName} was kicked from lobby ${lobby.name} (${lobbyId}) by host ${playerId}`);

      if (callback) {
        callback({ success: true });
      }

      const targetSocketId = playerIdToSocketId.get(targetPlayerId);
      if (targetSocketId) {
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        targetSocket?.leave(lobbyId);
        io.to(targetSocketId).emit('kickedFromLobby', { lobbyId, reason: 'You were kicked by the host' });
      }

      const mapped = cacheLobbyFromPayload(updated);
      if (mapped.currentPlayers === 0 || mapped.status === 'finished') {
        mapped.status = 'finished';
        mapped.finishedAt = Date.now();
        removeLobbyFromCache(lobbyId);
        io.emit('lobbyClosed', { lobbyId });
        return;
      }

      io.emit('lobbyUpdated', mapped);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to kick player';
      logger.error('[handleKickPlayer] Supabase remove failed', message);
      if (callback) callback({ error: message });
      socket.emit('error', { message });
    }
  })();
}

async function startLobbyGameForHost(lobbyId: string, hostId: string): Promise<{ lobby: LobbyPayload; gameId: string }> {
  if (gameLoopsByLobbyId.has(lobbyId)) {
    throw new Error('GAME_IN_PROGRESS');
  }

  const startedLobby = await startLobby({ lobbyId, hostId });
  const lobby = cacheLobbyFromPayload(startedLobby);
  const newBotIds: string[] = [];

  try {
    // Clean up any existing bots before creating new ones
    cleanupBots(lobby.id);

    // Build playersInfo from lobby members (humans only, no bots yet)
    const playersInfo: PlayerIdAndName[] = lobby.players.map(p => ({ id: p.playerId, name: p.displayName }));

    // Calculate bots needed
    const targetCount = lobby.maxPlayers ?? lobby.playerCount ?? playersInfo.length;
    const botsNeeded = Math.max(0, targetCount - playersInfo.length);
    logger.info(`Starting lobby game: ${lobby.name} with ${playersInfo.length} humans and ${botsNeeded} bots needed`);

    // Create bots
    const botNames = ['Bot Alex', 'Bot Morgan', 'Bot Jordan'];
    for (let i = 0; i < botsNeeded; i++) {
      const botName = botNames[i] || `Bot ${i + 1}`;
      const botAgent = new ExhaustiveSimpleAgent();
      const botId = `${botAgent.playerId}-${Date.now()}-${i}`;
      // Update the agent's playerId to match the generated botId
      botAgent.playerId = botId;
      playersInfo.push({ id: botId, name: botName });
      const botPlayerInfo: PlayerInfo = {
        id: botId,
        name: botName,
        agent: botAgent,
      };
      connectedPlayers.set(botId, botPlayerInfo);
      newBotIds.push(botId);
      logger.info(`Added bot: ${botName} (ID: ${botId})`);
    }

    // Create GameLoop using players from the lobby
    const agents: Map<string, GameAgent> = new Map();
    // Populate human agents
    lobby.players.forEach(p => {
      const info = connectedPlayers.get(p.playerId);
      if (info) agents.set(info.id, info.agent);
    });
    // Populate bot agents
    newBotIds.forEach(id => {
      const info = connectedPlayers.get(id);
      if (info) agents.set(info.id, info.agent);
    });

    // Filter out disconnected players - only include players who have agents
    const validPlayersInfo = playersInfo.filter(p => agents.has(p.id));
    if (validPlayersInfo.length !== playersInfo.length) {
      const disconnectedPlayers = playersInfo.filter(p => !agents.has(p.id));
      logger.warn(`[startLobbyGameForHost] Filtering out ${disconnectedPlayers.length} disconnected players: ${disconnectedPlayers.map(p => p.name).join(', ')}`);
    }
    if (validPlayersInfo.length < 2) {
      throw new Error('Not enough connected players to start game');
    }

    // Store bot IDs for cleanup after game ends
    currentGameBotIdsByLobbyId.set(lobby.id, newBotIds);

    const gameLoop = new GameLoop(validPlayersInfo);
    agents.forEach((agent, id) => gameLoop.addAgent(id, agent));
    gameLoopsByLobbyId.set(lobby.id, gameLoop);
    currentRoundGameEventsByLobbyId.set(lobby.id, []);
    await createSupabaseGameForLobby(lobby, validPlayersInfo, gameLoop);

    // Set up gameSnapshot listener to send redacted snapshots to all clients
    let firstSnapshotEmitted = false;
    gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
      mostRecentGameSnapshotByLobbyId.set(lobby.id, newSnapshot);
      const existingEvents = currentRoundGameEventsByLobbyId.get(lobby.id) || [];
      const updatedEvents = [...existingEvents, newSnapshot.gameEvent];
      const isStartRound = newSnapshot.gameEvent.actionType === ActionType.START_ROUND;
      const roundEvents = isStartRound ? [newSnapshot.gameEvent] : updatedEvents;
      if (isStartRound) {
        roundStartSnapshotByLobbyId.set(lobby.id, newSnapshot);
        currentRoundGameEventsByLobbyId.set(lobby.id, roundEvents);
      } else {
        currentRoundGameEventsByLobbyId.set(lobby.id, updatedEvents);
      }

      if (newSnapshot.gameEvent.actionType === ActionType.READY_FOR_NEXT_ROUND || newSnapshot.gameEvent.actionType === ActionType.WIN) {
        void persistRoundHistory(lobby.id, newSnapshot);
      }
      
      // Send redacted snapshots to all players
      sendRedactedSnapshotToAllPlayers(gameLoop, newSnapshot, roundEvents, lobby.id);
      
      // After the first snapshot, ensure all clients received it by re-emitting
      // This helps clients that reset state after gameStartedFromLobby
      if (!firstSnapshotEmitted) {
        firstSnapshotEmitted = true;
        // Small delay to ensure clients have processed gameStartedFromLobby and set up listeners
        setTimeout(() => {
          const latestSnapshot = mostRecentGameSnapshotByLobbyId.get(lobby.id);
          const latestEvents = currentRoundGameEventsByLobbyId.get(lobby.id) || [];
          if (latestSnapshot === newSnapshot) {
            logger.info('Re-emitting first game snapshot to ensure all clients received it');
            sendRedactedSnapshotToAllPlayers(gameLoop, latestSnapshot, latestEvents, lobby.id);
          }
        }, 100);
      }
    });

    // Map lobby -> game
    const gameId = gameLoop.cribbageGame.getGameState().id;
    gameIdByLobbyId.set(lobby.id, gameId);

    // Update lobby status and broadcast updates
    lobby.status = 'in_progress';
    lobby.finishedAt = null;
    lobby.disconnectedPlayerIds = [];
    io.emit('lobbyUpdated', lobby);

    // Notify lobby members of the game start
    io.emit('gameStartedFromLobby', { lobbyId: lobby.id, gameId, players: validPlayersInfo });

    // Start the game loop (this will emit snapshots as the game progresses)
    // Don't await - let it run in the background
    startGame(lobby.id).catch(error => {
      logger.error('[startLobbyGameForHost] Error in game loop:', error);
    });

    return { lobby: startedLobby, gameId };
  } catch (error) {
    // Rollback lobby status to 'waiting' if game start fails
    try {
      const client = getServiceClient();
      await client.from('lobbies').update({ status: 'waiting' }).eq('id', lobbyId);
      logger.info(`[startLobbyGameForHost] Rolled back lobby ${lobbyId} status to 'waiting' due to error`);
    } catch (rollbackError) {
      logger.error(`[startLobbyGameForHost] Failed to rollback lobby ${lobbyId} status:`, rollbackError);
    }

    // Clean up any bots that were created
    newBotIds.forEach(botId => {
      connectedPlayers.delete(botId);
    });
    if (newBotIds.length > 0) {
      logger.info(`[startLobbyGameForHost] Cleaned up ${newBotIds.length} bots after error`);
    }

    // Clean up any partial game state that may have been created
    gameLoopsByLobbyId.delete(lobby.id);
    currentGameBotIdsByLobbyId.delete(lobby.id);
    gameIdByLobbyId.delete(lobby.id);
    currentRoundGameEventsByLobbyId.delete(lobby.id);
    mostRecentGameSnapshotByLobbyId.delete(lobby.id);
    roundStartSnapshotByLobbyId.delete(lobby.id);

    // Re-throw the original error
    throw error;
  }
}

function handleUpdateLobbySize(socket: Socket, data: { lobbyId: string; playerCount: number }, callback?: (response: any) => void): void {
  const playerId = socketIdToPlayerId.get(socket.id);
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
  const lobby = lobbiesById.get(lobbyId);
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
    socket.emit('error', { message: 'Cannot change size after game has started' });
    return;
  }

  void (async () => {
    try {
      const updated = await updateLobbySize({
        lobbyId,
        hostId: playerId,
        maxPlayers: playerCount,
      });
      const mapped = cacheLobbyFromPayload(updated);
      logger.info(`Lobby ${lobby.name} size updated to ${playerCount} by host ${playerId}`);
      if (callback) {
        callback({ lobby: mapped });
      }
      io.emit('lobbyUpdated', mapped);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update lobby size';
      logger.error('[handleUpdateLobbySize] Supabase update failed', message);
      if (callback) callback({ error: message });
      socket.emit('error', { message });
    }
  })();
}

function handleUpdateLobbyName(socket: Socket, data: { lobbyId: string; name: string }, callback?: (response: any) => void): void {
  const playerId = socketIdToPlayerId.get(socket.id);
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
    socket.emit('error', { message: 'Lobby name must be 50 characters or less' });
    return;
  }

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
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
    socket.emit('error', { message: 'Cannot change name after game has started' });
    return;
  }

  void (async () => {
    try {
      const updated = await updateLobbyName({ lobbyId, hostId: playerId, name: trimmedName });
      const mapped = cacheLobbyFromPayload(updated);
      logger.info(`Lobby ${lobbyId} name updated to "${trimmedName}" by host ${playerId}`);
      if (callback) {
        callback({ lobby: mapped });
      }
      io.emit('lobbyUpdated', mapped);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update lobby name';
      logger.error('[handleUpdateLobbyName] Supabase update failed', message);
      if (callback) callback({ error: message });
      socket.emit('error', { message });
    }
  })();
}

function handleListLobbies(socket: Socket): void {
  void (async () => {
    try {
      const lobbies = await listLobbiesFromSupabase();
      lobbies.forEach(l => cacheLobbyFromPayload(l));
      const waitingLobbies = lobbies
        .filter(l => l.status === 'waiting')
        .map(lobby => {
          const hostId = lobby.host_id as string | undefined;
          const hostPlayerInfo = hostId ? connectedPlayers.get(hostId) : undefined;
          const hostDisplayName = hostPlayerInfo?.name || 'Unknown';
          return {
            id: lobby.id,
            name: lobby.name,
            hostDisplayName,
            currentPlayers: lobby.current_players ?? lobby.players?.length ?? 0,
            playerCount: lobby.max_players ?? (lobby as any).playerCount,
            createdAt: lobby.created_at ? new Date(lobby.created_at).getTime() : Date.now(),
          };
        });
      logger.info(`Sending ${waitingLobbies.length} waiting lobbies to client`);
      socket.emit('lobbyList', { lobbies: waitingLobbies });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list lobbies';
      logger.error('[handleListLobbies] Supabase list failed', message);
      socket.emit('error', { message: 'Failed to list lobbies' });
    }
  })();
}

async function handleStartLobbyGame(socket: Socket, data: { lobbyId: string }, callback?: (response: any) => void): Promise<void> {
  const playerId = socketIdToPlayerId.get(socket.id);
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

  const lobby = lobbiesById.get(lobbyId) ?? (await refreshLobbyFromSupabase(lobbyId));
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
    const { gameId } = await startLobbyGameForHost(lobbyId, playerId);
    if (callback) {
      callback({ success: true, gameId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start game';
    logger.error('Error starting lobby game:', message);
    if (callback) {
      callback({ error: message });
    }
    socket.emit('error', { message });
  }
}

function handleCreateLobby(
  socket: Socket,
  data: { playerCount: number; name?: string; visibility?: 'public' | 'private' | 'friends'; isFixedSize?: boolean },
  callback?: (response: any) => void
): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  logger.info(`[handleCreateLobby] Starting for player: ${playerId}, callback present: ${!!callback}`);
  
  if (!playerId) {
    logger.error('Player ID not found for socket:', socket.id);
    const error = { error: 'Not logged in' };
    if (callback) {
      logger.info('[handleCreateLobby] Sending error callback: Not logged in');
      callback(error);
    }
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  // Check if player is already in a lobby
  if (lobbyIdByPlayerId.has(playerId)) {
    const existingLobbyId = lobbyIdByPlayerId.get(playerId);
    logger.error(`[handleCreateLobby] Player ${playerId} already in lobby ${existingLobbyId}`);
    const error = { error: 'Already in a lobby' };
    if (callback) {
      logger.info('[handleCreateLobby] Sending error callback: Already in a lobby');
      callback(error);
    }
    socket.emit('error', { message: 'Already in a lobby' });
    return;
  }

  const { playerCount, name: customName, visibility = 'public', isFixedSize = true } = data;

  // Validate player count
  if (!playerCount || playerCount < 2 || playerCount > 4) {
    logger.error('Invalid player count:', playerCount);
    const error = { error: 'Player count must be between 2 and 4' };
    if (callback) callback(error);
    socket.emit('error', { message: 'Player count must be between 2 and 4' });
    return;
  }

  // Get player info for host display name
  const playerInfo = connectedPlayers.get(playerId);
  const hostDisplayName = playerInfo?.name || 'Unknown';

  // Generate lobby name (either custom or default to "<host's name>'s lobby")
  const lobbyName = customName?.trim() || `${hostDisplayName}'s lobby`;

  const createLobbyAsync = async (): Promise<void> => {
    try {
      const created = await createLobby({
        hostId: playerId,
        name: lobbyName,
        maxPlayers: playerCount,
        isFixedSize,
        visibility,
      });
      const mapped = cacheLobbyFromPayload(created);
      lobbyIdByPlayerId.set(playerId, mapped.id);
      socket.join(mapped.id);

      logger.info(`[handleCreateLobby] Lobby created: ${mapped.name} (${mapped.id}) by ${hostDisplayName}`);

      if (callback) {
        logger.info('[handleCreateLobby] Sending success callback with lobby:', mapped.id);
        callback({ lobby: mapped });
      }

      io.emit('lobbyUpdated', mapped);
      socket.emit('lobbyCreated', { lobbyId: mapped.id, name: mapped.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create lobby';
      logger.error('[handleCreateLobby] Supabase create failed', message);
      const response = { error: message };
      if (callback) callback(response);
      socket.emit('error', { message });
    }
  };

  void createLobbyAsync();
}

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
      logger.warn(`[handleLogin] Missing middleware-authenticated userId for socket ${socket.id}`);
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
            `(socket already authenticated)`,
          error
        );
      }
    }

    const profile = await getProfile(socketAuthedUserId);
    const displayName = profile?.display_name ?? 'Player';
    const playerId = socketAuthedUserId;

    let agent: WebSocketAgent | null = null;
    // Check if this playerId already has an agent (reconnection scenario)
    const existingPlayerInfo = connectedPlayers.get(playerId);

    if (existingPlayerInfo && existingPlayerInfo.agent instanceof WebSocketAgent) {
      agent = existingPlayerInfo.agent;
      // If the socket ID is different, this is a reconnection - update the socket
      if (existingPlayerInfo.agent.socket.id !== socket.id) {
        logger.info(`[handleLogin] Player ${playerId} reconnecting: old socket ${existingPlayerInfo.agent.socket.id}, new socket ${socket.id}`);
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

    playerIdToSocketId.set(playerId, socket.id);
    socketIdToPlayerId.set(socket.id, playerId);
    connectedPlayers.set(playerId, playerInfo);

    let reconnectLobbyId = lobbyIdByPlayerId.get(playerId);
    let reconnectLobby = reconnectLobbyId ? lobbiesById.get(reconnectLobbyId) : null;

    if (!reconnectLobby) {
      for (const [lobbyId, lobby] of lobbiesById.entries()) {
        if (lobby.players.some(p => p.playerId === playerId)) {
          reconnectLobbyId = lobbyId;
          reconnectLobby = lobby;
          lobbyIdByPlayerId.set(playerId, lobbyId);
          break;
        }
      }
    }

    if (reconnectLobbyId && reconnectLobby) {
      if (reconnectLobby.disconnectedPlayerIds.includes(playerId)) {
        clearPlayerDisconnectTimer(playerId);
        reconnectLobby.disconnectedPlayerIds = reconnectLobby.disconnectedPlayerIds.filter(id => id !== playerId);
      }

      const playerInLobby = reconnectLobby.players.some(p => p.playerId === playerId);
      if (!playerInLobby) {
        reconnectLobby.players.push({
          playerId,
          displayName,
        });
        logger.info(`Restored player ${displayName} to lobby ${reconnectLobby.name}`);
      }

      const hasActiveGame = gameLoopsByLobbyId.has(reconnectLobbyId);
      const hasGameSnapshot = mostRecentGameSnapshotByLobbyId.has(reconnectLobbyId);
      const gameWasFinished = reconnectLobby.status === 'finished' && (hasGameSnapshot || reconnectLobby.finishedAt);

      if (reconnectLobby.status === 'finished' && reconnectLobby.players.length > 0 && !gameWasFinished) {
        reconnectLobby.status = 'waiting';
        reconnectLobby.finishedAt = null;
        logger.info(`Restored lobby ${reconnectLobby.name} to waiting status (was empty, now has players)`);
      } else if (gameWasFinished) {
        logger.info(`Lobby ${reconnectLobby.name} has finished game - keeping 'finished' status to allow restart`);
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

    sendMostRecentGameData(socket);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    logger.error('Supabase login failed:', message);
    socket.emit('loginRejected', { reason: 'INVALID_TOKEN', message });
  }
}

// create function that emits the current connected players to all clients
// Note: Only includes human players. Bots are included per-lobby in getConnectedPlayers handler.
function emitConnectedPlayers(): void {
  // Clean up inactive bots before emitting
  cleanupInactiveBots();

  const playersIdAndName: PlayerIdAndName[] = [];
  connectedPlayers.forEach(playerInfo => {
    // Only include human players in global broadcast
    // Bots are included per-lobby when players request connectedPlayers
    const isBot = !(playerInfo.agent instanceof WebSocketAgent);
    if (!isBot) {
      playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
    }
  });
  logger.info('Emitting connected players to all clients:', playersIdAndName);
  io.emit('connectedPlayers', playersIdAndName);
}

function emitToLobbyPlayers(lobbyId: string, event: string, payload?: unknown): void {
  io.to(lobbyId).emit(event, payload);
}

async function handleRestartGame(socket: Socket): Promise<void> {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    logger.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  // Get the lobby this player is in
  const lobbyId = lobbyIdByPlayerId.get(playerId);
  if (!lobbyId) {
    logger.error('Player not in a lobby:', playerId);
    socket.emit('error', { message: 'Not in a lobby' });
    return;
  }

  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) {
    logger.error('Lobby not found:', lobbyId);
    socket.emit('error', { message: 'Lobby not found' });
    return;
  }

  // Only allow the host to restart the game
  if (playerId !== lobby.hostId) {
    logger.error('Cannot restart game - player is not the host:', playerId, 'host:', lobby.hostId);
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
  clearActiveGameArtifacts(lobbyId);

  // Emit gameReset to clear client state
  emitToLobbyPlayers(lobby.id, 'gameReset');

  // Immediately start a new game with the same lobby/players
  // Reuse the logic from handleStartLobbyGame but without the waiting status check
  // Clean up any existing bots before creating new ones
  cleanupBots(lobby.id);

  // Build playersInfo from lobby members (humans only, no bots yet)
  const playersInfo: PlayerIdAndName[] = lobby.players.map(p => ({ id: p.playerId, name: p.displayName }));

  // Calculate bots needed
  const targetCount = lobby.maxPlayers ?? lobby.playerCount ?? playersInfo.length;
  const botsNeeded = Math.max(0, targetCount - playersInfo.length);
  logger.info(`Restarting lobby game: ${lobby.name} with ${playersInfo.length} humans and ${botsNeeded} bots needed`);

  // Create bots
  const botNames = ['Bot Alex', 'Bot Morgan', 'Bot Jordan'];
  const newBotIds: string[] = [];
  for (let i = 0; i < botsNeeded; i++) {
    const botName = botNames[i] || `Bot ${i + 1}`;
    const botAgent = new ExhaustiveSimpleAgent();
    const botId = `${botAgent.playerId}-${Date.now()}-${i}`;
    // Update the agent's playerId to match the generated botId
    botAgent.playerId = botId;
    playersInfo.push({ id: botId, name: botName });
    const botPlayerInfo: PlayerInfo = {
      id: botId,
      name: botName,
      agent: botAgent,
    };
    connectedPlayers.set(botId, botPlayerInfo);
    newBotIds.push(botId);
    logger.info(`Added bot: ${botName} (ID: ${botId})`);
  }

  // Create GameLoop using players from the lobby
  const agents: Map<string, GameAgent> = new Map();
  // Populate human agents
  lobby.players.forEach(p => {
    const info = connectedPlayers.get(p.playerId);
    if (info) agents.set(info.id, info.agent);
  });
  // Populate bot agents
  newBotIds.forEach(id => {
    const info = connectedPlayers.get(id);
    if (info) agents.set(info.id, info.agent);
  });

  // Store bot IDs for cleanup after game ends
  currentGameBotIdsByLobbyId.set(lobby.id, newBotIds);

  // Filter out disconnected players - only include players who have agents
  const validPlayersInfo = playersInfo.filter(p => agents.has(p.id));
  if (validPlayersInfo.length !== playersInfo.length) {
    const disconnectedPlayers = playersInfo.filter(p => !agents.has(p.id));
    logger.warn(`[handleRestartGame] Filtering out ${disconnectedPlayers.length} disconnected players: ${disconnectedPlayers.map(p => p.name).join(', ')}`);
  }
  if (validPlayersInfo.length < 2) {
    throw new Error('Not enough connected players to restart game');
  }

  const gameLoop = new GameLoop(validPlayersInfo);
  agents.forEach((agent, id) => gameLoop.addAgent(id, agent));
  gameLoopsByLobbyId.set(lobby.id, gameLoop);
  currentRoundGameEventsByLobbyId.set(lobby.id, []);
  await createSupabaseGameForLobby(lobby, validPlayersInfo, gameLoop);

  // Set up gameSnapshot listener to send redacted snapshots to all clients
  let firstSnapshotEmitted = false;
  gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
    mostRecentGameSnapshotByLobbyId.set(lobby.id, newSnapshot);
    const existingEvents = currentRoundGameEventsByLobbyId.get(lobby.id) || [];
    const updatedEvents = [...existingEvents, newSnapshot.gameEvent];
    const isStartRound = newSnapshot.gameEvent.actionType === ActionType.START_ROUND;
    const roundEvents = isStartRound ? [newSnapshot.gameEvent] : updatedEvents;
    if (isStartRound) {
      roundStartSnapshotByLobbyId.set(lobby.id, newSnapshot);
      currentRoundGameEventsByLobbyId.set(lobby.id, roundEvents);
    } else {
      currentRoundGameEventsByLobbyId.set(lobby.id, updatedEvents);
    }

    if (newSnapshot.gameEvent.actionType === ActionType.READY_FOR_NEXT_ROUND || newSnapshot.gameEvent.actionType === ActionType.WIN) {
      void persistRoundHistory(lobby.id, newSnapshot);
    }
    
    // Send redacted snapshots to all players
    sendRedactedSnapshotToAllPlayers(gameLoop, newSnapshot, roundEvents, lobby.id);
    
    // After the first snapshot, ensure all clients received it by re-emitting
    if (!firstSnapshotEmitted) {
      firstSnapshotEmitted = true;
      setTimeout(() => {
        const latestSnapshot = mostRecentGameSnapshotByLobbyId.get(lobby.id);
        const latestEvents = currentRoundGameEventsByLobbyId.get(lobby.id) || [];
        if (latestSnapshot === newSnapshot) {
          logger.info('Re-emitting first game snapshot to ensure all clients received it');
          sendRedactedSnapshotToAllPlayers(gameLoop, latestSnapshot, latestEvents, lobby.id);
        }
      }, 100);
    }
  });

  // Map lobby -> game
  const gameId = gameLoop.cribbageGame.getGameState().id;
  gameIdByLobbyId.set(lobby.id, gameId);

  // Update lobby status (keep as in_progress, don't reset to waiting)
  lobby.status = 'in_progress';
  lobby.finishedAt = null;
  lobby.disconnectedPlayerIds = [];
  io.emit('lobbyUpdated', lobby);

  // Notify lobby members of the game restart (same as game start)
  // Small delay to ensure clients have processed gameReset
  setTimeout(() => {
    io.emit('gameStartedFromLobby', { lobbyId: lobby.id, gameId, players: validPlayersInfo });
  }, 50);

  // Start the game loop (this will emit snapshots as the game progresses)
  startGame(lobby.id).catch(error => {
    logger.error('[handleRestartGame] Error in game loop:', error);
  });

  logger.info(`Game restarted. New game started for lobby ${lobby.name}.`);
}

/**
 * Send redacted game snapshot and events to all players in a game
 */
function sendRedactedSnapshotToAllPlayers(
  gameLoop: GameLoop,
  snapshot: GameSnapshot,
  roundEvents: GameEvent[],
  lobbyId: string,
): void {
  const gameState = gameLoop.cribbageGame.getGameState();
  
  // Send redacted snapshot to each player
  gameState.players.forEach(player => {
    const socketId = playerIdToSocketId.get(player.id);
    if (!socketId) {
      // Player might be a bot or disconnected - skip
      return;
    }
    
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      // Socket not found - skip
      return;
    }
    
    // Update WebSocketAgent with the latest snapshot if this is a human player
    const playerInfo = connectedPlayers.get(player.id);
    if (playerInfo && playerInfo.agent instanceof WebSocketAgent) {
      playerInfo.agent.updateGameSnapshot(snapshot);
    }
    
    // Get redacted state and event for this player
    const redactedGameState = gameLoop.cribbageGame.getRedactedGameState(player.id);
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

function sendMostRecentGameData(socket: Socket): void {
  logger.info('Sending most recent game data to client');
  
  // Find which player this socket belongs to
  const playerId = socketIdToPlayerId.get(socket.id);

  if (!playerId) {
    logger.error('Could not find player ID for socket:', socket.id);
    return;
  }

  const lobbyId = lobbyIdByPlayerId.get(playerId);
  if (!lobbyId) {
    logger.warn(`Player ${playerId} is not in a lobby; skipping game state send.`);
    socket.emit('currentRoundGameEvents', []);
    return;
  }

  const activeGameLoop = gameLoopsByLobbyId.get(lobbyId);
  const mostRecentGameSnapshot = mostRecentGameSnapshotByLobbyId.get(lobbyId);
  const roundEvents = currentRoundGameEventsByLobbyId.get(lobbyId) || [];

  if (!activeGameLoop || !mostRecentGameSnapshot) {
    logger.warn(`No active game loop or snapshot for lobby ${lobbyId} when attempting to send game data`);
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
  const playerInfo = connectedPlayers.get(playerId);
  if (playerInfo && playerInfo.agent instanceof WebSocketAgent) {
    playerInfo.agent.updateGameSnapshot(mostRecentGameSnapshot);
  }

  const redactedGameState = activeGameLoop.cribbageGame.getRedactedGameState(playerId);
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

async function startGame(lobbyId: string): Promise<void> {
  const gameLoop = gameLoopsByLobbyId.get(lobbyId);
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
    if (gameLoopsByLobbyId.get(lobbyId) !== currentGameLoop) {
      logger.info('[startGame()] Game loop was replaced, ignoring completion');
      return;
    }
    
    const supabaseGameId = supabaseGameIdByLobbyId.get(lobbyId);
    if (supabaseGameId) {
      const latestSnapshot = mostRecentGameSnapshotByLobbyId.get(lobbyId);
      if (latestSnapshot) {
        await persistRoundHistory(lobbyId, latestSnapshot);
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
    if (gameLoopsByLobbyId.get(lobbyId) !== currentGameLoop) {
      logger.info('[startGame()] Game loop was replaced during wait, ignoring completion');
      return;
    }

    // Clear gameLoop after game ends so a new game can be started
    // Only clear if this is still the current game loop (hasn't been replaced)
    if (gameLoopsByLobbyId.get(lobbyId) === currentGameLoop) {
      logger.info('Game ended. Clearing game loop to allow new game.');
      currentGameLoop.removeAllListeners();
      gameLoopsByLobbyId.delete(lobbyId);
    } else {
      logger.info('[startGame()] Game loop was replaced, not clearing (new game already started)');
    }

    // Clean up bots that were created for this game
    cleanupBots(lobbyId);

    gameIdByLobbyId.delete(lobbyId);
    supabaseGameIdByLobbyId.delete(lobbyId);
    roundStartSnapshotByLobbyId.delete(lobbyId);

    const completedLobby = lobbiesById.get(lobbyId);
    if (completedLobby) {
      completedLobby.status = 'finished';
      completedLobby.finishedAt = Date.now();
      completedLobby.disconnectedPlayerIds = [];
      io.emit('lobbyUpdated', completedLobby);
    }

    if (SUPABASE_AUTH_ENABLED) {
      try {
        await getServiceClient().from('lobbies').update({ status: 'finished' }).eq('id', lobbyId);
      } catch (updateError) {
        logger.error('[startGame] Failed to mark lobby finished in Supabase', updateError);
      }
    }

    io.emit('gameOver', winner);
  } catch (error) {
    // If game loop was cancelled, that's expected - just log and return
    if (error instanceof Error && error.message === 'Game loop was cancelled') {
      logger.info('[startGame()] Game loop was cancelled, cleaning up');
      // Clean up bots even if cancelled
      if (gameLoopsByLobbyId.get(lobbyId) === currentGameLoop) {
        cleanupBots(lobbyId);
        gameLoopsByLobbyId.delete(lobbyId);
      }
      gameIdByLobbyId.delete(lobbyId);
      supabaseGameIdByLobbyId.delete(lobbyId);
      roundStartSnapshotByLobbyId.delete(lobbyId);
      currentRoundGameEventsByLobbyId.delete(lobbyId);
      mostRecentGameSnapshotByLobbyId.delete(lobbyId);
      return;
    }
    // Otherwise, rethrow the error
    logger.error('[startGame()] Error during game:', error);
    throw error;
  }
}

// Start the server
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
