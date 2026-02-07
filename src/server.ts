import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { startWebSocketServer } from './server/index';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';
const SUPABASE_AUTH_ENABLED = process.env.SUPABASE_AUTH_ENABLED === 'true';
const SUPABASE_LOBBIES_ENABLED =
  process.env.SUPABASE_LOBBIES_ENABLED === 'true';

logger.info('PORT:', PORT);
logger.info('WEB_APP_ORIGIN:', WEB_APP_ORIGIN);

logger.info('cribbage-core server starting...');

startWebSocketServer({
  port: Number(PORT),
  webAppOrigin: WEB_APP_ORIGIN,
  supabaseAuthEnabled: SUPABASE_AUTH_ENABLED,
  supabaseLobbiesEnabled: SUPABASE_LOBBIES_ENABLED,
});
