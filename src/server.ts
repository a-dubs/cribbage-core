import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameLoop } from './gameplay/GameLoop';
import {
  ActionType,
  EmittedWaitingForPlayer,
  GameAgent,
  GameEvent,
  PlayerIdAndName,
  GameInfo,
  GameSnapshot,
} from './types';
import { WebSocketAgent } from './agents/WebSocketAgent';
import { SimpleAgent } from './agents/SimpleAgent';
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

const io = new Server(server, {
  cors: {
    origin: WEB_APP_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
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
const playAgainVotes: Set<string> = new Set();
let gameLoop: GameLoop | null = null;
let mostRecentGameSnapshot: GameSnapshot | null = null;
let mostRecentWaitingForPlayer: EmittedWaitingForPlayer | null = null;
let currentRoundGameEvents: GameEvent[] = [];

io.on('connection', socket => {
  const token = socket.handshake.auth.token;
  if (token !== WEBSOCKET_AUTH_TOKEN) {
    console.log('Incorrect socket token for socket:', socket.id);
    socket.disconnect();
    return;
  }
  console.log('New socket connection:', socket.id);

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

  socket.on('playAgain', () => {
    const playerId = [...playerIdToSocketId.entries()].find(
      ([, id]) => id === socket.id
    )?.[0];
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
      playerIdToSocketId.forEach((socketId, playerId) => {
        if (socketId === socket.id) {
          connectedPlayers.delete(playerId);
          playerIdToSocketId.delete(playerId);
        }
      });
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
  console.log('Handling login for user:', username);

  // Replace old socket if player reconnects
  const oldPlayerInfo = connectedPlayers.get(username);

  if (oldPlayerInfo && oldPlayerInfo.agent instanceof WebSocketAgent) {
    console.log(
      `Player ${username} reconnected. Updating socket for their WebSocketAgent.`
    );
    agent = oldPlayerInfo.agent;
    console.log(
      `Old socket ID: ${oldPlayerInfo.agent.socket.id}, New socket ID: ${socket.id}`
    );
    // compare the socket ids and if they are different, replace the socket
    if (oldPlayerInfo.agent.socket.id !== socket.id) {
      console.log(
        `Replacing old socket ${oldPlayerInfo.agent.socket.id} with new socket ${socket.id}`
      );
      oldPlayerInfo.agent.socket.disconnect(true); // Disconnect old socket if applicable
      agent.updateSocket(socket);
    }
  } else {
    console.log(
      `Player ${username} logged in for the first time. Creating new WebSocketAgent.`
    );
    agent = new WebSocketAgent(socket, username);
  }
  const playerInfo: PlayerInfo = { id: username, name, agent };

  playerIdToSocketId.set(username, socket.id);

  connectedPlayers.set(username, playerInfo);
  console.log('emitting loggedIn event to client:', username);
  const loggedInData: PlayerIdAndName = {
    id: username,
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
  if (gameLoop) {
    console.error('Game loop already running. Cannot start a new game.');
    throw new Error('Game loop already running. Cannot start a new game.');
  }
  console.log('Starting game...');
  // If only one player is connected, add a bot
  if (connectedPlayers.size === 1) {
    console.log('Adding a bot to start the game.');
    const botName = 'Simple Optimal Bot';
    const botAgent = new SimpleAgent();
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

  // Emit game state changes
  gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
    io.emit('gameSnapshot', newSnapshot);
    mostRecentGameSnapshot = newSnapshot;
    sendGameEventToDB(newSnapshot.gameEvent);
    currentRoundGameEvents.push(newSnapshot.gameEvent);
    if (newSnapshot.gameEvent.actionType === ActionType.START_ROUND) {
      currentRoundGameEvents = [];
    }
    io.emit('currentRoundGameEvents', currentRoundGameEvents);
  });
  gameLoop.on('waitingForPlayer', (waitingData: EmittedWaitingForPlayer) => {
    io.emit('waitingForPlayer', waitingData);
    mostRecentWaitingForPlayer = waitingData;
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

function sendMostRecentGameData(socket: Socket): void {
  console.log('Sending most recent game data to client');
  if (mostRecentWaitingForPlayer) {
    socket.emit('waitingForPlayer', mostRecentWaitingForPlayer);
  }
  if (mostRecentGameSnapshot) {
    socket.emit('gameSnapshot', mostRecentGameSnapshot);
  } else {
    console.log('no mostRecentGameSnapshot to send...');
  }
  socket.emit('currentRoundGameEvents', currentRoundGameEvents);
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

  // Reset play again votes and automatically add bots
  playAgainVotes.clear();

  // Add all bot players to play again votes automatically
  connectedPlayers.forEach(playerInfo => {
    if (playerInfo.agent instanceof SimpleAgent) {
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
