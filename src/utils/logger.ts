// Node.js detection - must be done before any dynamic requires
const isNode =
  typeof process !== 'undefined' && typeof process.versions?.node === 'string';

// Node.js modules - only loaded in Node environment to avoid bundler issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fs: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let path: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let util: any;
let logFilePath: string | undefined;

if (isNode) {
  try {
    // Dynamic requires to avoid bundler trying to include these in client builds
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    path = require('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    util = require('util');

    const baseDir =
      typeof __dirname !== 'undefined'
        ? __dirname
        : process.cwd?.() ?? undefined;

    // Configuration from environment
    const LOG_DIR =
      process.env.LOG_DIR ||
      (baseDir ? path.join(baseDir, '../../logs') : undefined);

    // Create a timestamped log file name for each run
    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    const DEFAULT_LOG_FILE = `server-${timestamp}.log`;
    const LOG_FILE = process.env.LOG_FILE || DEFAULT_LOG_FILE;

    // Ensure log directory exists
    if (LOG_DIR) {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }
      logFilePath = path.join(LOG_DIR, LOG_FILE);
    }
  } catch (e) {
    // Failed to load Node modules - running in browser/RN environment
  }
}

const DEBUG_LOGGING =
  typeof process !== 'undefined' &&
  (process.env?.DEBUG_LOGGING === 'true' || process.env?.DEBUG !== undefined);

/**
 * Get current timestamp in ISO format
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format message with arguments (browser-compatible fallback for util.format)
 */
function formatMessage(message: string, ...args: any[]): string {
  if (args.length === 0) return message;

  // Use util.format if available (Node.js), otherwise simple fallback
  if (util && typeof util.format === 'function') {
    return util.format(message, ...args);
  }

  // Simple browser-compatible fallback
  let result = message;
  for (const arg of args) {
    const replacement =
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    result += ' ' + replacement;
  }
  return result;
}

/**
 * Write to both console and log file
 */
function writeLog(level: string, message: string, ...args: any[]): void {
  const timestamp = getTimestamp();
  const formattedMessage = `[${timestamp}] [${level}] ${message}`;

  // Console output (with color for level)
  const consoleMethod =
    level === 'ERROR'
      ? console.error
      : level === 'WARN'
      ? console.warn
      : console.log;

  // Format with arguments
  const fullMessage = formatMessage(formattedMessage, ...args);

  consoleMethod(fullMessage);

  // File output (Node.js only)
  if (isNode && logFilePath && fs) {
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
  error: (message: string, ...args: any[]) =>
    writeLog('ERROR', message, ...args),
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
  logPendingRequests: (requests: Array<{ name: string; type: string }>) => {
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
  logAgentDuration: (
    type: 'MOVE' | 'DISCARD',
    playerName: string,
    durationMs: number
  ) => {
    const message = `[${type}] ${playerName} duration=${durationMs}ms`;
    writeLog('INFO', message);
  },

  /**
   * Redirects debug module output to our logger (Node.js only)
   */
  captureDebugLogs: () => {
    // This only works in Node.js environment
    if (!isNode) return;

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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const requireCache = require.cache;
      Object.keys(requireCache).forEach(key => {
        if (key.includes('/node_modules/debug/')) {
          try {
            const m = requireCache[key];
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
      Module.prototype.require = function (modulePath: string) {
        // eslint-disable-next-line prefer-rest-params
        const exports = originalRequire.apply(this, arguments as any);
        if (
          modulePath === 'debug' ||
          modulePath.endsWith('/node_modules/debug/src/index.js') ||
          modulePath.endsWith('/node_modules/debug/src/node.js')
        ) {
          override(exports);
        }
        return exports;
      };
    } catch (e) {
      // If we can't hook require, just try a normal require as a fallback
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        override(require('debug'));
      } catch (e2) {
        // debug module not available
      }
    }

    // 3. Ensure debug is enabled if DEBUG env var is set
    if (process.env.DEBUG) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const debug = require('debug');
        debug.enable(process.env.DEBUG);
      } catch (e) {
        // debug module not available
      }
    }
  },
};
