import fs from 'fs';
import path from 'path';

const isNode =
  typeof process !== 'undefined' && typeof process.versions?.node === 'string';
const baseDir = isNode
  ? typeof __dirname !== 'undefined'
    ? __dirname
    : process.cwd?.() ?? undefined
  : undefined;

// Configuration from environment
const LOG_DIR =
  process.env.LOG_DIR || (baseDir ? path.join(baseDir, '../../logs') : undefined);
const LOG_FILE = process.env.LOG_FILE || 'server.log';
const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true';

// Ensure log directory exists when running in Node
if (isNode && LOG_DIR) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

const logFilePath =
  isNode && LOG_DIR ? path.join(LOG_DIR, LOG_FILE) : undefined;

/**
 * Get current timestamp in ISO format
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Write to both console and log file
 */
function writeLog(level: string, message: string, ...args: any[]): void {
  const timestamp = getTimestamp();
  const formattedMessage = `[${timestamp}] [${level}] ${message}`;
  
  // Console output (with color for level)
  const consoleMethod = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleMethod(formattedMessage, ...args);
  
  // File output
  if (logFilePath) {
    try {
      const fileMessage = args.length > 0 
        ? `${formattedMessage} ${JSON.stringify(args)}`
        : formattedMessage;
      fs.appendFileSync(logFilePath, `${fileMessage}\n`, 'utf-8');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }
}

export const logger = {
  info: (message: string, ...args: any[]) => writeLog('INFO', message, ...args),
  warn: (message: string, ...args: any[]) => writeLog('WARN', message, ...args),
  error: (message: string, ...args: any[]) => writeLog('ERROR', message, ...args),
  debug: (message: string, ...args: any[]) => {
    if (DEBUG_LOGGING) {
      writeLog('DEBUG', message, ...args);
    }
  },
  
  /**
   * Log a game event with concise format
   * [EVENT] <playerName> action=<ACTION_TYPE> points=<+/-N>
   */
  logGameEvent: (playerName: string, actionType: string, points: number) => {
    const sign = points >= 0 ? '+' : '';
    const message = `[EVENT] ${playerName} action=${actionType} points=${sign}${points}`;
    writeLog('INFO', message);
  },
  
  /**
   * Log current game state with concise format
   * [STATE] round=<R> phase=<PHASE> snapshot=<ID>
   */
  logGameState: (roundNumber: number, phase: string, snapshotId: string) => {
    const message = `[STATE] round=${roundNumber} phase=${phase} snapshot=${snapshotId}`;
    writeLog('INFO', message);
  },
  
  /**
   * Log pending decision requests with concise format
   * [WAITING] <name>(<TYPE>), <name>(<TYPE>)
   */
  logPendingRequests: (requests: Array<{name: string; type: string}>) => {
    if (requests.length === 0) {
      writeLog('INFO', '[WAITING] none');
      return;
    }
    const requestsStr = requests.map(r => `${r.name}(${r.type})`).join(', ');
    const message = `[WAITING] ${requestsStr}`;
    writeLog('INFO', message);
  },
  
  /**
   * Log agent call duration
   * [MOVE] <playerName> duration=<ms>ms
   * [DISCARD] <playerName> duration=<ms>ms
   */
  logAgentDuration: (type: 'MOVE' | 'DISCARD', playerName: string, durationMs: number) => {
    const message = `[${type}] ${playerName} duration=${durationMs}ms`;
    writeLog('INFO', message);
  },
};
