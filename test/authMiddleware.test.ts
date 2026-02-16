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
import { applyAuthMiddleware } from '../src/server/AuthMiddleware';
import * as supabaseService from '../src/services/supabaseService';

const mockedSupabaseService = supabaseService as jest.Mocked<
  typeof supabaseService
>;

describe('auth negative paths', () => {
  describe('HTTP auth middleware', () => {
    let app: express.Express;

    const mockUserId = 'test-user-123';
    const mockProfile = {
      id: mockUserId,
      username: 'testuser',
      display_name: 'Test User',
      avatar_url: null,
      friend_code: 'ABC123',
      created_at: new Date().toISOString(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      app = express();
      app.use(express.json());
      registerHttpApi(app);

      mockedSupabaseService.verifyAccessToken.mockResolvedValue({
        userId: mockUserId,
      });
      mockedSupabaseService.getProfile.mockResolvedValue(mockProfile as any);
    });

    it('GET /auth/me returns 401 when missing bearer token', async () => {
      const response = await request(app).get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'NOT_AUTHORIZED',
        message: 'Missing bearer token',
      });
    });

    it('GET /auth/me returns 401 when token is invalid', async () => {
      mockedSupabaseService.verifyAccessToken.mockRejectedValue(
        new Error('Invalid token'),
      );

      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('NOT_AUTHORIZED');
      expect(response.body.message).toBe('Invalid token');
    });

    it('GET /auth/me returns 200 when token is valid', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(mockUserId);
      expect(response.body.profile).toBeTruthy();
    });
  });

  describe('WebSocket auth middleware', () => {
    it('rejects connection when missing accessToken', async () => {
      let middleware: ((socket: any, next: (err?: Error) => void) => void) | null =
        null;
      const io = {
        use(fn: any) {
          middleware = fn;
        },
      } as any;

      applyAuthMiddleware(io);
      expect(middleware).not.toBeNull();

      const socket = {
        id: 'socket-1',
        handshake: { auth: {}, headers: { origin: 'test' } },
        data: {},
      };

      await new Promise<void>((resolve) => {
        middleware!(socket, (err?: Error) => {
          expect(err).toBeInstanceOf(Error);
          expect(err?.message).toBe('Missing access token');
          resolve();
        });
      });
    });

    it('rejects connection when token is invalid', async () => {
      mockedSupabaseService.verifyAccessToken.mockRejectedValue(
        new Error('bad token'),
      );

      let middleware: ((socket: any, next: (err?: Error) => void) => void) | null =
        null;
      const io = {
        use(fn: any) {
          middleware = fn;
        },
      } as any;

      applyAuthMiddleware(io);

      const socket = {
        id: 'socket-2',
        handshake: { auth: { accessToken: 'invalid-token' }, headers: {} },
        data: {},
      };

      await new Promise<void>((resolve) => {
        middleware!(socket, (err?: Error) => {
          expect(err).toBeInstanceOf(Error);
          expect(err?.message).toBe('Invalid token');
          resolve();
        });
      });
    });

    it('accepts connection when token is valid and sets socket userId', async () => {
      mockedSupabaseService.verifyAccessToken.mockResolvedValue({
        userId: 'user-1',
      });

      let middleware: ((socket: any, next: (err?: Error) => void) => void) | null =
        null;
      const io = {
        use(fn: any) {
          middleware = fn;
        },
      } as any;

      applyAuthMiddleware(io);

      const socket: any = {
        id: 'socket-3',
        handshake: { auth: { accessToken: 'valid-token' }, headers: {} },
        data: {},
      };

      await new Promise<void>((resolve) => {
        middleware!(socket, (err?: Error) => {
          expect(err).toBeUndefined();
          expect(socket.data.userId).toBe('user-1');
          resolve();
        });
      });
    });
  });
});

