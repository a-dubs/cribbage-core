import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { GameLoop } from './gameplay/GameLoop';
import { GameAgent, GameState, PlayerIdAndName } from './types';
import { WebSocketAgent } from './agents/WebSocketAgent';

const app = express();
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

let waitingPlayer: PlayerInfo | null = null;
let gameLoop: GameLoop | null = null;

io.on('connection', socket => {
  console.log('A user connected:', socket.id);

  socket.on('login', (data: LoginData) => {
    handleLogin(socket, data).catch(error => {
      console.error('Error handling login:', error);
    });
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
  });
});

async function handleLogin(socket: Socket, data: LoginData): Promise<void> {
  const { username, name } = data;
  const agent = new WebSocketAgent(socket, username);
  const playerInfo: PlayerInfo = { id: username, name, agent };

  if (!waitingPlayer) {
    // No waiting player, set this player as the waiting player
    waitingPlayer = playerInfo;
    socket.emit('waiting', 'Waiting for another player to join...');
  } else {
    // Pair the waiting player with this player and start the game
    const playersIdAndName: PlayerIdAndName[] = [];
    playersIdAndName.push({ id: waitingPlayer.id, name: waitingPlayer.name });
    playersIdAndName.push({ id: username, name });

    gameLoop = new GameLoop(playersIdAndName);
    gameLoop.addAgent(waitingPlayer.id, waitingPlayer.agent);
    gameLoop.addAgent(username, agent);
    waitingPlayer = null;

    // Emit game state changes
    gameLoop.on('gameStateChange', (newGameState: GameState) => {
      io.emit('gameStateChange', newGameState);
    });

    // Start the game
    await startGame();
  }
}

async function startGame(): Promise<void> {
  if (!gameLoop) return;

  const winner = await gameLoop.playGame();
  io.emit('gameOver', `Player ${winner} wins!`);
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
