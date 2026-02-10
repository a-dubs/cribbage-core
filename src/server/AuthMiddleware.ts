import { Server } from 'socket.io';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../services/supabaseService';

/**
 * Applies Socket.IO authentication middleware to the server.
 * Requires a valid Supabase JWT access token in the socket handshake auth.accessToken field.
 *
 * @param io - The Socket.IO Server instance
 */
export function applyAuthMiddleware(io: Server): void {
  io.use((socket, next) => {
    const socketId = socket.id || 'pending';
    logger.info(
      `[Auth Middleware] 🔐 Processing connection for socket ${socketId}`,
      {
        hasAuth: !!socket.handshake.auth,
        authKeys: socket.handshake.auth
          ? Object.keys(socket.handshake.auth)
          : [],
        origin: socket.handshake.headers.origin,
      }
    );

    const token = (
      socket.handshake.auth as { accessToken?: string } | undefined
    )?.accessToken;
    if (!token) {
      logger.warn(
        `[Auth Middleware] ❌ Missing access token from socket ${socketId}`,
        { hasAuth: !!socket.handshake.auth }
      );
      return next(new Error('Missing access token'));
    }

    logger.info(`[Auth Middleware] 🔍 Verifying token for socket ${socketId}`, {
      tokenLength: token.length,
    });

    verifyAccessToken(token)
      .then(({ userId }) => {
        (socket.data as { userId?: string }).userId = userId;
        logger.info(
          `[Auth Middleware] ✅✅✅ Socket ${socketId} authenticated as user ${userId}`
        );
        next();
      })
      .catch(err => {
        logger.error(
          `[Auth Middleware] ❌❌❌ Socket auth failed for socket ${socketId}`,
          err
        );
        next(new Error('Invalid token'));
      });
  });
}
