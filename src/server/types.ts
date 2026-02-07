import { GameAgent } from '../types';

// Server-specific interfaces
export interface PlayerInfo {
  id: string;
  name: string;
  agent: GameAgent;
}

export interface PlayerInLobby {
  playerId: string;
  displayName: string;
}

export interface Lobby {
  id: string;
  name?: string;
  hostId: string;
  maxPlayers: number; // 2–4
  playerCount?: number; // legacy field
  currentPlayers: number;
  players: PlayerInLobby[]; // humans only; bots are added when starting game
  status: 'waiting' | 'in_progress' | 'finished';
  createdAt: number;
  finishedAt?: number | null;
  disconnectedPlayerIds: string[];
  isFixedSize?: boolean;
}

export interface LoginData {
  // Optional because auth is established at handshake time via middleware.
  // If provided, it must match the middleware-authenticated user.
  accessToken?: string;
}

// Test-only interfaces (only used in non-production environments)
export interface TestResetRequest {
  userId?: string;
  scopes: Array<'lobbies' | 'games' | 'connections' | 'all'>;
}

export interface TestResetResponse {
  success: boolean;
  cleared: {
    lobbies?: number;
    games?: number;
    connections?: number;
    players?: string[];
  };
}

// Server-only constants
export const PLAYER_DISCONNECT_GRACE_MS = 60 * 1000; // 1 minute to reconnect before cancelling the game
export const FINISHED_LOBBY_TTL_MS = 60 * 60 * 1000; // 1 hour retention for finished lobbies before cleanup
export const FINISHED_LOBBY_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // Sweep finished lobbies every 5 minutes
export const STALE_WAITING_LOBBY_MS = 30 * 60 * 1000; // 30 minutes before a waiting lobby with no connections is stale
export const STALE_IN_PROGRESS_LOBBY_MS = 60 * 60 * 1000; // 1 hour before an in-progress lobby with no connections is stale

// Temporary default lobby ID used until full lobby management is implemented
export const DEFAULT_LOBBY_ID = 'default-lobby';
