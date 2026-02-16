// Set up environment variables BEFORE importing
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

// Mock avatarRoutes to avoid sharp dependency issues in tests
jest.mock('../src/routes/avatarRoutes', () => ({
  registerAvatarRoutes: jest.fn(),
}));

// Mock the entire supabaseService module
jest.mock('../src/services/supabaseService');

import express from 'express';
import request from 'supertest';
import { registerHttpApi } from '../src/httpApi';
import * as supabaseService from '../src/services/supabaseService';

const mockedSupabaseService = supabaseService as jest.Mocked<
  typeof supabaseService
>;

describe('httpApi', () => {
  let app: express.Express;
  let hooks: {
    onLobbyUpdated: jest.Mock;
    onLobbyClosed: jest.Mock;
    onPlayerLeftLobby: jest.Mock;
    onStartLobbyGame: jest.Mock;
  };

  const mockUserId = 'test-user-123';
  const mockProfile = {
    id: mockUserId,
    username: 'testuser',
    display_name: 'Test User',
    avatar_url: null,
    friend_code: 'ABC123',
    created_at: new Date().toISOString(),
  };

  // Helper to create a mock lobby with all required fields
  const createMockLobby = (overrides: Record<string, any> = {}) => ({
    id: 'lobby-123' as string,
    status: 'waiting' as 'waiting' | 'in_progress' | 'finished',
    current_players: 1 as number,
    max_players: 2 as number,
    host_id: mockUserId as string,
    name: 'Test Lobby' as string,
    is_fixed_size: true as boolean,
    visibility: 'public' as 'public' | 'friends_only' | 'private',
    settings: null as null,
    invite_code: null as string | null,
    game_id: null as string | null,
    created_at: new Date().toISOString() as string,
    started_at: null as string | null,
    players: [] as any[],
    ...overrides,
  }) as any;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    hooks = {
      onLobbyUpdated: jest.fn(),
      onLobbyClosed: jest.fn(),
      onPlayerLeftLobby: jest.fn(),
      onStartLobbyGame: jest.fn(),
    };

    // Mock auth verification to return our test user
    mockedSupabaseService.verifyAccessToken.mockResolvedValue({
      userId: mockUserId,
    });
    mockedSupabaseService.getProfile.mockResolvedValue(mockProfile);

    registerHttpApi(app, hooks);
  });

  describe('POST /lobbies/:lobbyId/leave', () => {
    const lobbyId = 'lobby-123';

    it('calls onPlayerLeftLobby hook with correct arguments when leaving', async () => {
      const updatedLobby = createMockLobby({
        id: lobbyId,
        host_id: 'other-player',
      });

      mockedSupabaseService.leaveLobby.mockResolvedValue(updatedLobby);

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/leave`)
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);
      expect(hooks.onPlayerLeftLobby).toHaveBeenCalledWith(mockUserId, lobbyId);
      expect(hooks.onPlayerLeftLobby).toHaveBeenCalledTimes(1);
    });

    it('calls onPlayerLeftLobby before onLobbyUpdated', async () => {
      const callOrder: string[] = [];

      hooks.onPlayerLeftLobby.mockImplementation(() => {
        callOrder.push('onPlayerLeftLobby');
      });
      hooks.onLobbyUpdated.mockImplementation(() => {
        callOrder.push('onLobbyUpdated');
      });

      const updatedLobby = createMockLobby({
        id: lobbyId,
        host_id: 'other-player',
      });

      mockedSupabaseService.leaveLobby.mockResolvedValue(updatedLobby);

      await request(app)
        .post(`/lobbies/${lobbyId}/leave`)
        .set('Authorization', 'Bearer valid-token');

      expect(callOrder).toEqual(['onPlayerLeftLobby', 'onLobbyUpdated']);
    });

    it('calls onLobbyClosed when lobby becomes empty', async () => {
      const emptyLobby = createMockLobby({
        id: lobbyId,
        status: 'finished',
        current_players: 0,
      });

      mockedSupabaseService.leaveLobby.mockResolvedValue(emptyLobby);

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/leave`)
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);
      expect(hooks.onPlayerLeftLobby).toHaveBeenCalledWith(mockUserId, lobbyId);
      expect(hooks.onLobbyClosed).toHaveBeenCalledWith(lobbyId);
      expect(hooks.onLobbyUpdated).not.toHaveBeenCalled();
    });

    it('returns 400 when leave fails', async () => {
      mockedSupabaseService.leaveLobby.mockRejectedValue(
        new Error('Player not in lobby')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/leave`)
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('LOBBY_LEAVE_FAILED');
      expect(hooks.onPlayerLeftLobby).not.toHaveBeenCalled();
    });

    it('returns 401 without authorization header', async () => {
      const response = await request(app).post(`/lobbies/${lobbyId}/leave`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('NOT_AUTHORIZED');
    });
  });

  describe('POST /lobbies', () => {
    it('creates a lobby successfully', async () => {
      const newLobby = createMockLobby({
        id: 'new-lobby-123',
        name: 'My Game',
        players: [
          {
            playerId: mockUserId,
            username: 'testuser',
            displayName: 'Test User',
            avatarUrl: null,
            isHost: true,
          },
        ],
      });

      mockedSupabaseService.createLobby.mockResolvedValue(newLobby);

      const response = await request(app)
        .post('/lobbies')
        .set('Authorization', 'Bearer valid-token')
        .send({ maxPlayers: 2, name: 'My Game' });

      expect(response.status).toBe(201);
      expect(response.body.lobby.id).toBe('new-lobby-123');
      expect(hooks.onLobbyUpdated).toHaveBeenCalledWith(newLobby);
    });

    it('returns 400 when maxPlayers is invalid', async () => {
      const response = await request(app)
        .post('/lobbies')
        .set('Authorization', 'Bearer valid-token')
        .send({ maxPlayers: 5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 409 when already in a lobby', async () => {
      mockedSupabaseService.createLobby.mockRejectedValue(
        new Error('ALREADY_IN_LOBBY')
      );

      const response = await request(app)
        .post('/lobbies')
        .set('Authorization', 'Bearer valid-token')
        .send({ maxPlayers: 2 });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('ALREADY_IN_LOBBY');
    });
  });

  describe('POST /lobbies/:lobbyId/join', () => {
    const lobbyId = 'lobby-to-join';

    it('joins a lobby successfully', async () => {
      const joinedLobby = createMockLobby({
        id: lobbyId,
        current_players: 2,
        host_id: 'host-player',
        name: 'Joinable Lobby',
      });

      mockedSupabaseService.joinLobby.mockResolvedValue(joinedLobby);

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/join`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.lobby.id).toBe(lobbyId);
      expect(hooks.onLobbyUpdated).toHaveBeenCalledWith(joinedLobby);
    });

    it('returns 409 when already in a different lobby', async () => {
      mockedSupabaseService.joinLobby.mockRejectedValue(
        new Error('ALREADY_IN_LOBBY')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/join`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('ALREADY_IN_LOBBY');
    });

    it('returns 409 when lobby is full', async () => {
      mockedSupabaseService.joinLobby.mockRejectedValue(
        new Error('LOBBY_FULL')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/join`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('LOBBY_FULL');
    });

    it('returns 404 when lobby not found', async () => {
      mockedSupabaseService.joinLobby.mockRejectedValue(
        new Error('LOBBY_NOT_FOUND')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/join`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(404);
    });

    it('returns 403 when invite code is required but invalid', async () => {
      mockedSupabaseService.joinLobby.mockRejectedValue(
        new Error('INVALID_INVITE')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/join`)
        .set('Authorization', 'Bearer valid-token')
        .send({ inviteCode: 'wrong-code' });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /lobbies', () => {
    it('lists available lobbies', async () => {
      const lobbies = [
        createMockLobby({ id: 'lobby-1', host_id: 'host-1', name: 'Lobby 1' }),
        createMockLobby({ id: 'lobby-2', host_id: 'host-2', name: 'Lobby 2', max_players: 4 }),
      ];

      mockedSupabaseService.listLobbies.mockResolvedValue(lobbies);

      const response = await request(app)
        .get('/lobbies')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.lobbies).toHaveLength(2);
      expect(response.body.lobbies[0].id).toBe('lobby-1');
    });
  });

  describe('GET /lobbies/current', () => {
    it('returns current lobby when user is in one', async () => {
      const currentLobby = createMockLobby({
        id: 'current-lobby',
        current_players: 2,
        name: 'My Current Lobby',
      });

      mockedSupabaseService.getPlayerActiveLobbyId.mockResolvedValue(
        'current-lobby'
      );
      mockedSupabaseService.getLobbyWithPlayers.mockResolvedValue(currentLobby);

      const response = await request(app)
        .get('/lobbies/current')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.lobby.id).toBe('current-lobby');
    });

    it('returns 404 when user is not in a lobby', async () => {
      mockedSupabaseService.getPlayerActiveLobbyId.mockResolvedValue(null);

      const response = await request(app)
        .get('/lobbies/current')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('NOT_IN_LOBBY');
    });
  });

  describe('POST /lobbies/:lobbyId/kick', () => {
    const lobbyId = 'lobby-123';
    const targetPlayerId = 'player-to-kick';

    it('kicks a player successfully', async () => {
      const updatedLobby = createMockLobby({ id: lobbyId });

      mockedSupabaseService.removeLobbyPlayer.mockResolvedValue(updatedLobby);

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/kick`)
        .set('Authorization', 'Bearer valid-token')
        .send({ targetPlayerId });

      expect(response.status).toBe(200);
      expect(hooks.onLobbyUpdated).toHaveBeenCalledWith(updatedLobby);
    });

    it('returns 400 when targetPlayerId is missing', async () => {
      const response = await request(app)
        .post(`/lobbies/${lobbyId}/kick`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 403 when not the host', async () => {
      mockedSupabaseService.removeLobbyPlayer.mockRejectedValue(
        new Error('NOT_HOST')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/kick`)
        .set('Authorization', 'Bearer valid-token')
        .send({ targetPlayerId });

      expect(response.status).toBe(403);
    });

    it('calls onLobbyClosed when kicked player was last', async () => {
      const emptyLobby = createMockLobby({
        id: lobbyId,
        status: 'finished',
        current_players: 0,
      });

      mockedSupabaseService.removeLobbyPlayer.mockResolvedValue(emptyLobby);

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/kick`)
        .set('Authorization', 'Bearer valid-token')
        .send({ targetPlayerId });

      expect(response.status).toBe(200);
      expect(hooks.onLobbyClosed).toHaveBeenCalledWith(lobbyId);
      expect(hooks.onLobbyUpdated).not.toHaveBeenCalled();
    });
  });

  describe('POST /lobbies/:lobbyId/start', () => {
    const lobbyId = 'lobby-123';

    it('starts a lobby successfully using hook', async () => {
      const startedLobby = createMockLobby({
        id: lobbyId,
        status: 'in_progress',
        current_players: 2,
        name: 'Started Lobby',
        game_id: 'game-123',
      });

      hooks.onStartLobbyGame.mockResolvedValue({
        lobby: startedLobby,
        gameId: 'game-123',
      });

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/start`)
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.lobby.status).toBe('in_progress');
      expect(response.body.gameId).toBe('game-123');
    });

    it('returns 403 when not the host', async () => {
      hooks.onStartLobbyGame.mockResolvedValue({});
      mockedSupabaseService.startLobby.mockRejectedValue(
        new Error('NOT_HOST')
      );

      const response = await request(app)
        .post(`/lobbies/${lobbyId}/start`)
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /lobbies/:lobbyId', () => {
    const lobbyId = 'lobby-123';

    it('updates lobby name', async () => {
      const updatedLobby = createMockLobby({
        id: lobbyId,
        name: 'New Name',
      });

      mockedSupabaseService.updateLobbyName.mockResolvedValue(updatedLobby);

      const response = await request(app)
        .patch(`/lobbies/${lobbyId}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ name: 'New Name' });

      expect(response.status).toBe(200);
      expect(response.body.lobby.name).toBe('New Name');
      expect(hooks.onLobbyUpdated).toHaveBeenCalledWith(updatedLobby);
    });

    it('updates lobby size', async () => {
      const updatedLobby = createMockLobby({
        id: lobbyId,
        max_players: 4,
      });

      mockedSupabaseService.updateLobbySize.mockResolvedValue(updatedLobby);

      const response = await request(app)
        .patch(`/lobbies/${lobbyId}`)
        .set('Authorization', 'Bearer valid-token')
        .send({ maxPlayers: 4 });

      expect(response.status).toBe(200);
      expect(response.body.lobby.max_players).toBe(4);
    });

    it('returns 400 when no fields provided', async () => {
      const response = await request(app)
        .patch(`/lobbies/${lobbyId}`)
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('Auth endpoints', () => {
    describe('POST /auth/signup', () => {
      it('creates a new user', async () => {
        const signupResult = {
          userId: 'new-user',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          profile: mockProfile,
        };

        mockedSupabaseService.signUpWithEmail.mockResolvedValue(signupResult);

        const response = await request(app).post('/auth/signup').send({
          email: 'test@example.com',
          password: 'password123',
          username: 'newuser',
          displayName: 'New User',
        });

        expect(response.status).toBe(201);
        expect(response.body.accessToken).toBe('access-token');
      });

      it('returns 400 when fields are missing', async () => {
        const response = await request(app).post('/auth/signup').send({
          email: 'test@example.com',
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });
    });

    describe('POST /auth/login', () => {
      it('logs in a user', async () => {
        const loginResult = {
          userId: mockUserId,
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          profile: mockProfile,
        };

        mockedSupabaseService.signInWithEmail.mockResolvedValue(loginResult);

        const response = await request(app).post('/auth/login').send({
          email: 'test@example.com',
          password: 'password123',
        });

        expect(response.status).toBe(200);
        expect(response.body.accessToken).toBe('access-token');
      });

      it('returns 401 on invalid credentials', async () => {
        mockedSupabaseService.signInWithEmail.mockRejectedValue(
          new Error('Invalid credentials')
        );

        const response = await request(app).post('/auth/login').send({
          email: 'test@example.com',
          password: 'wrong',
        });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('LOGIN_FAILED');
      });
    });

    describe('GET /auth/me', () => {
      it('returns current user info', async () => {
        const response = await request(app)
          .get('/auth/me')
          .set('Authorization', 'Bearer valid-token');

        expect(response.status).toBe(200);
        expect(response.body.userId).toBe(mockUserId);
        expect(response.body.profile.username).toBe('testuser');
      });
    });
  });

  describe('Friends endpoints', () => {
    describe('GET /friends', () => {
      it('lists friends', async () => {
        const friends = [
          { id: 'friend-1', username: 'friend1', display_name: 'Friend 1', avatar_url: null, friend_code: 'FC1' },
          { id: 'friend-2', username: 'friend2', display_name: 'Friend 2', avatar_url: null, friend_code: 'FC2' },
        ];

        mockedSupabaseService.listFriends.mockResolvedValue(friends);

        const response = await request(app)
          .get('/friends')
          .set('Authorization', 'Bearer valid-token');

        expect(response.status).toBe(200);
        expect(response.body.friends).toHaveLength(2);
      });
    });

    describe('POST /friends/requests', () => {
      it('sends a friend request', async () => {
        const friendRequest = {
          id: 'request-123',
          sender_id: mockUserId,
          recipient_id: 'recipient-123',
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        };

        mockedSupabaseService.sendFriendRequest.mockResolvedValue(friendRequest);

        const response = await request(app)
          .post('/friends/requests')
          .set('Authorization', 'Bearer valid-token')
          .send({ recipientUsername: 'targetuser' });

        expect(response.status).toBe(201);
        expect(response.body.request.status).toBe('pending');
      });

      it('returns 400 when username missing', async () => {
        const response = await request(app)
          .post('/friends/requests')
          .set('Authorization', 'Bearer valid-token')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });

      it('returns 404 when user not found', async () => {
        mockedSupabaseService.sendFriendRequest.mockRejectedValue(
          new Error('NOT_FOUND')
        );

        const response = await request(app)
          .post('/friends/requests')
          .set('Authorization', 'Bearer valid-token')
          .send({ recipientUsername: 'nonexistent' });

        expect(response.status).toBe(404);
      });

      it('returns 409 ALREADY_FRIENDS when already friends', async () => {
        mockedSupabaseService.sendFriendRequest.mockRejectedValue(
          new Error('ALREADY_FRIENDS')
        );

        const response = await request(app)
          .post('/friends/requests')
          .set('Authorization', 'Bearer valid-token')
          .send({ recipientUsername: 'existingfriend' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('ALREADY_FRIENDS');
      });

      it('returns 409 ALREADY_SENT_REQUEST when request already sent', async () => {
        mockedSupabaseService.sendFriendRequest.mockRejectedValue(
          new Error('ALREADY_SENT_REQUEST')
        );

        const response = await request(app)
          .post('/friends/requests')
          .set('Authorization', 'Bearer valid-token')
          .send({ recipientUsername: 'targetuser' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('ALREADY_SENT_REQUEST');
      });

      it('returns 409 INCOMING_REQUEST_EXISTS when target already sent a request', async () => {
        mockedSupabaseService.sendFriendRequest.mockRejectedValue(
          new Error('INCOMING_REQUEST_EXISTS')
        );

        const response = await request(app)
          .post('/friends/requests')
          .set('Authorization', 'Bearer valid-token')
          .send({ recipientUsername: 'targetuser' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('INCOMING_REQUEST_EXISTS');
      });
    });

    describe('POST /friends/requests/from-lobby', () => {
      it('sends a friend request from lobby', async () => {
        const friendRequest = {
          id: 'request-123',
          sender_id: mockUserId,
          recipient_id: 'target-123',
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        };

        mockedSupabaseService.sendFriendRequestFromLobby.mockResolvedValue(friendRequest);

        const response = await request(app)
          .post('/friends/requests/from-lobby')
          .set('Authorization', 'Bearer valid-token')
          .send({ lobbyId: 'lobby-123', targetUserId: 'target-123' });

        expect(response.status).toBe(201);
        expect(response.body.request.status).toBe('pending');
      });

      it('returns 409 ALREADY_FRIENDS when already friends', async () => {
        mockedSupabaseService.sendFriendRequestFromLobby.mockRejectedValue(
          new Error('ALREADY_FRIENDS')
        );

        const response = await request(app)
          .post('/friends/requests/from-lobby')
          .set('Authorization', 'Bearer valid-token')
          .send({ lobbyId: 'lobby-123', targetUserId: 'target-123' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('ALREADY_FRIENDS');
      });

      it('returns 409 ALREADY_SENT_REQUEST when request already sent', async () => {
        mockedSupabaseService.sendFriendRequestFromLobby.mockRejectedValue(
          new Error('ALREADY_SENT_REQUEST')
        );

        const response = await request(app)
          .post('/friends/requests/from-lobby')
          .set('Authorization', 'Bearer valid-token')
          .send({ lobbyId: 'lobby-123', targetUserId: 'target-123' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('ALREADY_SENT_REQUEST');
      });

      it('returns 409 INCOMING_REQUEST_EXISTS when target already sent a request', async () => {
        mockedSupabaseService.sendFriendRequestFromLobby.mockRejectedValue(
          new Error('INCOMING_REQUEST_EXISTS')
        );

        const response = await request(app)
          .post('/friends/requests/from-lobby')
          .set('Authorization', 'Bearer valid-token')
          .send({ lobbyId: 'lobby-123', targetUserId: 'target-123' });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('INCOMING_REQUEST_EXISTS');
      });

      it('returns 403 when not in lobby', async () => {
        mockedSupabaseService.sendFriendRequestFromLobby.mockRejectedValue(
          new Error('NOT_IN_LOBBY')
        );

        const response = await request(app)
          .post('/friends/requests/from-lobby')
          .set('Authorization', 'Bearer valid-token')
          .send({ lobbyId: 'lobby-123', targetUserId: 'target-123' });

        expect(response.status).toBe(403);
      });
    });

    describe('POST /friends/requests/:id/respond', () => {
      it('accepts a friend request', async () => {
        mockedSupabaseService.respondToFriendRequest.mockResolvedValue(
          undefined
        );

        const response = await request(app)
          .post('/friends/requests/request-123/respond')
          .set('Authorization', 'Bearer valid-token')
          .send({ accept: true });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it('declines a friend request', async () => {
        mockedSupabaseService.respondToFriendRequest.mockResolvedValue(
          undefined
        );

        const response = await request(app)
          .post('/friends/requests/request-123/respond')
          .set('Authorization', 'Bearer valid-token')
          .send({ accept: false });

        expect(response.status).toBe(200);
      });

      it('returns 400 when accept is missing', async () => {
        const response = await request(app)
          .post('/friends/requests/request-123/respond')
          .set('Authorization', 'Bearer valid-token')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('VALIDATION_ERROR');
      });
    });

    describe('POST /friends/:id/remove', () => {
      it('removes a friend', async () => {
        mockedSupabaseService.removeFriendship.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/friends/friend-123/remove')
          .set('Authorization', 'Bearer valid-token');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

});
