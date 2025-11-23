import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameLoop } from './gameplay/GameLoop';
import {
  ActionType,
  GameAgent,
  GameEvent,
  PlayerIdAndName,
  GameInfo,
  GameSnapshot,
  Phase,
} from './types';
import { WebSocketAgent } from './agents/WebSocketAgent';
import { ExhaustiveSimpleAgent } from './agents/ExhaustiveSimpleAgent';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { logger } from './utils/logger';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import { v4 as uuidv4 } from 'uuid';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const WEBSOCKET_AUTH_TOKEN = process.env.WEBSOCKET_AUTH_TOKEN;
const JSON_DB_DIR = process.env.JSON_DB_DIR || path.join(__dirname, 'json_db');
logger.info('JSON_DB_DIR:', JSON_DB_DIR);
// create the directory if it does not exist
if (!fs.existsSync(JSON_DB_DIR)) {
  fs.mkdirSync(JSON_DB_DIR);
}

if (!WEBSOCKET_AUTH_TOKEN) {
  logger.error('WEBSOCKET_AUTH_TOKEN is not set');
  throw new Error('WEBSOCKET_AUTH_TOKEN is not set');
}

logger.info('PORT:', PORT);
logger.info('WEB_APP_ORIGIN:', WEB_APP_ORIGIN);

logger.info('Cribbage-core server starting...');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }
  if (req.method === 'GET' && req.url === '/connected-players') {
    const playersIdAndName: PlayerIdAndName[] = [];
    connectedPlayers.forEach(playerInfo => {
      playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(playersIdAndName));
    return;
  }
  // fallback for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Support multiple origins or wildcard for development
// Also automatically supports both HTTP and HTTPS versions of origins
const getAllowedOrigins = (): string | string[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void) => {
  if (!WEB_APP_ORIGIN) {
    // If no origin specified, allow all (development only)
    console.warn('WEB_APP_ORIGIN not set - allowing all origins (development only)');
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
  
  if (uniqueOrigins.length === 1) {
    return uniqueOrigins[0];
  }
  
  // Multiple origins - use function to check dynamically
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true); // Allow requests with no origin (e.g., mobile apps, Postman)
      return;
    }
    const isAllowed = uniqueOrigins.some(allowedOrigin => {
      // Support wildcard subdomains
      if (allowedOrigin.startsWith('*.')) {
        const domain = allowedOrigin.slice(2);
        return origin.endsWith(domain);
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

const io = new Server(server, {
  cors: {
    origin: getAllowedOrigins(),
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

// Auth middleware (currently disabled for development)
io.use((socket, next) => {
  // TODO: Re-enable auth check when needed
  next();
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
  playerCount: number; // 2–4
  players: PlayerInLobby[]; // humans only; bots are added when starting game
  status: 'waiting' | 'in_progress' | 'finished';
  createdAt: number;
}

interface LoginData {
  username: string;
  name: string;
  secretKey?: string; // Optional - provided by client if they have one stored
}

const GAME_EVENTS_FILE = path.join(JSON_DB_DIR, 'gameEvents.json');
const GAME_INFO_FILE = path.join(JSON_DB_DIR, 'gameInfo.json');

// TODO: convert this to store gamestate and game events since game events alone are not sufficient
// just write to json file for now (append to list of game events)
const sendGameEventToDB = (gameEvent: GameEvent): void => {
  try {
    const gameEvents: GameEvent[] = fs.existsSync(GAME_EVENTS_FILE)
      ? (JSON.parse(fs.readFileSync(GAME_EVENTS_FILE, 'utf-8')) as GameEvent[])
      : [];
    gameEvents.push(gameEvent);
    fs.writeFileSync(GAME_EVENTS_FILE, JSON.stringify(gameEvents, null, 2));
    console.log('Game event saved to DB:', gameEvent);
  } catch (error) {
    console.error('Error writing game event to DB:', error);
  }
};

// function that writes GameInfo to a json file
const startGameInDB = (
  gameId: string,
  players: PlayerIdAndName[],
  lobbyId: string
): void => {
  try {
    // if the file does not exist, create it
    if (!fs.existsSync(GAME_INFO_FILE)) {
      fs.writeFileSync(GAME_INFO_FILE, JSON.stringify([], null, 2));
    }
    // if gameInfo with matching id already exists, throw error
    const existingGamesInfo: GameInfo[] = JSON.parse(
      fs.readFileSync(GAME_INFO_FILE, 'utf-8')
    ) as GameInfo[];
    // make sure the existingGamesInfo is an array and not null
    if (!Array.isArray(existingGamesInfo)) {
      console.error('Existing game info is not an array:', existingGamesInfo);
      throw new Error('Existing game info is not an array');
    }
    const gameInfoExists = existingGamesInfo.some(game => game.id === gameId);
    if (gameInfoExists) {
      console.error('Game info with this ID already exists:', gameId);
      throw new Error('Game info with this ID already exists');
    }
    // fs.writeFileSync(GAME_INFO_FILE, JSON.stringify(gameInfo, null, 2));
    existingGamesInfo.push({
      id: gameId,
      playerIds: players.map(player => player.id),
      startTime: new Date(),
      endTime: null,
      lobbyId,
      gameWinner: null,
    });
    fs.writeFileSync(
      GAME_INFO_FILE,
      JSON.stringify(existingGamesInfo, null, 2)
    );
    console.log(
      'Game info saved to DB:',
      existingGamesInfo[existingGamesInfo.length - 1]
    );
  } catch (error) {
    console.error('Error writing game info to DB:', error);
  }
};

const endGameInDB = (gameId: string, winnerId: string): void => {
  try {
    const gameInfo: GameInfo[] = JSON.parse(
      fs.readFileSync(GAME_INFO_FILE, 'utf-8')
    );
    const gameInfoIndex = gameInfo.findIndex(game => game.id === gameId);
    if (gameInfoIndex === -1) {
      console.error('Game info with this ID does not exist:', gameId);
      throw new Error('Game info with this ID does not exist');
    }
    gameInfo[gameInfoIndex].endTime = new Date();
    gameInfo[gameInfoIndex].gameWinner = winnerId;
    fs.writeFileSync(GAME_INFO_FILE, JSON.stringify(gameInfo, null, 2));
    console.log('Game info updated in DB:', gameInfo[gameInfoIndex]);
  } catch (error) {
    console.error('Error updating game info in DB:', error);
  }
};

const connectedPlayers: Map<string, PlayerInfo> = new Map();
const playerIdToSocketId: Map<string, string> = new Map();
const socketIdToPlayerId: Map<string, string> = new Map(); // Track socket -> player ID mapping for reconnection
const usernameToSecretKey: Map<string, string> = new Map(); // Track username -> secret key for authentication

// In-memory lobby state (foundational data structures for future lobby support)
const lobbiesById: Map<string, Lobby> = new Map();
const lobbyIdByPlayerId: Map<string, string> = new Map(); // Each player can be in at most one lobby
const gameIdByLobbyId: Map<string, string> = new Map();

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

let gameLoop: GameLoop | null = null;
let mostRecentGameSnapshot: GameSnapshot | null = null;
let currentRoundGameEvents: GameEvent[] = [];

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
  
  // Auth was already checked in middleware, so this socket is authenticated
  console.log(`[Connection] ✓ Socket connected: ${socket.id} from ${origin || 'proxy'} (${address})`);

  // send the connected players to the clients even before login
  // so they can see who is already connected
  emitConnectedPlayers();

  socket.on('login', (data: LoginData) => {
    console.log('Received login event from socket:', socket.id);
    handleLogin(socket, data);
  });

  socket.on('createLobby', (data: { playerCount: number; name?: string }, callback?: (response: any) => void) => {
    console.log('Received createLobby event from socket:', socket.id, 'playerCount:', data?.playerCount);
    handleCreateLobby(socket, data, callback);
  });

  socket.on('joinLobby', (data: { lobbyId: string }) => {
    console.log('Received joinLobby event from socket:', socket.id, 'lobbyId:', data?.lobbyId);
    handleJoinLobby(socket, data);
  });

  socket.on('leaveLobby', (data: { lobbyId: string }) => {
    console.log('Received leaveLobby event from socket:', socket.id, 'lobbyId:', data?.lobbyId);
    handleLeaveLobby(socket, data);
  });

  socket.on('kickPlayer', (data: { lobbyId: string; targetPlayerId: string }) => {
    console.log('Received kickPlayer event from socket:', socket.id, 'lobbyId:', data?.lobbyId, 'target:', data?.targetPlayerId);
    handleKickPlayer(socket, data);
  });

  socket.on('updateLobbySize', (data: { lobbyId: string; playerCount: number }) => {
    console.log('Received updateLobbySize event from socket:', socket.id, 'lobbyId:', data?.lobbyId, 'playerCount:', data?.playerCount);
    handleUpdateLobbySize(socket, data);
  });

  socket.on('listLobbies', () => {
    console.log('Received listLobbies request from socket:', socket.id);
    handleListLobbies(socket);
  });

  socket.on('startLobbyGame', (data: { lobbyId: string }) => {
    console.log('Received startLobbyGame event from socket:', socket.id, 'lobbyId:', data?.lobbyId);
    handleStartLobbyGame(socket, data).catch(error => {
      console.error('Error starting lobby game:', error);
      socket.emit('error', { message: 'Failed to start game' });
    });
  });

  socket.on('getConnectedPlayers', () => {
    console.log('Received getConnectedPlayers request from socket:', socket.id);
    // Send current connected players to this specific client
    const playersIdAndName: PlayerIdAndName[] = [];
    connectedPlayers.forEach(playerInfo => {
      playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
    });
    console.log('Sending connected players to requesting client:', playersIdAndName);
    socket.emit('connectedPlayers', playersIdAndName);
  });

  // NOTE: Old startGame/startGameWithPlayerCount/restartGame handlers removed.
  // Use lobby system instead: createLobby -> joinLobby -> startLobbyGame.

  // NOTE: playAgain handler removed - use lobby system for rematch.

  socket.on('disconnect', (reason) => {
    console.log(`A socket disconnected: ${socket.id}, Reason: ${reason}`);
    const playerId = socketIdToPlayerId.get(socket.id);
    
    if (playerId) {
      // If player is in a lobby, remove them and handle cleanup
      const lobbyId = lobbyIdByPlayerId.get(playerId);
      if (lobbyId) {
        const lobby = lobbiesById.get(lobbyId);
        if (lobby && lobby.status === 'waiting') {
          console.log(`Player ${playerId} disconnected while in lobby ${lobby.name}`);
          // Remove player from lobby
          const playerIndex = lobby.players.findIndex(p => p.playerId === playerId);
          if (playerIndex !== -1) {
            lobby.players.splice(playerIndex, 1);
          }
          lobbyIdByPlayerId.delete(playerId);
          
          // If host left and others remain, transfer host
          if (playerId === lobby.hostId && lobby.players.length > 0) {
            const newHostId = lobby.players[0].playerId;
            lobby.hostId = newHostId;
            console.log(`Host transferred to ${lobby.players[0].displayName} in lobby ${lobby.name}`);
            io.emit('lobbyUpdated', lobby);
          } else if (lobby.players.length === 0) {
            // If lobby is now empty, mark as finished
            lobby.status = 'finished';
            console.log(`Lobby ${lobby.name} is now empty after disconnect, marking as finished`);
            io.emit('lobbyClosed', { lobbyId });
          } else {
            io.emit('lobbyUpdated', lobby);
          }
        }
      }
      
      // Only remove the player if the game loop is not running
      if (!gameLoop) {
        connectedPlayers.delete(playerId);
        playerIdToSocketId.delete(playerId);
        socketIdToPlayerId.delete(socket.id);
        console.log(`Removed player ${playerId} (socket ${socket.id})`);
        // send updated connected players to all clients
        emitConnectedPlayers();
      } else {
        console.log('Game loop is already running. Not removing player.');
      }
    }
  });

  socket.on('heartbeat', () => {
    console.log('Received heartbeat from client');
  });
});

// Generate a secure random secret key
function generateSecretKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
}

function handleJoinLobby(socket: Socket, data: { lobbyId: string }): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId } = data;

  // Check if player is already in a lobby
  if (lobbyIdByPlayerId.has(playerId)) {
    console.error('Player already in a lobby:', playerId);
    socket.emit('error', { message: 'Already in a lobby' });
    return;
  }

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) {
    console.error('Lobby not found:', lobbyId);
    socket.emit('error', { message: 'Lobby not found' });
    return;
  }

  // Check if lobby is waiting
  if (lobby.status !== 'waiting') {
    console.error('Lobby not waiting:', lobbyId, 'status:', lobby.status);
    socket.emit('error', { message: 'Lobby is not accepting new players' });
    return;
  }

  // Check if lobby is full
  if (lobby.players.length >= lobby.playerCount) {
    console.error('Lobby is full:', lobbyId);
    socket.emit('error', { message: 'Lobby is full' });
    return;
  }

  const playerInfo = connectedPlayers.get(playerId);
  const playerDisplayName = playerInfo?.name || 'Unknown';

  // Add player to lobby
  lobby.players.push({ playerId, displayName: playerDisplayName });
  lobbyIdByPlayerId.set(playerId, lobbyId);

  console.log(`Player ${playerDisplayName} joined lobby ${lobby.name} (${lobbyId})`);

  // Broadcast update to all clients
  io.emit('lobbyUpdated', lobby);
}

function handleLeaveLobby(socket: Socket, data: { lobbyId: string }): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId } = data;

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) {
    console.error('Lobby not found:', lobbyId);
    socket.emit('error', { message: 'Lobby not found' });
    return;
  }

  // Check if player is in this lobby
  const playerIndex = lobby.players.findIndex(p => p.playerId === playerId);
  if (playerIndex === -1) {
    console.error('Player not in lobby:', playerId, lobbyId);
    socket.emit('error', { message: 'You are not in this lobby' });
    return;
  }

  // Remove player from lobby
  lobby.players.splice(playerIndex, 1);
  lobbyIdByPlayerId.delete(playerId);

  const playerInfo = connectedPlayers.get(playerId);
  const playerDisplayName = playerInfo?.name || 'Unknown';
  console.log(`Player ${playerDisplayName} left lobby ${lobby.name} (${lobbyId})`);

  // If host left and others remain, transfer host
  if (playerId === lobby.hostId && lobby.players.length > 0) {
    const newHostId = lobby.players[0].playerId;
    lobby.hostId = newHostId;
    console.log(`Host transferred to ${lobby.players[0].displayName} in lobby ${lobby.name}`);
  }

  // If lobby is empty, mark as finished
  if (lobby.players.length === 0) {
    lobby.status = 'finished';
    console.log(`Lobby ${lobby.name} is now empty, marking as finished`);
    io.emit('lobbyClosed', { lobbyId });
    return;
  }

  // Broadcast update to all clients
  io.emit('lobbyUpdated', lobby);
}

function handleKickPlayer(socket: Socket, data: { lobbyId: string; targetPlayerId: string }): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId, targetPlayerId } = data;

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) {
    console.error('Lobby not found:', lobbyId);
    socket.emit('error', { message: 'Lobby not found' });
    return;
  }

  // Check if player is host
  if (playerId !== lobby.hostId) {
    console.error('Not the host:', playerId, 'actual host:', lobby.hostId);
    socket.emit('error', { message: 'Only the host can kick players' });
    return;
  }

  // Check if target is in this lobby
  const targetIndex = lobby.players.findIndex(p => p.playerId === targetPlayerId);
  if (targetIndex === -1) {
    console.error('Target player not in lobby:', targetPlayerId, lobbyId);
    socket.emit('error', { message: 'Player not in this lobby' });
    return;
  }

  const targetPlayerName = lobby.players[targetIndex].displayName;

  // Remove target from lobby
  lobby.players.splice(targetIndex, 1);
  lobbyIdByPlayerId.delete(targetPlayerId);

  console.log(`Player ${targetPlayerName} was kicked from lobby ${lobby.name} (${lobbyId}) by host ${playerId}`);

  // Notify the kicked player
  const targetSocketId = playerIdToSocketId.get(targetPlayerId);
  if (targetSocketId) {
    io.to(targetSocketId).emit('kickedFromLobby', { lobbyId, reason: 'You were kicked by the host' });
  }

  // If lobby is now empty, mark as finished
  if (lobby.players.length === 0) {
    lobby.status = 'finished';
    console.log(`Lobby ${lobby.name} is now empty, marking as finished`);
    io.emit('lobbyClosed', { lobbyId });
    return;
  }

  // Broadcast update to all clients
  io.emit('lobbyUpdated', lobby);
}

function handleUpdateLobbySize(socket: Socket, data: { lobbyId: string; playerCount: number }): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId, playerCount } = data;

  // Validate player count
  if (!playerCount || playerCount < 2 || playerCount > 4) {
    socket.emit('error', { message: 'Player count must be between 2 and 4' });
    return;
  }

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) {
    socket.emit('error', { message: 'Lobby not found' });
    return;
  }

  // Check if player is host
  if (playerId !== lobby.hostId) {
    socket.emit('error', { message: 'Only the host can change lobby size' });
    return;
  }

  // Check if lobby is still waiting
  if (lobby.status !== 'waiting') {
    socket.emit('error', { message: 'Cannot change size after game has started' });
    return;
  }

  // Update the player count
  lobby.playerCount = playerCount;
  console.log(`Lobby ${lobby.name} size updated to ${playerCount} by host ${playerId}`);

  // Broadcast update to all clients
  io.emit('lobbyUpdated', lobby);
}

function handleListLobbies(socket: Socket): void {
  const waitingLobbies = Array.from(lobbiesById.values())
    .filter(lobby => lobby.status === 'waiting')
    .map(lobby => {
      const hostPlayerInfo = connectedPlayers.get(lobby.hostId);
      const hostDisplayName = hostPlayerInfo?.name || 'Unknown';
      return {
        id: lobby.id,
        name: lobby.name,
        hostDisplayName,
        currentPlayers: lobby.players.length,
        playerCount: lobby.playerCount,
        createdAt: lobby.createdAt,
      };
    });

  console.log(`Sending ${waitingLobbies.length} waiting lobbies to client`);
  socket.emit('lobbyList', { lobbies: waitingLobbies });
}

async function handleStartLobbyGame(socket: Socket, data: { lobbyId: string }): Promise<void> {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  const { lobbyId } = data;

  // Check if lobby exists
  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) {
    console.error('Lobby not found:', lobbyId);
    socket.emit('error', { message: 'Lobby not found' });
    return;
  }

  // Check if player is host
  if (playerId !== lobby.hostId) {
    console.error('Not the host:', playerId, 'actual host:', lobby.hostId);
    socket.emit('error', { message: 'Only the host can start the game' });
    return;
  }

  // Check if lobby is waiting
  if (lobby.status !== 'waiting') {
    console.error('Lobby not waiting:', lobbyId, 'status:', lobby.status);
    socket.emit('error', { message: 'Lobby is not in waiting state' });
    return;
  }

  // Build playersInfo from lobby members (humans only, no bots yet)
  const playersInfo: PlayerIdAndName[] = lobby.players.map(p => ({ id: p.playerId, name: p.displayName }));

  // Calculate bots needed
  const botsNeeded = Math.max(0, lobby.playerCount - playersInfo.length);
  console.log(`Starting lobby game: ${lobby.name} with ${playersInfo.length} humans and ${botsNeeded} bots needed`);

  // Create bots
  const botNames = ['Bot Alex', 'Bot Morgan', 'Bot Jordan'];
  const newBotIds: string[] = [];
  for (let i = 0; i < botsNeeded; i++) {
    const botName = botNames[i] || `Bot ${i + 1}`;
    const botAgent = new ExhaustiveSimpleAgent();
    const botId = `${botAgent.playerId}-${Date.now()}-${i}`;
    playersInfo.push({ id: botId, name: botName });
    const botPlayerInfo: PlayerInfo = {
      id: botId,
      name: botName,
      agent: botAgent,
    };
    connectedPlayers.set(botId, botPlayerInfo);
    newBotIds.push(botId);
    console.log(`Added bot: ${botName} (ID: ${botId})`);
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

  gameLoop = new GameLoop(playersInfo);
  agents.forEach((agent, id) => gameLoop!.addAgent(id, agent));

  // Map lobby -> game
  const gameId = gameLoop.cribbageGame.getGameState().id;
  gameIdByLobbyId.set(lobby.id, gameId);

  // Update lobby status and broadcast updates
  lobby.status = 'in_progress';
  io.emit('lobbyUpdated', lobby);

  // Persist game start info
  startGameInDB(gameId, playersInfo, lobby.id);

  // Notify lobby members of the game start
  io.emit('gameStartedFromLobby', { lobbyId: lobby.id, gameId, players: playersInfo });

  // Start the game loop
  await startGame();
}

function handleCreateLobby(socket: Socket, data: { playerCount: number; name?: string }, callback?: (response: any) => void): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  console.log(`[handleCreateLobby] Starting for player: ${playerId}, callback present: ${!!callback}`);
  
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    const error = { error: 'Not logged in' };
    if (callback) {
      console.log('[handleCreateLobby] Sending error callback: Not logged in');
      callback(error);
    }
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  // Check if player is already in a lobby
  if (lobbyIdByPlayerId.has(playerId)) {
    const existingLobbyId = lobbyIdByPlayerId.get(playerId);
    console.error(`[handleCreateLobby] Player ${playerId} already in lobby ${existingLobbyId}`);
    const error = { error: 'Already in a lobby' };
    if (callback) {
      console.log('[handleCreateLobby] Sending error callback: Already in a lobby');
      callback(error);
    }
    socket.emit('error', { message: 'Already in a lobby' });
    return;
  }

  const { playerCount, name: customName } = data;

  // Validate player count
  if (!playerCount || playerCount < 2 || playerCount > 4) {
    console.error('Invalid player count:', playerCount);
    const error = { error: 'Player count must be between 2 and 4' };
    if (callback) callback(error);
    socket.emit('error', { message: 'Player count must be between 2 and 4' });
    return;
  }

  // Generate lobby name (either custom or auto-generated)
  const lobbyName = customName?.trim() || generateUniqueLobbyName();

  // Create the lobby
  const lobbyId = uuidv4();
  const playerInfo = connectedPlayers.get(playerId);
  const hostDisplayName = playerInfo?.name || 'Unknown';

  const lobby: Lobby = {
    id: lobbyId,
    name: lobbyName,
    hostId: playerId,
    playerCount,
    players: [{ playerId, displayName: hostDisplayName }],
    status: 'waiting',
    createdAt: Date.now(),
  };

  lobbiesById.set(lobbyId, lobby);
  lobbyIdByPlayerId.set(playerId, lobbyId);

  console.log(`[handleCreateLobby] Lobby created: ${lobbyName} (${lobbyId}) by ${hostDisplayName}`);

  // Send callback response with the created lobby
  if (callback) {
    console.log('[handleCreateLobby] Sending success callback with lobby:', lobbyId);
    callback({ lobby });
  } else {
    console.error('[handleCreateLobby] WARNING: No callback provided!');
  }

  // Broadcast the new lobby to all clients
  io.emit('lobbyUpdated', lobby);

  // Also send direct confirmation to the creator
  socket.emit('lobbyCreated', { lobbyId, name: lobbyName });
}

function handleLogin(socket: Socket, data: LoginData): void {
  const { username, name, secretKey } = data;
  let agent: WebSocketAgent;
  let playerId: string;
  let newSecretKey: string;

  console.log('Handling login for user:', username, 'socket:', socket.id, 'hasSecretKey:', !!secretKey);

  // Check if this socket already has a player ID (reconnection scenario)
  const existingPlayerId = socketIdToPlayerId.get(socket.id);
  
  if (existingPlayerId) {
    // This socket already has a player ID - this is a reconnection
    const oldPlayerInfo = connectedPlayers.get(existingPlayerId);
    if (oldPlayerInfo && oldPlayerInfo.agent instanceof WebSocketAgent) {
      console.log(
        `Player ${existingPlayerId} (${username}) reconnected. Updating socket for their WebSocketAgent.`
      );
      agent = oldPlayerInfo.agent;
      playerId = existingPlayerId;
      newSecretKey = usernameToSecretKey.get(username) || generateSecretKey();
      
      // Update socket if different
      if (oldPlayerInfo.agent.socket.id !== socket.id) {
        console.log(
          `Replacing old socket ${oldPlayerInfo.agent.socket.id} with new socket ${socket.id}`
        );
        oldPlayerInfo.agent.socket.disconnect(true);
        agent.updateSocket(socket);
      }
      
      // Update player name if it changed
      if (oldPlayerInfo.name !== name) {
        console.log(`Updating player name from "${oldPlayerInfo.name}" to "${name}"`);
        oldPlayerInfo.name = name;
      }
    } else {
      // Player ID exists but no player info - create new
      playerId = existingPlayerId;
      agent = new WebSocketAgent(socket, playerId);
      newSecretKey = usernameToSecretKey.get(username) || generateSecretKey();
      console.log(`Creating new WebSocketAgent for existing player ID: ${playerId}`);
    }
  } else {
    // New login - check if username is already taken
    const existingPlayerInfo = connectedPlayers.get(username);
    const storedSecretKey = usernameToSecretKey.get(username);
    
    if (existingPlayerInfo) {
      // Username is taken - verify secret key
      if (secretKey && storedSecretKey && secretKey === storedSecretKey) {
        // Secret key matches - this is the same user (page refresh scenario)
        console.log(
          `Username ${username} is taken but secret key matches. Replacing old socket with new socket ${socket.id}.`
        );
        playerId = username;
        newSecretKey = storedSecretKey; // Keep existing secret key
        
        // Clean up old mappings
        const oldSocketId = playerIdToSocketId.get(username);
        if (oldSocketId) {
          socketIdToPlayerId.delete(oldSocketId);
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            oldSocket.disconnect(true);
          }
        }
        
        // Reuse existing agent if it's a WebSocketAgent, otherwise create new
        if (existingPlayerInfo.agent instanceof WebSocketAgent) {
          agent = existingPlayerInfo.agent;
          // Update socket reference
          agent.updateSocket(socket);
        } else {
          agent = new WebSocketAgent(socket, playerId);
        }
      } else {
        // Secret key doesn't match or is missing - reject login
        console.log(
          `Username ${username} is already taken and secret key doesn't match. Rejecting login.`
        );
        socket.emit('loginRejected', {
          reason: 'ALREADY_LOGGED_IN',
          message: 'Cannot login. Already logged in somewhere else.',
        });
        return;
      }
    } else {
      // Username is available - create new user with new secret key
      playerId = username;
      newSecretKey = generateSecretKey();
      agent = new WebSocketAgent(socket, playerId);
      console.log(
        `New player login: ${username} assigned player ID: ${playerId} with new secret key`
      );
    }
  }

  // Store secret key for this username
  usernameToSecretKey.set(username, newSecretKey);

  const playerInfo: PlayerInfo = { id: playerId, name, agent };

  // Update mappings
  playerIdToSocketId.set(playerId, socket.id);
  socketIdToPlayerId.set(socket.id, playerId);
  connectedPlayers.set(playerId, playerInfo);
  
  // Clean up any stale lobby membership from previous session
  if (lobbyIdByPlayerId.has(playerId)) {
    const staleLobbyt = lobbyIdByPlayerId.get(playerId);
    if (staleLobbyt) {
      console.log(`[handleLogin] Cleaning up stale lobby membership for ${playerId} in lobby ${staleLobbyt}`);
      // Remove player from stale lobby if it exists
      const lobby = lobbiesById.get(staleLobbyt);
      if (lobby) {
        const playerIndex = lobby.players.findIndex(p => p.playerId === playerId);
        if (playerIndex !== -1) {
          lobby.players.splice(playerIndex, 1);
          console.log(`[handleLogin] Removed ${playerId} from stale lobby ${staleLobbyt}`);
          // If lobby is now empty, mark as finished
          if (lobby.players.length === 0) {
            lobby.status = 'finished';
            io.emit('lobbyClosed', { lobbyId: staleLobbyt });
          } else {
            io.emit('lobbyUpdated', lobby);
          }
        }
      }
    }
    // Clear the stale mapping
    lobbyIdByPlayerId.delete(playerId);
  }

  console.log('emitting loggedIn event to client:', playerId);
  const loggedInData: PlayerIdAndName & { secretKey: string } = {
    id: playerId,
    name,
    secretKey: newSecretKey,
  };
  socket.emit('loggedIn', loggedInData);
  emitConnectedPlayers();
  
  // if the game loop is running, send the most recent game data to the client
  if (gameLoop) {
    sendMostRecentGameData(socket);
  }
}

// create function that emits the current connected players to all clients
function emitConnectedPlayers(): void {
  const playersIdAndName: PlayerIdAndName[] = [];
  connectedPlayers.forEach(playerInfo => {
    playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
  });
  console.log('Emitting connected players to all clients:', playersIdAndName);
  io.emit('connectedPlayers', playersIdAndName);
  // for (const [_, playerInfo] of connectedPlayers) {
  //   if (playerInfo.agent instanceof WebSocketAgent) {
  //     // Emit to the specific player
  //     playerInfo.agent.socket.emit('connectedPlayers', playersIdAndName);
  //   }

  // }
}

// NOTE: Removed handleStartGame() and handleRestartGame() - use handleStartLobbyGame() instead.

function sendMostRecentGameData(socket: Socket): void {
  console.log('Sending most recent game data to client');
  
  // Find which player this socket belongs to
  const playerId = socketIdToPlayerId.get(socket.id);

  if (!playerId) {
    console.error('Could not find player ID for socket:', socket.id);
    return;
  }

  // Send redacted GameSnapshot for this specific player
  if (mostRecentGameSnapshot && gameLoop) {
    // Check if player exists in the game before trying to get redacted state
    const currentGameState = gameLoop.cribbageGame.getGameState();
    const playerExistsInGame = currentGameState.players.some(
      p => p.id === playerId
    );
    
    if (!playerExistsInGame) {
      console.log(
        `Player ${playerId} not found in game. Skipping game state send.`
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

    const redactedGameState = gameLoop.cribbageGame.getRedactedGameState(
      playerId
    );
    const redactedGameEvent = gameLoop.cribbageGame.getRedactedGameEvent(
      mostRecentGameSnapshot.gameEvent,
      playerId
    );
    const redactedSnapshot: GameSnapshot = {
      gameState: redactedGameState,
      gameEvent: redactedGameEvent,
      pendingDecisionRequests: mostRecentGameSnapshot.pendingDecisionRequests, // Include pending requests
    };
    socket.emit('gameSnapshot', redactedSnapshot);
  } else {
    console.log('no mostRecentGameSnapshot to send...');
  }
  
  // Send redacted current round game events
  if (gameLoop && mostRecentGameSnapshot) {
    // Check if player exists in game before redacting events
    const currentGameState = gameLoop.cribbageGame.getGameState();
    const playerExistsInGame = currentGameState.players.some(
      p => p.id === playerId
    );
    
    if (playerExistsInGame) {
      const redactedRoundEvents = currentRoundGameEvents.map(event =>
        gameLoop!.cribbageGame.getRedactedGameEvent(event, playerId)
      );
      socket.emit('currentRoundGameEvents', redactedRoundEvents);
    } else {
      socket.emit('currentRoundGameEvents', []);
    }
  } else {
      socket.emit('currentRoundGameEvents', currentRoundGameEvents);
  }
}

async function startGame(): Promise<void> {
  if (!gameLoop) {
    console.error(
      '[startGame()] Game loop not initialized. Cannot start game.'
    );
    return;
  }
  console.log('Starting game loop...');
  const winner = await gameLoop.playGame();
  endGameInDB(gameLoop.cribbageGame.getGameState().id, winner);

  // Wait a brief moment to ensure the final snapshot with Phase.END is sent to all clients
  // The endGame() call emits a gameSnapshot event which needs to be processed and sent
  await new Promise(resolve => setTimeout(resolve, 100));

  // Clear gameLoop after game ends so a new game can be started
  console.log('Game ended. Clearing game loop to allow new game.');
  gameLoop.removeAllListeners();
  gameLoop = null;

  io.emit('gameOver', winner);
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
