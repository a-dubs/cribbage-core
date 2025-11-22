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

const playAgainVotes: Set<string> = new Set();
let gameLoop: GameLoop | null = null;
let mostRecentGameSnapshot: GameSnapshot | null = null;
let currentRoundGameEvents: GameEvent[] = [];
let requestedPlayerCount: number = 2; // Track requested player count for current game

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

  socket.on('createLobby', (data: { playerCount: number; name?: string }) => {
    console.log('Received createLobby event from socket:', socket.id, 'playerCount:', data?.playerCount);
    handleCreateLobby(socket, data);
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

  socket.on('startGame', () => {
    console.log('Received startGame event from socket:', socket.id);
    requestedPlayerCount = 2; // Default to 2-player game
    handleStartGame().catch(error => {
      console.error('Error starting game:', error);
    });
  });

  socket.on('startGameWithPlayerCount', (data: { playerCount: number }) => {
    console.log('Received startGameWithPlayerCount event from socket:', socket.id, 'playerCount:', data?.playerCount);
    const playerCount = data?.playerCount;
    if (!playerCount || playerCount < 2 || playerCount > 4) {
      console.error('Invalid player count:', playerCount);
      socket.emit('error', { message: 'Player count must be between 2 and 4' });
      return;
    }
    requestedPlayerCount = playerCount;
    handleStartGame().catch(error => {
      console.error('Error starting game:', error);
    });
  });

  socket.on('restartGame', () => {
    console.log('Received restartGame event from socket:', socket.id);
    handleRestartGame().catch(error => {
      console.error('Error restarting game:', error);
    });
  });

  socket.on('playAgain', () => {
    const playerId = socketIdToPlayerId.get(socket.id);
    if (!playerId) {
      console.error('Player ID not found for socket:', socket.id);
      return;
    }
    console.log(`Player ${playerId} voted to play again.`);
    playAgainVotes.add(playerId);

    if (playAgainVotes.size === connectedPlayers.size) {
      console.log('All players voted to play again. Starting a new game.');
      playAgainVotes.clear();
      handleStartGame().catch(error => {
        console.error('Error starting new game:', error);
      });
    } else {
      io.emit('playAgainVotes', Array.from(playAgainVotes));
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`A socket disconnected: ${socket.id}, Reason: ${reason}`);
    // only remove the player if the game loop is not running
    if (!gameLoop) {
      const playerId = socketIdToPlayerId.get(socket.id);
      if (playerId) {
        connectedPlayers.delete(playerId);
        playerIdToSocketId.delete(playerId);
        socketIdToPlayerId.delete(socket.id);
        console.log(`Removed player ${playerId} (socket ${socket.id})`);
      }
      // send updated connected players to all clients
      emitConnectedPlayers();
    } else {
      console.log('Game loop is already running. Not removing player.');
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

function handleCreateLobby(socket: Socket, data: { playerCount: number; name?: string }): void {
  const playerId = socketIdToPlayerId.get(socket.id);
  if (!playerId) {
    console.error('Player ID not found for socket:', socket.id);
    socket.emit('error', { message: 'Not logged in' });
    return;
  }

  // Check if player is already in a lobby
  if (lobbyIdByPlayerId.has(playerId)) {
    console.error('Player already in a lobby:', playerId);
    socket.emit('error', { message: 'Already in a lobby' });
    return;
  }

  const { playerCount, name: customName } = data;

  // Validate player count
  if (!playerCount || playerCount < 2 || playerCount > 4) {
    console.error('Invalid player count:', playerCount);
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

  console.log(`Lobby created: ${lobbyName} (${lobbyId}) by ${hostDisplayName}`);

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

async function handleStartGame(): Promise<void> {
  // If gameLoop exists, check if game is over (Phase.END)
  // If game is over, clear it to allow starting a new game
  if (gameLoop) {
    const gameState = gameLoop.cribbageGame.getGameState();
    if (gameState.currentPhase === Phase.END) {
      console.log('Game is over. Clearing game loop to start a new game.');
      gameLoop.removeAllListeners();
      gameLoop = null;
    } else {
      // Game is already running - silently ignore duplicate startGame requests
      // This can happen during restart when client sends startGame after server already started it
      console.log('Game loop already running. Ignoring duplicate startGame request.');
      return;
    }
  }
  
  console.log(`Starting game... (requested player count: ${requestedPlayerCount})`);
  
  // Validate requested player count
  if (requestedPlayerCount < 2 || requestedPlayerCount > 4) {
    console.error(`Invalid player count: ${requestedPlayerCount}. Must be between 2 and 4.`);
    return;
  }
  
  // Add bots to fill empty seats
  const botsNeeded = Math.max(0, requestedPlayerCount - connectedPlayers.size);
  console.log(`Current players: ${connectedPlayers.size}, Bots needed: ${botsNeeded}`);
  
  // Friendly bot names with "Bot " prefix
  const botNames = [
    'Bot Alex',
    'Bot Morgan',
    'Bot Jordan',
  ];
  
  for (let i = 0; i < botsNeeded; i++) {
    const botName = botNames[i] || `Bot ${i + 1}`;
    const botAgent = new ExhaustiveSimpleAgent();
    // Create unique bot ID by appending timestamp and counter to avoid collisions
    const botId = `${botAgent.playerId}-${Date.now()}-${i}`;
    const botPlayerInfo: PlayerInfo = {
      id: botId,
      name: botName,
      agent: botAgent,
    };
    connectedPlayers.set(botId, botPlayerInfo);
    console.log(`Added bot: ${botName} (ID: ${botId})`);
  }

  if (connectedPlayers.size < requestedPlayerCount) {
    console.log(`Not enough players to start the game. Expected ${requestedPlayerCount}, got ${connectedPlayers.size}.`);
    return;
  }
  
  if (connectedPlayers.size > requestedPlayerCount) {
    console.log(`Warning: More players than requested. Expected ${requestedPlayerCount}, got ${connectedPlayers.size}. Game will proceed with all players.`);
  }

  const playersIdAndName: PlayerIdAndName[] = [];
  const agents: Map<string, GameAgent> = new Map();

  connectedPlayers.forEach(playerInfo => {
    playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
    agents.set(playerInfo.id, playerInfo.agent);
  });

  gameLoop = new GameLoop(playersIdAndName);

  agents.forEach((agent, id) => {
    if (gameLoop) {
      gameLoop.addAgent(id, agent);
    } else {
      console.error(
        '[handleStartGame()] Game loop not initialized. Cannot add agent and start game.'
      );
      throw new Error('Game loop not initialized');
    }
  });

  // Emit game state changes with redaction per player
  gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
    // Log tri-line snapshot format
    const gameState = gameLoop!.cribbageGame.getGameState();
    const eventPlayer = newSnapshot.gameEvent.playerId
      ? gameState.players.find(p => p.id === newSnapshot.gameEvent.playerId)?.name || 'Unknown'
      : 'System';
    
    logger.logGameEvent(eventPlayer, newSnapshot.gameEvent.actionType, newSnapshot.gameEvent.scoreChange);
    logger.logGameState(gameState.roundNumber, gameState.currentPhase, gameState.snapshotId.toString());
    
    const pendingRequests = newSnapshot.pendingDecisionRequests || [];
    const requestInfo = pendingRequests.map(r => ({
      name: gameState.players.find(p => p.id === r.playerId)?.name || r.playerId,
      type: r.decisionType,
    }));
    logger.logPendingRequests(requestInfo);
    
    // Store the full snapshot for internal use (agents, database, etc.)
    mostRecentGameSnapshot = newSnapshot;
    currentRoundGameEvents.push(newSnapshot.gameEvent);
    if (newSnapshot.gameEvent.actionType === ActionType.START_ROUND) {
      currentRoundGameEvents = [];
    }

    // Update WebSocketAgents with the latest snapshot
    connectedPlayers.forEach(playerInfo => {
      if (playerInfo.agent instanceof WebSocketAgent) {
        playerInfo.agent.updateGameSnapshot(newSnapshot);
      }
    });

    // Send redacted GameSnapshot to each player
    // Each player only sees their own cards, opponents' cards are 'UNKNOWN'
    connectedPlayers.forEach(playerInfo => {
      const socketId = playerIdToSocketId.get(playerInfo.id);
      if (socketId) {
        const redactedGameState = gameLoop!.cribbageGame.getRedactedGameState(
          playerInfo.id
        );
        const redactedGameEvent = gameLoop!.cribbageGame.getRedactedGameEvent(
          newSnapshot.gameEvent,
          playerInfo.id
        );
        
        const redactedSnapshot: GameSnapshot = {
          gameState: redactedGameState,
          gameEvent: redactedGameEvent,
          pendingDecisionRequests: newSnapshot.pendingDecisionRequests, // Include pending requests
        };
        
        io.to(socketId).emit('gameSnapshot', redactedSnapshot);

        // Also send redacted current round game events to this player
        const redactedRoundEvents = currentRoundGameEvents.map(event =>
          gameLoop!.cribbageGame.getRedactedGameEvent(event, playerInfo.id)
        );
        io.to(socketId).emit('currentRoundGameEvents', redactedRoundEvents);
      }
    });
  });
  // send the connected players to the clients
  emitConnectedPlayers();

  // Start the game in the database
  const gameId = gameLoop.cribbageGame.getGameState().id;
  // For now, associate all games with a single default lobby ID until real lobbies are wired up
  const lobbyId = DEFAULT_LOBBY_ID;
  startGameInDB(gameId, playersIdAndName, lobbyId);

  // send gameStart event to all clients
  io.emit('gameStart', {
    gameId,
    players: playersIdAndName,
  });

  // Start the game
  await startGame();
}

async function handleRestartGame(): Promise<void> {
  console.log('Restarting game...');
  
  // Check if restart is enabled (development only)
  const RESTART_ENABLED = process.env.ENABLE_RESTART_GAME === 'true';
  if (!RESTART_ENABLED) {
    console.log('Restart game is disabled. Set ENABLE_RESTART_GAME=true to enable.');
    return;
  }

  // Clear current game state
  if (gameLoop) {
    console.log('Clearing current game loop...');
    // Remove all listeners to prevent memory leaks
    gameLoop.removeAllListeners();
    gameLoop = null;
  }

  // Reset state
  playAgainVotes.clear();
  mostRecentGameSnapshot = null;
  currentRoundGameEvents = [];

  // Emit game reset event to all clients
  io.emit('gameReset');

  // Start a new game with the same player count
  console.log(`Restarting with ${requestedPlayerCount} players`);
  await handleStartGame();
}

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
      socket.emit('playAgainVotes', []);
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
  socket.emit('playAgainVotes', Array.from(playAgainVotes));
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

  // Reset play again votes and automatically add bots
  playAgainVotes.clear();

  // Add all bot players to play again votes automatically
  connectedPlayers.forEach(playerInfo => {
    if (playerInfo.agent instanceof ExhaustiveSimpleAgent) {
      playAgainVotes.add(playerInfo.id);
      console.log(
        `Bot player ${playerInfo.id} automatically voted to play again.`
      );
    }
  });

  // Emit updated play again votes to all clients
  io.emit('playAgainVotes', Array.from(playAgainVotes));
  io.emit('gameOver', winner);
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
