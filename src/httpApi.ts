import express, { type NextFunction, type Request, type Response } from 'express';
import {
  createLobby,
  getProfile,
  joinLobby,
  leaveLobby,
  listLobbies,
  listFriendRequests,
  listFriends,
  respondToFriendRequest,
  sendFriendRequest,
  signInWithEmail,
  signUpWithEmail,
  verifyAccessToken,
  type LobbyPayload,
  type LobbyVisibility,
  type SupabaseProfile,
} from './services/supabaseService';
import { registerAvatarRoutes } from './routes/avatarRoutes';

type AuthenticatedRequest = Request & { userId?: string; profile?: SupabaseProfile | null };

const SUPABASE_AUTH_ENABLED = process.env.SUPABASE_AUTH_ENABLED === 'true';
const SUPABASE_LOBBIES_ENABLED = process.env.SUPABASE_LOBBIES_ENABLED === 'true';

function requireSupabaseFlag(enabled: boolean, res: Response): boolean {
  if (!enabled) {
    res.status(503).json({ error: 'FEATURE_DISABLED', message: 'Supabase-backed APIs are disabled' });
    return false;
  }
  return true;
}

async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!SUPABASE_AUTH_ENABLED) {
    res.status(503).json({ error: 'FEATURE_DISABLED', message: 'Supabase auth is disabled' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing bearer token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const { userId } = await verifyAccessToken(token);
    req.userId = userId;
    req.profile = await getProfile(userId);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    res.status(401).json({ error: 'NOT_AUTHORIZED', message });
  }
}

function mapLobbyPayload(lobby: LobbyPayload): LobbyPayload {
  return {
    ...lobby,
    players: lobby.players ?? [],
  };
}

export function registerHttpApi(app: express.Express): void {
  registerAvatarRoutes(app, authMiddleware);
  app.post('/auth/signup', async (req: Request, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_AUTH_ENABLED, res)) return;
    const { email, password, username, displayName } = req.body ?? {};
    if (!email || !password || !username || !displayName) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'email, password, username, displayName are required' });
      return;
    }
    try {
      const result = await signUpWithEmail({ email, password, username, displayName });
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Signup failed';
      res.status(400).json({ error: 'SIGNUP_FAILED', message });
    }
  });

  app.post('/auth/login', async (req: Request, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_AUTH_ENABLED, res)) return;
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'email and password are required' });
      return;
    }
    try {
      const result = await signInWithEmail({ email, password });
      res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      res.status(401).json({ error: 'LOGIN_FAILED', message });
    }
  });

  app.get('/auth/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    res.json({
      userId: req.userId,
      profile: req.profile,
    });
  });

  app.get('/lobbies', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
    try {
      const lobbies = await listLobbies();
      res.json({ lobbies: lobbies.map(mapLobbyPayload) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list lobbies';
      res.status(500).json({ error: 'LOBBY_LIST_FAILED', message });
    }
  });

  app.post('/lobbies', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
    const { name, maxPlayers, isFixedSize = true, visibility = 'public', settings } = req.body ?? {};
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    if (!maxPlayers || maxPlayers < 2 || maxPlayers > 4) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'maxPlayers must be between 2 and 4' });
      return;
    }
    try {
      const lobby = await createLobby({
        hostId: req.userId,
        name,
        maxPlayers,
        isFixedSize,
        visibility: (visibility as LobbyVisibility) ?? 'public',
        settings: settings ?? null,
      });
      res.status(201).json({ lobby: mapLobbyPayload(lobby) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create lobby';
      res.status(400).json({ error: 'LOBBY_CREATE_FAILED', message });
    }
  });

  app.post('/lobbies/:lobbyId/join', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
    const { lobbyId } = req.params;
    const { inviteCode } = req.body ?? {};
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    try {
      const lobby = await joinLobby({
        lobbyId,
        playerId: req.userId,
        inviteCode,
      });
      res.status(200).json({ lobby: mapLobbyPayload(lobby) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join lobby';
      let status = 400;
      if (message === 'LOBBY_NOT_FOUND') status = 404;
      if (message === 'LOBBY_LOCKED') status = 409;
      if (message === 'LOBBY_FULL') status = 409;
      if (message === 'INVALID_INVITE') status = 403;
      res.status(status).json({ error: 'LOBBY_JOIN_FAILED', message });
    }
  });

  app.post('/lobbies/:lobbyId/leave', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
    const { lobbyId } = req.params;
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    try {
      await leaveLobby({ lobbyId, playerId: req.userId });
      res.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to leave lobby';
      res.status(400).json({ error: 'LOBBY_LEAVE_FAILED', message });
    }
  });

  app.get('/friends', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    try {
      const friends = await listFriends(req.userId);
      res.json({ friends });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch friends';
      res.status(500).json({ error: 'FRIENDS_LIST_FAILED', message });
    }
  });

  app.get('/friends/requests', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    try {
      const requests = await listFriendRequests(req.userId);
      res.json(requests);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch requests';
      res.status(500).json({ error: 'FRIEND_REQUESTS_FAILED', message });
    }
  });

  app.post('/friends/requests', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    const { recipientUsername } = req.body ?? {};
    if (!recipientUsername) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'recipientUsername is required' });
      return;
    }
    try {
      const request = await sendFriendRequest({ senderId: req.userId, recipientUsername });
      res.status(201).json({ request });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send request';
      const status = message === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: 'FRIEND_REQUEST_FAILED', message });
    }
  });

  app.post('/friends/requests/:id/respond', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
      return;
    }
    const { id } = req.params;
    const { accept } = req.body ?? {};
    if (accept === undefined) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'accept is required' });
      return;
    }
    try {
      await respondToFriendRequest({ requestId: id, recipientId: req.userId, accept: Boolean(accept) });
      res.status(200).json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to respond';
      res.status(400).json({ error: 'FRIEND_RESPONSE_FAILED', message });
    }
  });
}
