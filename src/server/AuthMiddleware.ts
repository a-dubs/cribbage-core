import { Server } from 'socket.io';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../services/supabaseService';

/**
 * Applies Socket.IO authentication middleware to the server.
 * When SUPABASE_AUTH_ENABLED is true, requires a valid Supabase JWT access token
 * in the socket handshake auth.accessToken field.
 *
 * @param io - The Socket.IO Server instance
 */
export function applyAuthMiddleware(io: Server): void {
  const SUPABASE_AUTH_ENABLED = process.env.SUPABASE_AUTH_ENABLED === 'true';

  io.use((socket, next) => {
    // Direct console.log to verify middleware is being called
    console.log('>>> AUTH MIDDLEWARE CALLED <<<', socket.id);
    const socketId = socket.id || 'pending';
    logger.info(
      `[Auth Middleware] 🔐 Processing connection for socket ${socketId}`,
      {
        hasAuth: !!socket.handshake.auth,
        authKeys: socket.handshake.auth ? Object.keys(socket.handshake.auth) : [],
        authValues: socket.handshake.auth,
        origin: socket.handshake.headers.origin,
        SUPABASE_AUTH_ENABLED,
      }
    );

    if (!SUPABASE_AUTH_ENABLED) {
      logger.info(
        `[Auth Middleware] ✅ Auth disabled, allowing connection for socket ${socketId}`
      );
      return next();
    }
    const token = (socket.handshake.auth as { accessToken?: string } | undefined)
      ?.accessToken;
    if (!token) {
      logger.warn(
        `[Auth Middleware] ❌ Missing access token from socket ${socketId}`,
        {
          handshakeAuth: socket.handshake.auth,
        }
      );
      return next(new Error('Missing access token'));
    }

    logger.info(`[Auth Middleware] 🔍 Verifying token for socket ${socketId}`, {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 20) + '...',
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
        const tokenPreview =
          token.length > 20 ? `${token.substring(0, 20)}...` : token;
        logger.error(
          `[Auth Middleware] ❌❌❌ Socket auth failed for socket ${socketId}. Token preview: ${tokenPreview}`,
          err
        );
        next(new Error('Invalid token'));
      });
  });
}
