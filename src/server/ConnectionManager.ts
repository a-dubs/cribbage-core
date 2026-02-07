import { Server } from 'socket.io';
import { PlayerIdAndName } from '../types';
import { WebSocketAgent } from '../agents/WebSocketAgent';
import { PlayerInfo } from './types';
import { logger } from '../utils/logger';

/**
 * Manages player/socket connection tracking and related operations.
 * Handles the three connection maps and provides helpers for connection management.
 */
export class ConnectionManager {
  private readonly connectedPlayers: Map<string, PlayerInfo> = new Map();
  private readonly playerIdToSocketId: Map<string, string> = new Map();
  private readonly socketIdToPlayerId: Map<string, string> = new Map();

  constructor(
    private readonly io: Server,
    private readonly loggerInstance = logger
  ) {}

  // Map accessors
  getConnectedPlayers(): Map<string, PlayerInfo> {
    return this.connectedPlayers;
  }

  getPlayerIdToSocketId(): Map<string, string> {
    return this.playerIdToSocketId;
  }

  getSocketIdToPlayerId(): Map<string, string> {
    return this.socketIdToPlayerId;
  }

  // Direct map operations
  hasPlayer(playerId: string): boolean {
    return this.connectedPlayers.has(playerId);
  }

  getPlayer(playerId: string): PlayerInfo | undefined {
    return this.connectedPlayers.get(playerId);
  }

  setPlayer(playerId: string, playerInfo: PlayerInfo): void {
    this.connectedPlayers.set(playerId, playerInfo);
  }

  deletePlayer(playerId: string): void {
    this.connectedPlayers.delete(playerId);
  }

  getSocketId(playerId: string): string | undefined {
    return this.playerIdToSocketId.get(playerId);
  }

  setSocketId(playerId: string, socketId: string): void {
    this.playerIdToSocketId.set(playerId, socketId);
  }

  deleteSocketId(playerId: string): void {
    this.playerIdToSocketId.delete(playerId);
  }

  getPlayerId(socketId: string): string | undefined {
    return this.socketIdToPlayerId.get(socketId);
  }

  setPlayerId(socketId: string, playerId: string): void {
    this.socketIdToPlayerId.set(socketId, playerId);
  }

  deletePlayerId(socketId: string): void {
    this.socketIdToPlayerId.delete(socketId);
  }

  /**
   * Clear all connection maps (for test reset scenarios).
   */
  clearAll(): void {
    this.connectedPlayers.clear();
    this.playerIdToSocketId.clear();
    this.socketIdToPlayerId.clear();
  }

  /**
   * Generate a unique player ID from username, handling conflicts.
   * If username is already taken, appends socket ID to make it unique.
   */
  getUniquePlayerId(username: string, socketId: string): string {
    // First, try using the username directly
    if (!this.connectedPlayers.has(username)) {
      return username;
    }

    // If username is taken, append socket ID to make it unique
    // This allows multiple users with the same username
    const uniqueId = `${username}_${socketId}`;
    return uniqueId;
  }

  /**
   * Emit the current connected players to all clients.
   * Note: Only includes human players. Bots are included per-lobby in getConnectedPlayers handler.
   */
  emitConnectedPlayers(
    currentGameBotIdsByLobbyId: Map<string, string[]>,
    gameLoopsByLobbyId: Map<string, unknown>
  ): void {
    // Clean up inactive bots before emitting
    this.cleanupInactiveBots(currentGameBotIdsByLobbyId, gameLoopsByLobbyId);

    const playersIdAndName: PlayerIdAndName[] = [];
    this.connectedPlayers.forEach(playerInfo => {
      // Only include human players in global broadcast
      // Bots are included per-lobby when players request connectedPlayers
      const isBot = !(playerInfo.agent instanceof WebSocketAgent);
      if (!isBot) {
        playersIdAndName.push({ id: playerInfo.id, name: playerInfo.name });
      }
    });
    this.loggerInstance.info(
      'Emitting connected players to all clients:',
      playersIdAndName
    );
    this.io.emit('connectedPlayers', playersIdAndName);
  }

  /**
   * Clean up bots from connectedPlayers and related maps for a specific lobby.
   */
  cleanupBots(
    lobbyId: string,
    currentGameBotIdsByLobbyId: Map<string, string[]>
  ): void {
    const botIds = currentGameBotIdsByLobbyId.get(lobbyId);
    if (!botIds || botIds.length === 0) {
      return;
    }
    this.loggerInstance.info(
      `Cleaning up ${botIds.length} bots for lobby ${lobbyId}`
    );
    botIds.forEach(botId => {
      this.connectedPlayers.delete(botId);
      this.playerIdToSocketId.delete(botId);
      this.socketIdToPlayerId.delete(botId);
      this.loggerInstance.info(`Removed bot: ${botId}`);
    });
    currentGameBotIdsByLobbyId.delete(lobbyId);
    // Note: emitConnectedPlayers is called separately by caller if needed
  }

  /**
   * Clean up bots that are not part of any active game.
   */
  cleanupInactiveBots(
    currentGameBotIdsByLobbyId: Map<string, string[]>,
    gameLoopsByLobbyId: Map<string, unknown>
  ): void {
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
    this.connectedPlayers.forEach((playerInfo, playerId) => {
      const isBot = !(playerInfo.agent instanceof WebSocketAgent);
      if (isBot && !activeBotIds.has(playerId)) {
        botsToRemove.push(playerId);
      }
    });

    if (botsToRemove.length > 0) {
      this.loggerInstance.info(
        `Cleaning up ${botsToRemove.length} inactive bots`
      );
      botsToRemove.forEach(botId => {
        this.connectedPlayers.delete(botId);
        this.playerIdToSocketId.delete(botId);
        this.socketIdToPlayerId.delete(botId);
        this.loggerInstance.info(`Removed inactive bot: ${botId}`);
      });
    }
  }
}
