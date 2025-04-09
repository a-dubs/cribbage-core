/*
  This version of server.ts supports multiple concurrent lobbies while preserving all original logic and functionality,
  including game state emissions, play again votes, file persistence, bot auto-fill, and agent reconnections.
*/

import http from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { GameLoop } from './gameplay/GameLoop';
import { WebSocketAgent } from './agents/WebSocketAgent';
import { SimpleAgent } from './agents/SimpleAgent';
import {
  ActionType,
  EmittedWaitingForPlayer,
  GameAgent,
  GameEvent,
  GameInfo,
  GameState,
  PlayerIdAndName,
} from './types';

dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const WEBSOCKET_AUTH_TOKEN = process.env.WEBSOCKET_AUTH_TOKEN;
const JSON_DB_DIR = process.env.JSON_DB_DIR || path.join(__dirname, 'json_db');
const GAME_EVENTS_FILE = path.join(JSON_DB_DIR, 'gameEvents.json');
const GAME_INFO_FILE = path.join(JSON_DB_DIR, 'gameInfo.json');

if (!fs.existsSync(JSON_DB_DIR)) fs.mkdirSync(JSON_DB_DIR);
if (!WEBSOCKET_AUTH_TOKEN) throw new Error('WEBSOCKET_AUTH_TOKEN is not set');

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
  socket: Socket;
}

interface Lobby {
  id: string;
  players: Map<string, PlayerInfo>;
  playAgainVotes: Set<string>;
  gameLoop: GameLoop | null;
  currentRoundEvents: GameEvent[];
  mostRecentGameState: GameState | null;
  mostRecentGameEvent: GameEvent | null;
  mostRecentWaiting: EmittedWaitingForPlayer | null;
}

const lobbies: Map<string, Lobby> = new Map();
const playerToLobby: Map<string, string> = new Map();

const getPlayerIdFromSocket = (socket: Socket): string | undefined => {
  for (const [playerId, lobbyId] of playerToLobby.entries()) {
    const lobby = lobbies.get(lobbyId);
    if (lobby && lobby.players.has(playerId)) {
      const playerInfo = lobby.players.get(playerId);
      if (playerInfo && playerInfo.socket.id === socket.id) {
        return playerId;
      }
    }
  }
  return undefined;
};

io.on('connection', socket => {
  const token = socket.handshake.auth.token;
  if (token !== WEBSOCKET_AUTH_TOKEN) {
    console.log('Authentication failed for socket:', socket.id);
    socket.disconnect();
    return;
  }

  console.log(`User connected: ${socket.id}`);

  socket.on('joinLobby', ({ playerId, lobbyId }) => {
    let lobby = lobbies.get(lobbyId);
    if (!lobby) {
      lobby = {
        id: lobbyId,
        players: new Map(),
        playAgainVotes: new Set(),
        gameLoop: null,
        currentRoundEvents: [],
        mostRecentGameEvent: null,
        mostRecentGameState: null,
        mostRecentWaiting: null,
      };
      lobbies.set(lobbyId, lobby);
    }

    let agent: WebSocketAgent;
    const oldInfo = lobby.players.get(playerId);
    if (oldInfo && oldInfo.agent instanceof WebSocketAgent) {
      oldInfo.socket.disconnect(true);
      agent = oldInfo.agent;
      agent.updateSocket(socket);
    } else {
      agent = new WebSocketAgent(socket, playerId);
    }

    const playerInfo: PlayerInfo = {
      id: playerId,
      name: playerId,
      agent,
      socket,
    };
    lobby.players.set(playerId, playerInfo);
    playerToLobby.set(playerId, lobbyId);

    emitLobbyPlayers(lobby);
    socket.emit('loggedIn', 'You are logged in!');

    sendMostRecentGameData(socket, lobby);
  });

  socket.on('checkReconnect', playerId => {
    const lobbyId = playerToLobby.get(playerId);
    if (lobbyId) {
      socket.emit('reconnectInfo', { lobbyId });
    }
  });

  socket.on('leaveLobby', () => {
    const playerId = getPlayerIdFromSocket(socket);
    if (!playerId) {
      console.error(`Player ID not found for socket ${socket.id}`);
      return;
    }
    const lobbyId = playerToLobby.get(playerId);
    if (!lobbyId) {
      console.error(`Lobby ID not found for player ${playerId}`);
      return;
    }
    const lobby = lobbyId ? lobbies.get(lobbyId) : null;
    if (!lobby) {
      console.error(`Lobby not found for ID ${lobbyId}`);
      return;
    }

    lobby.players.delete(playerId);
    playerToLobby.delete(playerId);
    emitLobbyPlayers(lobby);

    if (lobby.players.size === 0) {
      lobbies.delete(lobbyId);
      console.log(`Lobby ${lobbyId} closed as all players left.`);
    }
  });

  socket.on('startGame', () => {
    const playerId = getPlayerIdFromSocket(socket);
    if (!playerId) {
      console.error(`Player ID not found for socket ${socket.id}`);
      return;
    }
    const lobbyId = playerToLobby.get(playerId);
    if (!lobbyId) {
      console.error(`Lobby ID not found for player ${playerId}`);
      return;
    }
    const lobby = lobbyId ? lobbies.get(lobbyId) : null;
    if (!lobby) {
      console.error(`Lobby not found for ID ${lobbyId}`);
      return;
    }

    // Add a bot if only 1 player
    if (lobby.players.size === 1) {
      const botName = 'Simple Optimal Bot';
      const botAgent = new SimpleAgent();
      const botId = botAgent.playerId;
      const botPlayerInfo: PlayerInfo = {
        id: botId,
        name: botName,
        agent: botAgent,
        socket: socket, // bot doesn't use socket
      };
      lobby.players.set(botId, botPlayerInfo);
    }

    if (lobby.players.size < 2) return;

    const playersList: PlayerIdAndName[] = [];
    const agents: Map<string, GameAgent> = new Map();

    lobby.players.forEach(p => {
      playersList.push({ id: p.id, name: p.name });
      agents.set(p.id, p.agent);
    });

    const gameLoop = new GameLoop(playersList);
    lobby.gameLoop = gameLoop;

    agents.forEach((agent, id) => gameLoop.addAgent(id, agent));

    gameLoop.on('gameStateChange', gs => {
      lobby.mostRecentGameState = gs;
      io.to(lobbyId).emit('gameStateChange', gs);
    });
    gameLoop.on('gameEvent', (ev: GameEvent) => {
      lobby.mostRecentGameEvent = ev;
      if (ev.actionType === ActionType.START_ROUND)
        lobby.currentRoundEvents = [];
      lobby.currentRoundEvents.push(ev);
      saveGameEvent(ev);
      io.to(lobbyId).emit('gameEvent', ev);
      io.to(lobbyId).emit('currentRoundGameEvents', lobby.currentRoundEvents);
    });

    gameLoop.on('waitingForPlayer', w => {
      lobby.mostRecentWaiting = w;
      io.to(lobbyId).emit('waitingForPlayer', w);
    });

    const gameId = gameLoop.cribbageGame.getGameState().id;
    startGameInDB(gameId, playersList, lobbyId);

    io.to(lobbyId).emit('gameStart', { gameId, players: playersList });

    void gameLoop.playGame().then(winner => {
      endGameInDB(gameId, winner);
      lobby.playAgainVotes.clear();
      lobby.players.forEach(p => {
        if (p.agent instanceof SimpleAgent) lobby.playAgainVotes.add(p.id);
      });
      io.to(lobbyId).emit('playAgainVotes', Array.from(lobby.playAgainVotes));
      io.to(lobbyId).emit('gameOver', winner);
    });
  });

  socket.on('playAgain', () => {
    const playerId = getPlayerIdFromSocket(socket);
    if (!playerId) {
      console.error(`Player ID not found for socket ${socket.id}`);
      return;
    }
    const lobbyId = playerToLobby.get(playerId);
    if (!lobbyId) {
      console.error(`Lobby ID not found for player ${playerId}`);
      return;
    }
    const lobby = lobbyId ? lobbies.get(lobbyId) : null;
    if (!lobby) {
      console.error(`Lobby not found for ID ${lobbyId}`);
      return;
    }

    lobby.playAgainVotes.add(playerId);
    io.to(lobbyId).emit('playAgainVotes', Array.from(lobby.playAgainVotes));

    if (lobby.playAgainVotes.size === lobby.players.size) {
      lobby.playAgainVotes.clear();
      console.log(`All players in lobby ${lobbyId} voted to play again.`);
      io.to(lobbyId).emit('startGame');
    }
  });

  socket.on('heartbeat', () => {
    console.log('Received heartbeat from client');
  });
});

function emitLobbyPlayers(lobby: Lobby) {
  const arr: PlayerIdAndName[] = Array.from(lobby.players.values()).map(p => ({
    id: p.id,
    name: p.name,
  }));
  io.to(lobby.id).emit('connectedPlayers', arr);
}

function sendMostRecentGameData(socket: Socket, lobby: Lobby): void {
  if (lobby.mostRecentGameState)
    socket.emit('gameStateChange', lobby.mostRecentGameState);
  if (lobby.mostRecentGameEvent)
    socket.emit('gameEvent', lobby.mostRecentGameEvent);
  if (lobby.mostRecentWaiting)
    socket.emit('waitingForPlayer', lobby.mostRecentWaiting);
  socket.emit('currentRoundGameEvents', lobby.currentRoundEvents);
  socket.emit('playAgainVotes', Array.from(lobby.playAgainVotes));
}

function saveGameEvent(ev: GameEvent) {
  const events: GameEvent[] = fs.existsSync(GAME_EVENTS_FILE)
    ? JSON.parse(fs.readFileSync(GAME_EVENTS_FILE, 'utf-8'))
    : [];
  events.push(ev);
  fs.writeFileSync(GAME_EVENTS_FILE, JSON.stringify(events, null, 2));
}

function startGameInDB(
  gameId: string,
  players: PlayerIdAndName[],
  lobbyId: string
): void {
  try {
    const games: GameInfo[] = fs.existsSync(GAME_INFO_FILE)
      ? JSON.parse(fs.readFileSync(GAME_INFO_FILE, 'utf-8'))
      : [];
    if (games.some(g => g.id === gameId)) throw new Error('Game ID exists');
    games.push({
      id: gameId,
      playerIds: players.map(p => p.id),
      startTime: new Date(),
      endTime: null,
      lobbyId,
      gameWinner: null,
    });
    fs.writeFileSync(GAME_INFO_FILE, JSON.stringify(games, null, 2));
  } catch (err) {
    console.error('Error saving game info:', err);
  }
}

function endGameInDB(gameId: string, winnerId: string): void {
  try {
    const games: GameInfo[] = JSON.parse(
      fs.readFileSync(GAME_INFO_FILE, 'utf-8')
    );
    const idx = games.findIndex(g => g.id === gameId);
    if (idx >= 0) {
      games[idx].endTime = new Date();
      games[idx].gameWinner = winnerId;
    } else {
      throw new Error('Game in DB not found with ID: ' + gameId);
    }
    fs.writeFileSync(GAME_INFO_FILE, JSON.stringify(games, null, 2));
  } catch (err) {
    console.error('Error ending game in DB:', err);
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
