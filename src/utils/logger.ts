import fs from 'fs';
import path from 'path';
import util from 'util';

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

// Create a timestamped log file name for each run
const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
const DEFAULT_LOG_FILE = `server-${timestamp}.log`;
const LOG_FILE = process.env.LOG_FILE || DEFAULT_LOG_FILE;
const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true' || process.env.DEBUG !== undefined;

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
  
  // Use util.format for better argument handling similar to console.log
  const fullMessage = args.length > 0 
    ? util.format(formattedMessage, ...args)
    : formattedMessage;

  consoleMethod(fullMessage);
  
  // File output
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, `${fullMessage}\n`, 'utf-8');
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

  /**
   * Redirects debug module output to our logger
   */
  captureDebugLogs: () => {
    const override = (debugModule: any) => {
      if (!debugModule) return;
      
      // Some versions of debug export the function directly, 
      // others might have it under .default
      const d = debugModule.default || debugModule;
      
      if (typeof d === 'function' && d.log) {
        d.log = (message: string, ...args: any[]) => {
          // Debug messages already have namespaces and colors/formatting
          // We'll treat them as DEBUG level
          writeLog('DEBUG', message, ...args);
        };
        
        // If DEBUG env var is set, make sure this instance is enabled
        if (process.env.DEBUG && typeof d.enable === 'function') {
          d.enable(process.env.DEBUG);
        }
      }
    };

    // 1. Try to find all debug modules already in the cache
    try {
      Object.keys(require.cache).forEach(key => {
        if (key.includes('/node_modules/debug/')) {
          try {
            const m = require.cache[key];
            if (m) override(m.exports);
          } catch (e) {
            // Ignore errors accessing cache
          }
        }
      });
    } catch (e) {
      // Ignore errors iterating cache
    }

    // 2. Hook into the Module system to catch any future debug loads
    // and any versions we might have missed
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Module = require('module');
      const originalRequire = Module.prototype.require;
      Module.prototype.require = function(path: string) {
        const exports = originalRequire.apply(this, arguments as any);
        if (path === 'debug' || path.endsWith('/node_modules/debug/src/index.js') || path.endsWith('/node_modules/debug/src/node.js')) {
          override(exports);
        }
        return exports;
      };
    } catch (e) {
      // If we can't hook require, just try a normal require as a fallback
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        override(require('debug'));
      } catch (e2) {}
    }

    // 3. Ensure debug is enabled if DEBUG env var is set
    if (process.env.DEBUG) {
      try {
        const debug = require('debug');
        debug.enable(process.env.DEBUG);
      } catch (e) {}
    }
  }
};
