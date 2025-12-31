import dotenv from 'dotenv';
import { logger } from './logger';

// Load environment variables
dotenv.config();

// Initialize logger interceptors to capture debug logs as early as possible
logger.captureDebugLogs();



