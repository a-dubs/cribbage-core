import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameLoop } from './gameplay/GameLoop';
import {
  EmittedWaitingForPlayer,
  GameAgent,
  GameEvent,
  GameState,
  PlayerIdAndName,
} from './types';
import { WebSocketAgent } from './agents/WebSocketAgent';
import { SimpleAgent } from './agents/SimpleAgent';

const app = express();
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

interface PlayerInfo {
  id: string;
  name: string;
  agent: GameAgent;
}

interface LoginData {
  username: string;
  name: string;
}

// Set up a basic route to show that the server is running
app.get('/', (req, res) => {
  res.send('Socket.IO server is running!');
});

const connectedPlayers: Map<string, PlayerInfo> = new Map();
let gameLoop: GameLoop | null = null;

io.on('connection', socket => {
  console.log('A user connected:', socket.id);

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
    connectedPlayers.forEach((player, id) => {
      if (player.id === socket.id) {
        connectedPlayers.delete(id);
      }
    });
  });
});

function handleLogin(socket: Socket, data: LoginData): void {
  const { username, name } = data;
  const agent = new WebSocketAgent(socket, username);
  const playerInfo: PlayerInfo = { id: username, name, agent };

  // Replace old socket if player reconnects
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
  if (connectedPlayers.keys.length === 1) {
    const botId = 'bot';
    const botName = 'Bot';
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
  });
  gameLoop.on('gameEvent', (gameEvent: GameEvent) => {
    io.emit('gameEvent', gameEvent);
  });
  gameLoop.on('waitingForPlayer', (waitingData: EmittedWaitingForPlayer) => {
    io.emit('waitingForPlayer', waitingData);
  });
  // send the connected players to the clients
  emitConnectedPlayers();

  // Start the game
  await startGame();
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
