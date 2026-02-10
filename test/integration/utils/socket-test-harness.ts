/**
 * Socket.IO integration test harness for cribbage-core.
 * Provides utilities to start a WebSocketServer on an ephemeral port,
 * create authenticated socket.io-client connections, and perform login events.
 */

import { io, type Socket as ClientSocket } from 'socket.io-client';
import { WebSocketServer, type WebSocketServerConfig } from '../../../src/server/WebSocketServer';
import type { LoginData } from '../../../src/server/types';
import type { SupabaseProfile } from '../../../src/services/supabaseService';

export interface TestServer {
  server: WebSocketServer;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export interface TestClient {
  socket: ClientSocket;
  userId: string;
  disconnect: () => void;
  close: () => void;
}

export function waitForSocketConnect(
  client: TestClient,
  timeoutMs: number = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.socket.connected) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      client.socket.off('connect', onConnect);
      client.socket.off('connect_error', onError);
      reject(new Error('Socket connect timeout'));
    }, timeoutMs);

    const onConnect = (): void => {
      clearTimeout(timeout);
      client.socket.off('connect_error', onError);
      resolve();
    };

    const onError = (err: unknown): void => {
      clearTimeout(timeout);
      client.socket.off('connect', onConnect);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    client.socket.once('connect', onConnect);
    client.socket.once('connect_error', onError);
  });
}

export function waitForSocketEvent<T = unknown>(
  client: TestClient,
  eventName: string,
  timeoutMs: number = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.socket.off(eventName, onEvent);
      reject(new Error(`Event ${eventName} timeout`));
    }, timeoutMs);

    const onEvent = (data: T): void => {
      clearTimeout(timeout);
      resolve(data);
    };

    client.socket.once(eventName, onEvent);
  });
}

export function emitWithAck<TResponse = any>(
  client: TestClient,
  eventName: string,
  data: any,
  timeoutMs: number = 5000
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Ack timeout for ${eventName}`));
    }, timeoutMs);

    client.socket.emit(eventName, data, (response: any) => {
      clearTimeout(timeout);
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response as TResponse);
    });
  });
}

export interface TestClientOptions {
  userId: string;
  accessToken?: string;
  profile?: SupabaseProfile;
}

/**
 * Start a WebSocketServer on an ephemeral port (port 0).
 * The OS will assign an available port.
 */
export async function startTestServer(
  config: Partial<WebSocketServerConfig> = {}
): Promise<TestServer> {
  // Set up environment variables if not already set
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = 'http://localhost:54321';
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  }

  const serverConfig: WebSocketServerConfig = {
    port: 0, // Ephemeral port
    webAppOrigin: config.webAppOrigin || 'http://localhost:3000',
    supabaseLobbiesEnabled: config.supabaseLobbiesEnabled ?? true,
  };

  const server = new WebSocketServer(serverConfig);

  return new Promise((resolve, reject) => {
    // Access private httpServer via type assertion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpServer = (server as any).httpServer as import('http').Server;
    if (!httpServer) {
      reject(new Error('HTTP server not initialized'));
      return;
    }

    // Listen on ephemeral port (0) to get an available port
    httpServer.listen(0, () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const port = address.port;
      const url = `http://localhost:${port}`;

      const stop = async (): Promise<void> => {
        try {
          // Stop LobbyManager cleanup interval to prevent Jest from hanging
          const lobbyManager = (server as any).lobbyManager;
          if (lobbyManager?.stop) {
            lobbyManager.stop();
          }
          // Close Socket.IO first; disconnect handlers may add grace timers.
          // Clear those timers in the io.close callback (after all disconnects processed).
          const io = (server as any).io as import('socket.io').Server | undefined;
          const disconnectGraceTimeouts = (server as any)
            .disconnectGraceTimeouts as Map<string, NodeJS.Timeout> | undefined;

          if (io) {
            await new Promise<void>((resolve) => {
              io.close(() => {
                // Clear timers AFTER io closed - disconnect handlers run during close
                // and may add new timers; clear them now to avoid "log after tests done"
                if (disconnectGraceTimeouts) {
                  disconnectGraceTimeouts.forEach((t) => clearTimeout(t));
                  disconnectGraceTimeouts.clear();
                }
                resolve();
              });
            });
          } else if (disconnectGraceTimeouts) {
            disconnectGraceTimeouts.forEach((t) => clearTimeout(t));
            disconnectGraceTimeouts.clear();
          }
        } catch {
          // ignore best-effort close failures
        }

        return new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      };

      resolve({
        server,
        port,
        url,
        stop,
      });
    });
  });
}

/**
 * Create a socket.io-client connection with authentication token.
 * The client is connected but not yet logged in.
 */
export function createTestClient(
  serverUrl: string,
  options: TestClientOptions
): TestClient {
  const { userId, accessToken = `test-token-${userId}`, profile } = options;

  const socket = io(serverUrl, {
    auth: {
      accessToken,
    },
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: false,
  });

  const disconnect = (): void => {
    socket.disconnect();
  };

  const close = (): void => {
    socket.close();
  };

  return {
    socket,
    userId,
    disconnect,
    close,
  };
}

/**
 * Perform login event on a test client.
 * Returns a promise that resolves when login is acknowledged or rejects on error.
 */
export function loginClient(
  client: TestClient,
  loginData: LoginData = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Login timeout'));
    }, 5000);

    const onLoggedIn = (): void => {
      clearTimeout(timeout);
      client.socket.off('loginRejected', onLoginRejected);
      resolve();
    };

    const onLoginRejected = (error: { reason?: string; message?: string }): void => {
      clearTimeout(timeout);
      client.socket.off('loggedIn', onLoggedIn);
      reject(new Error(error.message || error.reason || 'Login rejected'));
    };

    client.socket.once('loggedIn', onLoggedIn);
    client.socket.once('loginRejected', onLoginRejected);

    client.socket.emit('login', loginData);
  });
}

/**
 * Clean up test clients by disconnecting all sockets.
 */
export function cleanupClients(clients: TestClient[]): void {
  clients.forEach(client => {
    if (client.socket.connected) {
      client.disconnect();
    }
    client.close();
  });
}

/**
 * Clean up test server and clients.
 */
export async function cleanup(
  server: TestServer | null,
  clients: TestClient[] = []
): Promise<void> {
  cleanupClients(clients);

  if (server) {
    await server.stop();
  }
}

/**
 * Helper to create a test user profile.
 */
export function createTestProfile(
  userId: string,
  overrides: Partial<SupabaseProfile> = {}
): SupabaseProfile {
  return {
    id: userId,
    username: overrides.username || `testuser-${userId.slice(0, 8)}`,
    display_name: overrides.display_name || `Test User ${userId.slice(0, 8)}`,
    avatar_url: overrides.avatar_url ?? null,
    friend_code: overrides.friend_code || `FC${userId.slice(0, 6).toUpperCase()}`,
  };
}
