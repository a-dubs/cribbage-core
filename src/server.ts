import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameLoop } from './gameplay/GameLoop';
import {
  ActionType,
  EmittedWaitingForPlayer,
  GameAgent,
  GameEvent,
  GameState,
  PlayerIdAndName,
  GameInfo,
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

const server = http.createServer();
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
      players: players,
      startTime: new Date(),
      endTime: null,
      lobbyId,
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

const endGameInDB = (gameId: string): void => {
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
let mostRecentGameState: GameState | null = null;
let mostRecentGameEvent: GameEvent | null = null;
let mostRecentWaitingForPlayer: EmittedWaitingForPlayer | null = null;
let currentRoundGameEvents: GameEvent[] = [];

io.on('connection', socket => {
  const token = socket.handshake.auth.token;
  if (token !== 'dummy-auth-token') {
    console.log('Authentication failed for socket:', socket.id);
    socket.disconnect();
    return;
  }

  console.log('A user connected:', socket.id);

  // send the connected players to the clients even before login
  // so they can see who is already connected
  emitConnectedPlayers();

  socket.on('login', (data: LoginData) => {
    handleLogin(socket, data);
  });

  socket.on('startGame', () => {
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
    console.log('A user disconnected:', socket.id);
    // only remove the player if the game loop is not running
    if (!GameLoop) {
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

  // Replace old socket if player reconnects
  const oldPlayerInfo = connectedPlayers.get(username);

  if (oldPlayerInfo && oldPlayerInfo.agent instanceof WebSocketAgent) {
    console.log(
      `Player ${username} reconnected. Updating socket for their WebSocketAgent.`
    );
    oldPlayerInfo.agent.socket.disconnect(true); // Disconnect old socket if applicable
    agent = oldPlayerInfo.agent;
    agent.updateSocket(socket);
    // if the game loop is running, send the most recent game data to the client
    if (gameLoop) {
      sendMostRecentGameData(socket);
    }
  } else {
    agent = new WebSocketAgent(socket, username);
  }
  const playerInfo: PlayerInfo = { id: username, name, agent };

  playerIdToSocketId.set(username, socket.id);

  connectedPlayers.set(username, playerInfo);
  socket.emit('loggedIn', 'You are logged in!');
  emitConnectedPlayers();
}

// create function that emits the current connected players to all clients
function emitConnectedPlayers(): void {
  const playersIdAndName: PlayerIdAndName[] = [];
  connectedPlayers.forEach(playerInfo => {
    playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
  });
  io.emit('connectedPlayers', playersIdAndName);
}

async function handleStartGame(): Promise<void> {
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
  gameLoop.on('gameStateChange', (newGameState: GameState) => {
    io.emit('gameStateChange', newGameState);
    mostRecentGameState = newGameState;
  });
  gameLoop.on('gameEvent', (gameEvent: GameEvent) => {
    io.emit('gameEvent', gameEvent);
    mostRecentGameEvent = gameEvent;
    if (gameEvent.actionType === ActionType.START_ROUND) {
      currentRoundGameEvents = [];
    }
    currentRoundGameEvents.push(gameEvent);
    sendGameEventToDB(gameEvent);
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
  if (mostRecentGameState) {
    socket.emit('gameStateChange', mostRecentGameState);
  }
  if (mostRecentGameEvent) {
    socket.emit('gameEvent', mostRecentGameEvent);
  }
  if (mostRecentWaitingForPlayer) {
    socket.emit('waitingForPlayer', mostRecentWaitingForPlayer);
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

  const winner = await gameLoop.playGame();
  endGameInDB(gameLoop.cribbageGame.getGameState().id);

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
