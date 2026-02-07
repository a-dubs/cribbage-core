import { WebSocketServer, WebSocketServerConfig } from './WebSocketServer';

/**
 * Create and start a WebSocket server with the given configuration
 */
export function startWebSocketServer(config: WebSocketServerConfig): void {
  const server = new WebSocketServer(config);
  server.start();
}

export { WebSocketServer, type WebSocketServerConfig } from './WebSocketServer';
