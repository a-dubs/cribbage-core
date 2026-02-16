import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { startWebSocketServer } from './server/index';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const PORT = process.env.PORT || 3002;
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN || 'http://localhost:3000';

logger.info('PORT:', PORT);
logger.info('WEB_APP_ORIGIN:', WEB_APP_ORIGIN);

logger.info('cribbage-core server starting...');

startWebSocketServer({
  port: Number(PORT),
  webAppOrigin: WEB_APP_ORIGIN,
});
