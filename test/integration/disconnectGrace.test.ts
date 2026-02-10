// Speed up grace period logic so tests can use real timers.
jest.mock('../../src/server/types', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const actual = jest.requireActual('../../src/server/types');
  return {
    ...actual,
    PLAYER_DISCONNECT_GRACE_MS: 50,
  };
});

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

// Avoid loading native sharp dependency in tests.
jest.mock('../../src/routes/avatarRoutes', () => ({
  registerAvatarRoutes: jest.fn(),
}));

jest.mock('../../src/services/supabaseService');

import { PLAYER_DISCONNECT_GRACE_MS } from '../../src/server/types';
import * as supabaseService from '../../src/services/supabaseService';
import type { LobbyPayload } from '../../src/services/supabaseService';
import {
  cleanup,
  createTestClient,
  createTestProfile,
  emitWithAck,
  loginClient,
  startTestServer,
  waitForSocketConnect,
  waitForSocketEvent,
} from './utils';

const mockedSupabaseService = supabaseService as jest.Mocked<
  typeof supabaseService
>;

const flush = async (ms: number = 0) => {
  if (ms > 0) {
    await new Promise((r) => setTimeout(r, ms));
  }
  await new Promise((r) => setImmediate(r));
};

// In-memory lobby store for mocks (shared shape with Supabase LobbyPayload)
const inMemoryLobbies = new Map<string, LobbyPayload>();
const profiles = new Map<string, { displayName: string }>();

describe('Disconnect grace period (socket integration)', () => {
  jest.setTimeout(20000);

  const userA = { userId: 'user-a', token: 'token-a' };
  const userB = { userId: 'user-b', token: 'token-b' };

  let server: Awaited<ReturnType<typeof startTestServer>> | null = null;
  const clients: Array<ReturnType<typeof createTestClient>> = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    inMemoryLobbies.clear();
    profiles.clear();

    profiles.set(userA.userId, { displayName: 'Player A' });
    profiles.set(userB.userId, { displayName: 'Player B' });

    mockedSupabaseService.verifyAccessToken.mockImplementation(async (token) => {
      if (token === userA.token) return { userId: userA.userId };
      if (token === userB.token) return { userId: userB.userId };
      throw new Error('Invalid token');
    });

    mockedSupabaseService.getProfile.mockImplementation(async (userId) => {
      const displayName = profiles.get(userId)?.displayName;
      if (!displayName) throw new Error('Profile not found');
      return createTestProfile(userId, { display_name: displayName });
    });

    mockedSupabaseService.getPlayerActiveLobbyId.mockImplementation(
      async (playerId: string, excludeLobbyId?: string) => {
        for (const [lid, lobby] of inMemoryLobbies.entries()) {
          if (excludeLobbyId && lid === excludeLobbyId) continue;
          if (lobby.status === 'finished') continue;
          if (lobby.players.some((p) => p.playerId === playerId)) return lid;
        }
        return null;
      },
    );

    mockedSupabaseService.createLobby.mockImplementation(async (data: any) => {
      const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const payload: LobbyPayload = {
        id: lobbyId,
        host_id: data.hostId,
        name: data.name ?? `Lobby ${lobbyId}`,
        max_players: data.maxPlayers,
        current_players: 1,
        status: 'waiting',
        is_fixed_size: data.isFixedSize ?? true,
        visibility: data.visibility ?? 'public',
        invite_code: null,
        created_at: new Date().toISOString(),
        started_at: null,
        settings: null,
        players: [
          {
            playerId: data.hostId,
            displayName: profiles.get(data.hostId)?.displayName ?? 'Host',
          },
        ],
      };
      inMemoryLobbies.set(lobbyId, payload);
      return payload;
    });

    mockedSupabaseService.joinLobby.mockImplementation(
      async ({ lobbyId, playerId }: { lobbyId: string; playerId: string }) => {
        const lobby = inMemoryLobbies.get(lobbyId);
        if (!lobby) throw new Error('Lobby not found');
        if (lobby.players.some((p) => p.playerId === playerId)) return lobby;
        lobby.current_players += 1;
        lobby.players.push({
          playerId,
          displayName: profiles.get(playerId)?.displayName ?? 'Player',
        });
        inMemoryLobbies.set(lobbyId, lobby);
        return lobby;
      },
    );

    mockedSupabaseService.startLobby.mockImplementation(
      async ({ lobbyId }: { lobbyId: string; hostId: string }) => {
        const lobby = inMemoryLobbies.get(lobbyId);
        if (!lobby) throw new Error('Lobby not found');
        lobby.status = 'in_progress';
        lobby.started_at = new Date().toISOString();
        inMemoryLobbies.set(lobbyId, lobby);
        return lobby;
      },
    );

    mockedSupabaseService.getLobbyWithPlayers.mockImplementation(
      async (lobbyId: string) => inMemoryLobbies.get(lobbyId) ?? null,
    );

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

    mockedSupabaseService.createGameRecord.mockResolvedValue('test-game-id');
    mockedSupabaseService.persistGameEvents.mockResolvedValue(undefined);
    mockedSupabaseService.completeGameRecord.mockResolvedValue(undefined);
    mockedSupabaseService.toUuidOrNull.mockImplementation((id?: string | null) =>
      id ?? null,
    );

    server = await startTestServer({ supabaseLobbiesEnabled: true });
  });

  afterEach(async () => {
    await cleanup(server, clients);
    server = null;
    clients.length = 0;
  });

  it('cancels game and removes player after grace expiry', async () => {
    if (!server) throw new Error('Test server not started');

    const clientA = createTestClient(server.url, {
      userId: userA.userId,
      accessToken: userA.token,
    });
    const clientB = createTestClient(server.url, {
      userId: userB.userId,
      accessToken: userB.token,
    });
    clients.push(clientA, clientB);

    await waitForSocketConnect(clientA);
    await waitForSocketConnect(clientB);

    await loginClient(clientA, { accessToken: userA.token });
    await loginClient(clientB, { accessToken: userB.token });

    // Create + join lobby.
    const created = await emitWithAck<{ lobby: { id: string } }>(clientA, 'createLobby', {
      playerCount: 2,
    });
    const lobbyId = created.lobby.id;

    await emitWithAck(clientB, 'joinLobby', { lobbyId });
    await flush(20);

    // Start game. Set up listeners BEFORE start so we don't miss gameStartedFromLobby
    // (server emits it before the ack callback).
    const events: Array<{ event: string; data: any }> = [];
    clientA.socket.on('playerDisconnectedFromLobby', (data) =>
      events.push({ event: 'playerDisconnectedFromLobby', data }),
    );
    clientA.socket.on('gameCancelledDueToDisconnect', (data) =>
      events.push({ event: 'gameCancelledDueToDisconnect', data }),
    );
    clientA.socket.on('lobbyUpdated', (data) =>
      events.push({ event: 'lobbyUpdated', data }),
    );

    const gameStartedPromise = waitForSocketEvent(clientA, 'gameStartedFromLobby', 10000);
    await Promise.all([
      emitWithAck(clientA, 'startLobbyGame', { lobbyId }),
      gameStartedPromise,
    ]);

    // Disconnect non-host during active game.
    clientB.disconnect();
    await flush(20);

    const disconnected = events.find((e) => e.event === 'playerDisconnectedFromLobby');
    expect(disconnected?.data).toMatchObject({
      lobbyId,
      playerId: userB.userId,
      gracePeriodMs: PLAYER_DISCONNECT_GRACE_MS,
    });

    // Wait out grace period (shortened via mock).
    await flush(PLAYER_DISCONNECT_GRACE_MS + 30);

    const cancelled = events.find((e) => e.event === 'gameCancelledDueToDisconnect');
    expect(cancelled?.data).toMatchObject({
      lobbyId,
      playerId: userB.userId,
      timeoutMs: PLAYER_DISCONNECT_GRACE_MS,
    });

    const lastLobbyUpdated = events.filter((e) => e.event === 'lobbyUpdated').slice(-1)[0];
    expect(lastLobbyUpdated?.data.status).toBe('waiting');
    expect(lastLobbyUpdated?.data.players.some((p: any) => p.playerId === userB.userId)).toBe(
      false,
    );
  });

  it('does not cancel if player reconnects within grace period', async () => {
    if (!server) throw new Error('Test server not started');

    const clientA = createTestClient(server.url, {
      userId: userA.userId,
      accessToken: userA.token,
    });
    const clientB = createTestClient(server.url, {
      userId: userB.userId,
      accessToken: userB.token,
    });
    clients.push(clientA, clientB);

    await waitForSocketConnect(clientA);
    await waitForSocketConnect(clientB);

    await loginClient(clientA, { accessToken: userA.token });
    await loginClient(clientB, { accessToken: userB.token });

    const created = await emitWithAck<{ lobby: { id: string } }>(clientA, 'createLobby', {
      playerCount: 2,
    });
    const lobbyId = created.lobby.id;
    await emitWithAck(clientB, 'joinLobby', { lobbyId });
    await flush(20);

    const events: Array<{ event: string; data: any }> = [];
    clientA.socket.on('playerReconnectedToLobby', (data) =>
      events.push({ event: 'playerReconnectedToLobby', data }),
    );
    clientA.socket.on('gameCancelledDueToDisconnect', (data) =>
      events.push({ event: 'gameCancelledDueToDisconnect', data }),
    );

    const gameStartedPromise = waitForSocketEvent(clientA, 'gameStartedFromLobby', 10000);
    await Promise.all([
      emitWithAck(clientA, 'startLobbyGame', { lobbyId }),
      gameStartedPromise,
    ]);

    clientB.disconnect();
    await flush(10);

    // Reconnect and re-login quickly.
    const clientB2 = createTestClient(server.url, {
      userId: userB.userId,
      accessToken: userB.token,
    });
    clients.push(clientB2);
    await waitForSocketConnect(clientB2);
    await loginClient(clientB2, { accessToken: userB.token });

    await flush(PLAYER_DISCONNECT_GRACE_MS + 30);

    expect(events.find((e) => e.event === 'gameCancelledDueToDisconnect')).toBeUndefined();
  });
});
