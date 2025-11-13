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

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const WEBSOCKET_AUTH_TOKEN = process.env.WEBSOCKET_AUTH_TOKEN;
const JSON_DB_DIR = process.env.JSON_DB_DIR || path.join(__dirname, 'json_db');
console.log('JSON_DB_DIR:', JSON_DB_DIR);
// create the directory if it does not exist
if (!fs.existsSync(JSON_DB_DIR)) {
  fs.mkdirSync(JSON_DB_DIR);
}

if (!WEBSOCKET_AUTH_TOKEN) {
  console.error('WEBSOCKET_AUTH_TOKEN is not set');
  throw new Error('WEBSOCKET_AUTH_TOKEN is not set');
}

console.log('PORT:', PORT);
console.log('WEB_APP_ORIGIN:', WEB_APP_ORIGIN);

console.log('Cribbage-core server starting...');

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
  
  if (origins.length === 1) {
    return origins[0];
  }
  
  // Multiple origins - use function to check dynamically
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true); // Allow requests with no origin (e.g., mobile apps, Postman)
      return;
    }
    const isAllowed = origins.some(allowedOrigin => {
      // Support wildcard subdomains
      if (allowedOrigin.startsWith('*.')) {
        const domain = allowedOrigin.slice(2);
        return origin.endsWith(domain);
      }
      return origin === allowedOrigin;
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
});

interface PlayerInfo {
  id: string;
  name: string;
  agent: GameAgent;
}

interface LoginData {
  username: string;
  name: string;
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
const playAgainVotes: Set<string> = new Set();
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
  const token = socket.handshake.auth.token;
  const origin = socket.handshake.headers.origin;
  console.log(`[Connection] New socket connection attempt: ${socket.id}, origin: ${origin}, token present: ${!!token}`);
  
  if (token !== WEBSOCKET_AUTH_TOKEN) {
    console.error(`[Connection] Incorrect socket token for socket: ${socket.id}. Expected: ${WEBSOCKET_AUTH_TOKEN ? '***' : 'NOT SET'}, Got: ${token ? '***' : 'NOT PROVIDED'}`);
    socket.emit('error', { message: 'Authentication failed: Invalid token' });
    socket.disconnect();
    return;
  }
  console.log(`[Connection] Authenticated socket connection: ${socket.id} from origin: ${origin}`);

  // send the connected players to the clients even before login
  // so they can see who is already connected
  emitConnectedPlayers();

  socket.on('login', (data: LoginData) => {
    console.log('Received login event from socket:', socket.id);
    handleLogin(socket, data);
  });

  socket.on('startGame', () => {
    console.log('Received startGame event from socket:', socket.id);
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

  socket.on('disconnect', () => {
    console.log('A socket disconnected:', socket.id);
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

function handleLogin(socket: Socket, data: LoginData): void {
  const { username, name } = data;
  let agent: WebSocketAgent;
  let playerId: string;

  console.log('Handling login for user:', username, 'socket:', socket.id);

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
      console.log(`Creating new WebSocketAgent for existing player ID: ${playerId}`);
    }
  } else {
    // New login - use username as player ID, with conflict resolution
    playerId = getUniquePlayerId(username, socket.id);
    agent = new WebSocketAgent(socket, playerId);
    console.log(
      `New player login: ${username} assigned player ID: ${playerId}`
    );
  }

  const playerInfo: PlayerInfo = { id: playerId, name, agent };

  // Update mappings
  playerIdToSocketId.set(playerId, socket.id);
  socketIdToPlayerId.set(socket.id, playerId);
  connectedPlayers.set(playerId, playerInfo);

  console.log('emitting loggedIn event to client:', playerId);
  const loggedInData: PlayerIdAndName = {
    id: playerId,
    name,
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
      console.error('Game loop already running. Cannot start a new game.');
      throw new Error('Game loop already running. Cannot start a new game.');
    }
  }
  console.log('Starting game...');
  // If only one player is connected, add a bot
  if (connectedPlayers.size === 1) {
    console.log('Adding a bot to start the game.');
    const botName = 'Simple Optimal Bot';
    const botAgent = new ExhaustiveSimpleAgent();
    const botId = botAgent.playerId;
    const botPlayerInfo: PlayerInfo = {
      id: botId,
      name: botName,
      agent: botAgent,
    };
    connectedPlayers.set(botId, botPlayerInfo);
  }

  if (connectedPlayers.size < 2) {
    console.log('Not enough players to start the game.');
    return;
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
    const snapshotReceivedTime = Date.now();
    const actionType = newSnapshot.gameEvent.actionType;
    const pendingRequests = newSnapshot.pendingDecisionRequests || [];
    const readyForCountingRequests = pendingRequests.filter(r => r.decisionType === 'READY_FOR_COUNTING' || r.decisionType === 'READY_FOR_NEXT_ROUND');
    
    if (readyForCountingRequests.length > 0) {
      console.log(`[TIMING] Server received gameSnapshot event at ${snapshotReceivedTime}ms with ${readyForCountingRequests.length} acknowledgment requests`);
    }
    
    // Store the full snapshot for internal use (agents, database, etc.)
    mostRecentGameSnapshot = newSnapshot;
    sendGameEventToDB(newSnapshot.gameEvent);
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
        const redactStartTime = Date.now();
        const redactedGameState = gameLoop!.cribbageGame.getRedactedGameState(
          playerInfo.id
        );
        const redactedGameEvent = gameLoop!.cribbageGame.getRedactedGameEvent(
          newSnapshot.gameEvent,
          playerInfo.id
        );
        const redactEndTime = Date.now();
        
        if (readyForCountingRequests.length > 0) {
          console.log(`[TIMING] Server redacted snapshot for player ${playerInfo.id} at ${redactEndTime}ms (redaction took ${redactEndTime - redactStartTime}ms)`);
        }
        
        const redactedSnapshot: GameSnapshot = {
          gameState: redactedGameState,
          gameEvent: redactedGameEvent,
          pendingDecisionRequests: newSnapshot.pendingDecisionRequests, // Include pending requests
        };
        
        const emitStartTime = Date.now();
        io.to(socketId).emit('gameSnapshot', redactedSnapshot);
        const emitEndTime = Date.now();
        
        if (readyForCountingRequests.length > 0) {
          console.log(`[TIMING] Server emitted gameSnapshot to player ${playerInfo.id} at ${emitEndTime}ms (emit took ${emitEndTime - emitStartTime}ms, total from receive: ${emitEndTime - snapshotReceivedTime}ms)`);
        }

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
  const lobbyId = 'lobbyId'; // TODO: replace with actual lobby ID once lobbies are implemented
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

  // Start a new game
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
    const redactedRoundEvents = currentRoundGameEvents.map(event =>
      gameLoop!.cribbageGame.getRedactedGameEvent(event, playerId)
    );
    socket.emit('currentRoundGameEvents', redactedRoundEvents);
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
