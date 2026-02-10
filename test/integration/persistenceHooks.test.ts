// Set up environment variables BEFORE importing
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_AUTH_ENABLED = 'true';
process.env.SUPABASE_LOBBIES_ENABLED = 'true';

// Mock the entire supabaseService module
jest.mock('../../src/services/supabaseService');

import { Server } from 'socket.io';
import { GameManager } from '../../src/server/GameManager';
import { ConnectionManager } from '../../src/server/ConnectionManager';
import { LobbyManager } from '../../src/server/LobbyManager';
import { DisconnectHandler } from '../../src/server/DisconnectHandler';
import { PersistenceService } from '../../src/server/PersistenceService';
import { HeuristicSimpleAgent } from '../../src/agents/HeuristicSimpleAgent';
import { logger } from '../../src/utils/logger';
import * as supabaseService from '../../src/services/supabaseService';
import type { LobbyPayload } from '../../src/services/supabaseService';
import type { Lobby } from '../../src/server/types';

const mockedSupabaseService = supabaseService as jest.Mocked<
  typeof supabaseService
>;

describe('Persistence Hooks Integration Test', () => {
  let gameManager: GameManager;
  let mockIo: jest.Mocked<Server>;
  let connectionManager: ConnectionManager;
  let lobbyManager: LobbyManager;
  let disconnectHandler: DisconnectHandler;
  let persistenceService: PersistenceService;

  // In-memory maps for GameManager
  const gameLoopsByLobbyId = new Map();
  const mostRecentGameSnapshotByLobbyId = new Map();
  const currentRoundGameEventsByLobbyId = new Map();
  const roundStartSnapshotByLobbyId = new Map();
  const supabaseGameIdByLobbyId = new Map();
  const currentGameBotIdsByLobbyId = new Map();
  const gameIdByLobbyId = new Map();
  const disconnectGraceTimeouts = new Map();

  // Mock functions
  const mockCreateGameRecord = jest.fn();
  const mockPersistGameEvents = jest.fn();
  const mockCompleteGameRecord = jest.fn();
  const mockStartLobby = jest.fn();
  const mockGetLobbyWithPlayers = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear all maps
    gameLoopsByLobbyId.clear();
    mostRecentGameSnapshotByLobbyId.clear();
    currentRoundGameEventsByLobbyId.clear();
    roundStartSnapshotByLobbyId.clear();
    supabaseGameIdByLobbyId.clear();
    currentGameBotIdsByLobbyId.clear();
    gameIdByLobbyId.clear();
    disconnectGraceTimeouts.clear();

    // Setup mock io (minimal stub)
    mockIo = {
      emit: jest.fn(),
      sockets: {
        sockets: {
          get: jest.fn(),
        },
      },
    } as any;

    // Setup mocked supabaseService functions
    mockedSupabaseService.createGameRecord.mockImplementation(
      mockCreateGameRecord
    );
    mockedSupabaseService.persistGameEvents.mockImplementation(
      mockPersistGameEvents
    );
    mockedSupabaseService.completeGameRecord.mockImplementation(
      mockCompleteGameRecord
    );
    mockedSupabaseService.startLobby.mockImplementation(mockStartLobby);
    mockedSupabaseService.getLobbyWithPlayers.mockImplementation(
      mockGetLobbyWithPlayers
    );
    // Mock toUuidOrNull to return null for non-UUID strings (like bot IDs)
    mockedSupabaseService.toUuidOrNull.mockImplementation((id?: string | null) => {
      if (!id) return null;
      // Simple UUID check - if it doesn't match UUID pattern, return null
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(id) ? id : null;
    });
    // Mock getServiceClient to return a minimal stub
    mockedSupabaseService.getServiceClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: {}, error: null }),
            }),
          }),
        }),
      }),
    } as any);

    // Default mock implementations
    mockCreateGameRecord.mockResolvedValue('test-game-id-123');
    mockPersistGameEvents.mockResolvedValue(undefined);
    mockCompleteGameRecord.mockResolvedValue(undefined);

    // Create ConnectionManager
    connectionManager = new ConnectionManager(mockIo, logger);

    // Create LobbyManager with minimal dependencies
    lobbyManager = new LobbyManager({
      io: mockIo,
      connectionManager,
      disconnectGraceTimeouts,
      gameLoopsByLobbyId,
      mostRecentGameSnapshotByLobbyId,
      currentRoundGameEventsByLobbyId,
      roundStartSnapshotByLobbyId,
      supabaseGameIdByLobbyId,
      currentGameBotIdsByLobbyId,
      cleanupBots: jest.fn(),
      clearPlayerDisconnectTimer: jest.fn(),
      lobbyFromSupabase: (payload: any): Lobby => ({
        id: payload.id,
        name: payload.name,
        hostId: payload.host_id,
        maxPlayers: payload.max_players ?? 2,
        currentPlayers: payload.current_players ?? 0,
        players: (payload.players || []).map((p: any) => ({
          playerId: p.player_id,
          displayName: p.display_name || p.player_name,
        })),
        status: payload.status || 'waiting',
        createdAt: Date.now(),
        finishedAt: payload.finished_at ? Date.parse(payload.finished_at) : null,
        disconnectedPlayerIds: [],
        isFixedSize: payload.is_fixed_size ?? false,
      }),
      SUPABASE_LOBBIES_ENABLED: true,
    });

    // Create DisconnectHandler
    disconnectHandler = new DisconnectHandler({
      io: mockIo,
      lobbyManager,
      connectionManager,
      disconnectGraceTimeouts,
      gameLoopsByLobbyId,
      mostRecentGameSnapshotByLobbyId,
      currentRoundGameEventsByLobbyId,
      roundStartSnapshotByLobbyId,
      supabaseGameIdByLobbyId,
      gameIdByLobbyId,
      currentGameBotIdsByLobbyId,
      cleanupBots: jest.fn(),
    });

    // Create PersistenceService
    persistenceService = new PersistenceService(logger);

    // Create GameManager
    gameManager = new GameManager({
      io: mockIo,
      connectionManager,
      lobbyManager,
      disconnectHandler,
      persistenceService,
      gameLoopsByLobbyId,
      mostRecentGameSnapshotByLobbyId,
      currentRoundGameEventsByLobbyId,
      roundStartSnapshotByLobbyId,
      supabaseGameIdByLobbyId,
      currentGameBotIdsByLobbyId,
      gameIdByLobbyId,
      cleanupBots: jest.fn(),
      emitConnectedPlayers: jest.fn(),
    });
  });

  afterEach(() => {
    // Stop LobbyManager cleanup interval
    lobbyManager.stop();
  });

  it('should invoke persistence hooks when a full game completes', async () => {
    const lobbyId = 'test-lobby-123';
    const hostId = 'host-player-1';

    // Create 2 bot agents
    const bot1 = new HeuristicSimpleAgent();
    bot1.playerId = 'bot-1';
    const bot2 = new HeuristicSimpleAgent();
    bot2.playerId = 'bot-2';

    // Register bots in ConnectionManager
    connectionManager.setPlayer('bot-1', {
      id: 'bot-1',
      name: 'Bot 1',
      agent: bot1,
    });
    connectionManager.setPlayer('bot-2', {
      id: 'bot-2',
      name: 'Bot 2',
      agent: bot2,
    });

    // Mock startLobby to return a lobby payload with 0 players (will trigger bot creation)
    const mockLobbyPayload: LobbyPayload = {
      id: lobbyId,
      status: 'waiting',
      current_players: 0,
      max_players: 2,
      host_id: hostId,
      name: 'Test Lobby',
      is_fixed_size: false,
      visibility: 'public',
      settings: null,
      invite_code: null,
      created_at: new Date().toISOString(),
      started_at: null,
      players: [],
    };
    mockStartLobby.mockResolvedValue(mockLobbyPayload);
    mockGetLobbyWithPlayers.mockResolvedValue(mockLobbyPayload);

    // Cache the lobby in LobbyManager before starting
    lobbyManager.cacheLobbyFromPayload(mockLobbyPayload);

    // Start the game
    const startResult = await gameManager.startLobbyGameForHost(lobbyId, hostId);

    expect(startResult).toBeDefined();
    expect(startResult.lobby).toBeDefined();
    expect(startResult.gameId).toBeDefined();

    // Wait for the game to complete (startGame is called asynchronously)
    // We need to wait for the game loop to finish
    const maxWaitTime = 60000; // 60 seconds timeout (should be enough with HeuristicSimpleAgent)
    const startTime = Date.now();
    let gameCompleted = false;
    while (Date.now() - startTime < maxWaitTime) {
      // Check if game loop still exists (it's cleared when game ends)
      if (!gameLoopsByLobbyId.has(lobbyId)) {
        gameCompleted = true;
        break;
      }
      // Small delay to avoid busy waiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!gameCompleted) {
      throw new Error(
        `Game did not complete within ${maxWaitTime}ms. Game loop still exists.`
      );
    }

    // Verify createGameRecord was called
    expect(mockCreateGameRecord).toHaveBeenCalledTimes(1);
    const createCall = mockCreateGameRecord.mock.calls[0][0];
    expect(createCall.lobbyId).toBe(lobbyId);
    expect(createCall.players).toBeInstanceOf(Array);
    expect(createCall.players.length).toBe(2);
    createCall.players.forEach((player: any) => {
      expect(player).toHaveProperty('playerId');
      expect(player).toHaveProperty('playerName');
      expect(typeof player.playerName).toBe('string');
    });
    expect(createCall.initialState).toBeDefined();
    expect(createCall.startedAt).toBeInstanceOf(Date);

    // Verify persistGameEvents was called at least once
    // (it's called during rounds and at game end)
    expect(mockPersistGameEvents.mock.calls.length).toBeGreaterThan(0);
    const persistCalls = mockPersistGameEvents.mock.calls;
    persistCalls.forEach(call => {
      expect(call[0]).toMatchObject({
        gameId: 'test-game-id-123',
        events: expect.any(Array),
      });
      expect(call[0].events.length).toBeGreaterThan(0);
    });

    // Verify completeGameRecord was called
    expect(mockCompleteGameRecord).toHaveBeenCalledTimes(1);
    const completeCall = mockCompleteGameRecord.mock.calls[0][0];
    expect(completeCall.gameId).toBe('test-game-id-123');
    expect(completeCall.winnerId).toBeDefined();
    expect(completeCall.finalState).toBeDefined();
    expect(completeCall.finalScores).toBeInstanceOf(Array);
    expect(completeCall.finalScores.length).toBeGreaterThan(0);
    completeCall.finalScores.forEach((score: any) => {
      expect(score).toHaveProperty('playerId');
      expect(score).toHaveProperty('playerName');
      expect(score).toHaveProperty('score');
      expect(score).toHaveProperty('isWinner');
      expect(typeof score.playerName).toBe('string');
      expect(typeof score.score).toBe('number');
      expect(typeof score.isWinner).toBe('boolean');
    });
    expect(completeCall.roundCount).toBeGreaterThan(0);
    expect(completeCall.endedAt).toBeInstanceOf(Date);

    // Note: The game ID is cleared from the map after game completion (expected behavior)
  }, 90000); // 90 second timeout (should be enough with HeuristicSimpleAgent)
});
