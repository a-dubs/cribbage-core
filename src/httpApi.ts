import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  createLobby,
  getProfile,
  joinLobby,
  leaveLobby,
  listLobbies,
  listFriendRequests,
  listFriendRequestsWithProfiles,
  listUserGames,
  getGameEventsForUser,
  getGameSnapshotsForUser,
  listFriends,
  respondToFriendRequest,
  sendFriendRequest,
  sendFriendRequestFromLobby,
  lockLobby,
  removeLobbyPlayer,
  signInWithEmail,
  signUpWithEmail,
  refreshAccessToken,
  searchProfilesByUsername,
  startLobby,
  updateLobbyName,
  updateLobbySize,
  removeFriendship,
  updateProfile,
  sendLobbyInvite,
  listLobbyInvitations,
  respondToLobbyInvitation,
  verifyAccessToken,
  getPlayerActiveLobbyId,
  getLobbyWithPlayers,
  type LobbyPayload,
  type LobbyVisibility,
  type SupabaseProfile,
} from './services/supabaseService';
import { registerAvatarRoutes } from './routes/avatarRoutes';

type AuthenticatedRequest = Request & {
  userId?: string;
  profile?: SupabaseProfile | null;
};

const SUPABASE_AUTH_ENABLED = process.env.SUPABASE_AUTH_ENABLED === 'true';
const SUPABASE_LOBBIES_ENABLED =
  process.env.SUPABASE_LOBBIES_ENABLED === 'true';

type HttpApiHooks = {
  onLobbyUpdated?: (lobby: LobbyPayload) => void;
  onLobbyClosed?: (lobbyId: string) => void;
  onPlayerLeftLobby?: (playerId: string, lobbyId: string) => void;
  onStartLobbyGame?: (
    lobbyId: string,
    hostId: string
  ) => Promise<{ lobby?: LobbyPayload; gameId?: string }>;
};

function requireSupabaseFlag(enabled: boolean, res: Response): boolean {
  if (!enabled) {
    res.status(503).json({
      error: 'FEATURE_DISABLED',
      message: 'Supabase-backed APIs are disabled',
    });
    return false;
  }
  return true;
}

async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!SUPABASE_AUTH_ENABLED) {
    res.status(503).json({
      error: 'FEATURE_DISABLED',
      message: 'Supabase auth is disabled',
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res
      .status(401)
      .json({ error: 'NOT_AUTHORIZED', message: 'Missing bearer token' });
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

export function registerHttpApi(
  app: express.Express,
  hooks?: HttpApiHooks
): void {
  registerAvatarRoutes(app, authMiddleware);
  app.post('/auth/signup', async (req: Request, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_AUTH_ENABLED, res)) return;
    const { email, password, username, displayName } = req.body ?? {};
    if (!email || !password || !username || !displayName) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'email, password, username, displayName are required',
      });
      return;
    }
    try {
      const result = await signUpWithEmail({
        email,
        password,
        username,
        displayName,
      });
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
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'email and password are required',
      });
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

  app.post('/auth/refresh', async (req: Request, res: Response) => {
    if (!requireSupabaseFlag(SUPABASE_AUTH_ENABLED, res)) return;
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'refreshToken is required',
      });
      return;
    }
    try {
      const result = await refreshAccessToken(refreshToken);
      res.status(200).json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Token refresh failed';
      res.status(401).json({ error: 'REFRESH_FAILED', message });
    }
  });

  app.get(
    '/auth/me',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      res.json({
        userId: req.userId,
        profile: req.profile,
      });
    }
  );

  app.put(
    '/auth/profile',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { displayName, username, avatarUrl } = req.body ?? {};
      try {
        const profile = await updateProfile({
          userId: req.userId,
          displayName,
          username,
          avatarUrl,
        });
        res.json({ profile });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update profile';
        // Check for validation errors (username/display name validation)
        const isValidationError =
          message.includes('Username') ||
          message.includes('must be between') ||
          message.includes('can only contain') ||
          message === 'DISPLAY_NAME_REQUIRED' ||
          message === 'NO_FIELDS';
        const status = isValidationError ? 400 : 409;
        res.status(status).json({ error: 'PROFILE_UPDATE_FAILED', message });
      }
    }
  );

  app.get(
    '/lobbies',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const lobbies = await listLobbies(req.userId);
        res.json({ lobbies: lobbies.map(mapLobbyPayload) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to list lobbies';
        res.status(500).json({ error: 'LOBBY_LIST_FAILED', message });
      }
    }
  );

  app.get(
    '/lobbies/current',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const lobbyId = await getPlayerActiveLobbyId(req.userId);
        if (!lobbyId) {
          res.status(404).json({
            error: 'NOT_IN_LOBBY',
            message: 'User is not in any active lobby',
          });
          return;
        }
        const lobby = await getLobbyWithPlayers(lobbyId);
        if (!lobby) {
          res
            .status(404)
            .json({ error: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
          return;
        }
        res.json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to get current lobby';
        res.status(500).json({ error: 'LOBBY_GET_FAILED', message });
      }
    }
  );

  app.post(
    '/lobbies',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const {
        name,
        maxPlayers,
        isFixedSize = true,
        visibility = 'public',
        settings,
      } = req.body ?? {};
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      if (!maxPlayers || maxPlayers < 2 || maxPlayers > 4) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'maxPlayers must be between 2 and 4',
        });
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
        hooks?.onLobbyUpdated?.(lobby);
        res.status(201).json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to create lobby';
        let status = 400;
        let errorType = 'LOBBY_CREATE_FAILED';

        if (message === 'ALREADY_IN_LOBBY') {
          status = 409;
          errorType = 'ALREADY_IN_LOBBY';
        }

        res.status(status).json({ error: errorType, message });
      }
    }
  );

  app.post(
    '/lobbies/:lobbyId/join',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      const { inviteCode } = req.body ?? {};
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const lobby = await joinLobby({
          lobbyId,
          playerId: req.userId,
          inviteCode,
        });
        hooks?.onLobbyUpdated?.(lobby);
        res.status(200).json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to join lobby';
        let status = 400;
        let errorType = 'LOBBY_JOIN_FAILED';

        if (message === 'LOBBY_NOT_FOUND') status = 404;
        else if (message === 'LOBBY_LOCKED') status = 409;
        else if (message === 'LOBBY_FULL') status = 409;
        else if (message === 'INVALID_INVITE') status = 403;
        else if (message === 'NOT_FRIENDS_WITH_HOST') status = 403;
        else if (message === 'LOBBY_NO_HOST') status = 500;
        else if (message === 'ALREADY_IN_LOBBY') {
          status = 409;
          errorType = 'ALREADY_IN_LOBBY';
        }

        res.status(status).json({ error: errorType, message });
      }
    }
  );

  app.post(
    '/lobbies/:lobbyId/leave',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const lobby = await leaveLobby({ lobbyId, playerId: req.userId });
        // Clear in-memory state for this player leaving the lobby
        hooks?.onPlayerLeftLobby?.(req.userId, lobbyId);
        if (
          lobby?.status === 'finished' ||
          (lobby?.current_players ?? 0) === 0
        ) {
          hooks?.onLobbyClosed?.(lobbyId);
        } else if (lobby) {
          hooks?.onLobbyUpdated?.(lobby);
        }
        res.status(204).send();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to leave lobby';
        res.status(400).json({ error: 'LOBBY_LEAVE_FAILED', message });
      }
    }
  );

  app.post(
    '/lobbies/:lobbyId/invite',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      const { recipientId } = req.body ?? {};
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      if (!recipientId) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'recipientId is required',
        });
        return;
      }
      try {
        const invitation = await sendLobbyInvite({
          lobbyId,
          senderId: req.userId,
          recipientId,
        });
        res.status(201).json({ invitation });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to send invitation';
        let status = 400;
        if (message === 'NOT_HOST') status = 403;
        if (message === 'LOBBY_NOT_FOUND') status = 404;
        res.status(status).json({ error: 'LOBBY_INVITE_FAILED', message });
      }
    }
  );

  app.get(
    '/lobbies/invitations',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const invites = await listLobbyInvitations(req.userId);
        res.json(invites);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to fetch invitations';
        res.status(500).json({ error: 'LOBBY_INVITES_FAILED', message });
      }
    }
  );

  app.post(
    '/lobbies/invitations/:id/respond',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { id } = req.params;
      const { accept } = req.body ?? {};
      if (accept === undefined) {
        res
          .status(400)
          .json({ error: 'VALIDATION_ERROR', message: 'accept is required' });
        return;
      }
      try {
        const result = await respondToLobbyInvitation({
          invitationId: id,
          recipientId: req.userId,
          accept: Boolean(accept),
        });
        if (result.lobby) {
          hooks?.onLobbyUpdated?.(result.lobby);
        }
        res.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to respond to invitation';
        let status = 400;
        if (message === 'INVITE_NOT_FOUND') status = 404;
        if (message === 'NOT_AUTHORIZED') status = 403;
        res
          .status(status)
          .json({ error: 'LOBBY_INVITE_RESPONSE_FAILED', message });
      }
    }
  );

  app.patch(
    '/lobbies/:lobbyId',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      const { name, maxPlayers, isFixedSize } = req.body ?? {};
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      if (name === undefined && maxPlayers === undefined) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'name or maxPlayers is required',
        });
        return;
      }
      try {
        let lobby: LobbyPayload | null = null;
        if (name !== undefined) {
          lobby = await updateLobbyName({ lobbyId, hostId: req.userId, name });
        }
        if (maxPlayers !== undefined) {
          lobby = await updateLobbySize({
            lobbyId,
            hostId: req.userId,
            maxPlayers: Number(maxPlayers),
            isFixedSize,
          });
        }
        if (!lobby) {
          res
            .status(400)
            .json({ error: 'NO_UPDATE', message: 'No changes applied' });
          return;
        }
        hooks?.onLobbyUpdated?.(lobby);
        res.json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update lobby';
        let status = 400;
        if (message === 'NOT_HOST') status = 403;
        if (message === 'LOBBY_NOT_WAITING') status = 409;
        if (message === 'SIZE_TOO_SMALL') status = 409;
        if (message === 'INVALID_SIZE') status = 400;
        res.status(status).json({ error: 'LOBBY_UPDATE_FAILED', message });
      }
    }
  );

  app.post(
    '/lobbies/:lobbyId/lock',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const lobby = await lockLobby({ lobbyId, hostId: req.userId });
        hooks?.onLobbyUpdated?.(lobby);
        res.json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to lock lobby';
        const status =
          message === 'NOT_HOST'
            ? 403
            : message === 'LOBBY_NOT_WAITING'
            ? 409
            : 400;
        res.status(status).json({ error: 'LOBBY_LOCK_FAILED', message });
      }
    }
  );

  app.post(
    '/lobbies/:lobbyId/start',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        if (hooks?.onStartLobbyGame) {
          const result = await hooks.onStartLobbyGame(lobbyId, req.userId);
          if (result?.lobby) {
            res.json({
              lobby: mapLobbyPayload(result.lobby),
              gameId: result.gameId,
            });
            return;
          }
        }
        const lobby = await startLobby({ lobbyId, hostId: req.userId });
        hooks?.onLobbyUpdated?.(lobby);
        res.json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to start lobby';
        const status =
          message === 'NOT_HOST'
            ? 403
            : message === 'LOBBY_NOT_WAITING'
            ? 409
            : 400;
        res.status(status).json({ error: 'LOBBY_START_FAILED', message });
      }
    }
  );

  app.post(
    '/lobbies/:lobbyId/kick',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!requireSupabaseFlag(SUPABASE_LOBBIES_ENABLED, res)) return;
      const { lobbyId } = req.params;
      const { targetPlayerId } = req.body ?? {};
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      if (!targetPlayerId) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'targetPlayerId is required',
        });
        return;
      }
      try {
        const lobby = await removeLobbyPlayer({
          lobbyId,
          hostId: req.userId,
          targetPlayerId,
        });
        if (lobby.status === 'finished' || lobby.current_players === 0) {
          hooks?.onLobbyClosed?.(lobbyId);
        } else {
          hooks?.onLobbyUpdated?.(lobby);
        }
        res.json({ lobby: mapLobbyPayload(lobby) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to kick player';
        let status = 400;
        if (message === 'NOT_HOST') status = 403;
        if (message === 'LOBBY_NOT_WAITING') status = 409;
        res.status(status).json({ error: 'LOBBY_KICK_FAILED', message });
      }
    }
  );

  app.get(
    '/friends',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const friends = await listFriends(req.userId);
        res.json({ friends });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to fetch friends';
        res.status(500).json({ error: 'FRIENDS_LIST_FAILED', message });
      }
    }
  );

  app.get(
    '/friends/requests',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const requests = await listFriendRequestsWithProfiles(req.userId);
        res.json(requests);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to fetch requests';
        res.status(500).json({ error: 'FRIEND_REQUESTS_FAILED', message });
      }
    }
  );

  app.post(
    '/friends/requests',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { recipientUsername } = req.body ?? {};
      if (!recipientUsername) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'recipientUsername is required',
        });
        return;
      }
      try {
        const request = await sendFriendRequest({
          senderId: req.userId,
          recipientUsername,
        });
        res.status(201).json({ request });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to send request';
        let status = 400;
        if (message === 'NOT_FOUND') {
          status = 404;
        } else if (message === 'CANNOT_ADD_SELF') {
          status = 400;
        }
        res.status(status).json({ error: 'FRIEND_REQUEST_FAILED', message });
      }
    }
  );

  app.post(
    '/friends/requests/from-lobby',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { lobbyId, targetUserId } = req.body ?? {};
      if (!lobbyId || !targetUserId) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'lobbyId and targetUserId are required',
        });
        return;
      }
      try {
        const request = await sendFriendRequestFromLobby({
          senderId: req.userId,
          targetUserId,
          lobbyId,
        });
        res.status(201).json({ request });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to send request from lobby';
        let status = 400;
        if (message === 'NOT_IN_LOBBY') {
          status = 403;
        } else if (message === 'CANNOT_ADD_SELF') {
          status = 400;
        }
        res.status(status).json({ error: 'FRIEND_REQUEST_FAILED', message });
      }
    }
  );

  app.post(
    '/friends/requests/:id/respond',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { id } = req.params;
      const { accept } = req.body ?? {};
      if (accept === undefined) {
        res
          .status(400)
          .json({ error: 'VALIDATION_ERROR', message: 'accept is required' });
        return;
      }
      try {
        await respondToFriendRequest({
          requestId: id,
          recipientId: req.userId,
          accept: Boolean(accept),
        });
        res.status(200).json({ success: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to respond';
        res.status(400).json({ error: 'FRIEND_RESPONSE_FAILED', message });
      }
    }
  );

  app.get(
    '/friends/search',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const username = (req.query.username as string) ?? '';
      try {
        const results = await searchProfilesByUsername(username);
        res.json({ results });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Search failed';
        const status = message === 'QUERY_TOO_SHORT' ? 400 : 500;
        res.status(status).json({ error: 'FRIEND_SEARCH_FAILED', message });
      }
    }
  );

  app.post(
    '/friends/:id/remove',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { id } = req.params;
      try {
        await removeFriendship({ userId: req.userId, friendId: id });
        res.status(200).json({ success: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to remove friend';
        res.status(400).json({ error: 'FRIEND_REMOVE_FAILED', message });
      }
    }
  );

  app.get(
    '/games',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      try {
        const games = await listUserGames(req.userId);
        res.json({ games });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to fetch games';
        res.status(500).json({ error: 'GAMES_FETCH_FAILED', message });
      }
    }
  );

  app.get(
    '/games/:gameId/events',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { gameId } = req.params;
      try {
        const events = await getGameEventsForUser(gameId, req.userId);
        res.json({ events });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to fetch events';
        const status = message === 'NOT_AUTHORIZED' ? 403 : 500;
        res.status(status).json({ error: 'GAME_EVENTS_FAILED', message });
      }
    }
  );

  app.get(
    '/games/:gameId/snapshots',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { gameId } = req.params;
      try {
        const snapshots = await getGameSnapshotsForUser(gameId, req.userId);
        res.json({ snapshots });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to fetch snapshots';
        const status = message === 'NOT_AUTHORIZED' ? 403 : 500;
        res.status(status).json({ error: 'GAME_SNAPSHOTS_FAILED', message });
      }
    }
  );

  app.get(
    '/games/:gameId/replay',
    authMiddleware,
    async (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        res
          .status(401)
          .json({ error: 'NOT_AUTHORIZED', message: 'Missing user' });
        return;
      }
      const { gameId } = req.params;
      try {
        const [events, snapshots] = await Promise.all([
          getGameEventsForUser(gameId, req.userId),
          getGameSnapshotsForUser(gameId, req.userId),
        ]);
        res.json({ events, snapshots });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to fetch replay data';
        const status = message === 'NOT_AUTHORIZED' ? 403 : 500;
        res.status(status).json({ error: 'GAME_REPLAY_FAILED', message });
      }
    }
  );
}
