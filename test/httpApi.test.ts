// Set up environment variables BEFORE importing
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_AUTH_ENABLED = 'true';
process.env.SUPABASE_LOBBIES_ENABLED = 'true';

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
    created_at: new Date().toISOString(),
  };

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
      const updatedLobby = {
        id: lobbyId,
        status: 'waiting' as const,
        current_players: 1,
        max_players: 2,
        host_id: 'other-player',
        name: 'Test Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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

      const updatedLobby = {
        id: lobbyId,
        status: 'waiting' as const,
        current_players: 1,
        max_players: 2,
        host_id: 'other-player',
        name: 'Test Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

      mockedSupabaseService.leaveLobby.mockResolvedValue(updatedLobby);

      await request(app)
        .post(`/lobbies/${lobbyId}/leave`)
        .set('Authorization', 'Bearer valid-token');

      expect(callOrder).toEqual(['onPlayerLeftLobby', 'onLobbyUpdated']);
    });

    it('calls onLobbyClosed when lobby becomes empty', async () => {
      const emptyLobby = {
        id: lobbyId,
        status: 'finished' as const,
        current_players: 0,
        max_players: 2,
        host_id: mockUserId,
        name: 'Test Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
      const newLobby = {
        id: 'new-lobby-123',
        status: 'waiting' as const,
        current_players: 1,
        max_players: 2,
        host_id: mockUserId,
        name: 'My Game',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [
          {
            odplayerId: mockUserId,
            odusername: 'testuser',
            oddisplayName: 'Test User',
            isavatarUrl: null,
            isHost: true,
          },
        ],
      };

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
      const joinedLobby = {
        id: lobbyId,
        status: 'waiting' as const,
        current_players: 2,
        max_players: 2,
        host_id: 'host-player',
        name: 'Joinable Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
        {
          id: 'lobby-1',
          status: 'waiting' as const,
          current_players: 1,
          max_players: 2,
          host_id: 'host-1',
          name: 'Lobby 1',
          is_fixed_size: true,
          visibility: 'public' as const,
          settings: null,
          invite_code: null,
          game_id: null,
          created_at: new Date().toISOString(),
          players: [],
        },
        {
          id: 'lobby-2',
          status: 'waiting' as const,
          current_players: 1,
          max_players: 4,
          host_id: 'host-2',
          name: 'Lobby 2',
          is_fixed_size: true,
          visibility: 'public' as const,
          settings: null,
          invite_code: null,
          game_id: null,
          created_at: new Date().toISOString(),
          players: [],
        },
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
      const currentLobby = {
        id: 'current-lobby',
        status: 'waiting' as const,
        current_players: 2,
        max_players: 2,
        host_id: mockUserId,
        name: 'My Current Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
      const updatedLobby = {
        id: lobbyId,
        status: 'waiting' as const,
        current_players: 1,
        max_players: 2,
        host_id: mockUserId,
        name: 'Test Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
      const emptyLobby = {
        id: lobbyId,
        status: 'finished' as const,
        current_players: 0,
        max_players: 2,
        host_id: mockUserId,
        name: 'Test Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
      const startedLobby = {
        id: lobbyId,
        status: 'in_progress' as const,
        current_players: 2,
        max_players: 2,
        host_id: mockUserId,
        name: 'Started Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: 'game-123',
        created_at: new Date().toISOString(),
        players: [],
      };

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
      const updatedLobby = {
        id: lobbyId,
        status: 'waiting' as const,
        current_players: 1,
        max_players: 2,
        host_id: mockUserId,
        name: 'New Name',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
      const updatedLobby = {
        id: lobbyId,
        status: 'waiting' as const,
        current_players: 1,
        max_players: 4,
        host_id: mockUserId,
        name: 'Test Lobby',
        is_fixed_size: true,
        visibility: 'public' as const,
        settings: null,
        invite_code: null,
        game_id: null,
        created_at: new Date().toISOString(),
        players: [],
      };

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
          user: { id: 'new-user', email: 'test@example.com' },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
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
          user: { id: mockUserId, email: 'test@example.com' },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
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
          { id: 'friend-1', username: 'friend1', display_name: 'Friend 1' },
          { id: 'friend-2', username: 'friend2', display_name: 'Friend 2' },
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
          status: 'pending',
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

  describe('Feature flags', () => {
    let appWithFlagsDisabled: express.Express;

    beforeEach(() => {
      // Create a new app with flags disabled
      // We need to re-import to pick up new env vars
      jest.resetModules();
      process.env.SUPABASE_AUTH_ENABLED = 'false';
      process.env.SUPABASE_LOBBIES_ENABLED = 'false';
    });

    afterEach(() => {
      // Restore flags
      process.env.SUPABASE_AUTH_ENABLED = 'true';
      process.env.SUPABASE_LOBBIES_ENABLED = 'true';
    });

    it('returns 503 for auth endpoints when auth is disabled', async () => {
      // Re-import with new env vars
      jest.isolateModules(() => {
        process.env.SUPABASE_AUTH_ENABLED = 'false';
        const express = require('express');
        const { registerHttpApi } = require('../src/httpApi');

        appWithFlagsDisabled = express();
        appWithFlagsDisabled.use(express.json());
        registerHttpApi(appWithFlagsDisabled, hooks);
      });

      const response = await request(appWithFlagsDisabled)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'pass' });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('FEATURE_DISABLED');
    });
  });
});
