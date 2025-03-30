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
} from './types';
import { WebSocketAgent } from './agents/WebSocketAgent';
import { SimpleAgent } from './agents/SimpleAgent';
import dotenv from 'dotenv';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const WEBSOCKET_AUTH_TOKEN = process.env.WEBSOCKET_AUTH_TOKEN;

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

const connectedPlayers: Map<string, PlayerInfo> = new Map();
const playerIdToSocketId: Map<string, string> = new Map();
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
  // If only one player is connected, add a bot
  if (connectedPlayers.size === 1) {
    console.log('Adding a bot to start the game.');
    const botId = 'simple-bot-v1.0';
    const botName = 'Simple Bot';
    const botAgent = new SimpleAgent(botId);
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
        'Game loop not initialized. Cannot add agent and start game.'
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
    io.emit('currentRoundGameEvents', currentRoundGameEvents);
  });
  gameLoop.on('waitingForPlayer', (waitingData: EmittedWaitingForPlayer) => {
    io.emit('waitingForPlayer', waitingData);
    mostRecentWaitingForPlayer = waitingData;
  });
  // send the connected players to the clients
  emitConnectedPlayers();

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
}

async function startGame(): Promise<void> {
  if (!gameLoop) return;

  const winner = await gameLoop.playGame();
  io.emit('gameOver', winner);
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
