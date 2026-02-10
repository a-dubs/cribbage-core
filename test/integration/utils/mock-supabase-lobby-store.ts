/**
 * Minimal in-memory mock lobby store for integration tests.
 * Provides basic lobby CRUD operations without requiring a real Supabase instance.
 */

import type {
  LobbyPayload,
  LobbyRecord,
  LobbyPlayer,
  LobbyVisibility,
  LobbyStatus,
} from '../../../src/services/supabaseService';

export interface MockLobbyStore {
  lobbies: Map<string, LobbyRecord>;
  lobbyPlayers: Map<string, Set<string>>; // lobbyId -> Set<playerId>
  playerLobbies: Map<string, string>; // playerId -> lobbyId
}

export function createMockLobbyStore(): MockLobbyStore {
  return {
    lobbies: new Map(),
    lobbyPlayers: new Map(),
    playerLobbies: new Map(),
  };
}

export function createMockLobbyRecord(
  overrides: Partial<LobbyRecord> = {}
): LobbyRecord {
  const id = overrides.id || `lobby-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    name: overrides.name ?? null,
    host_id: overrides.host_id ?? null,
    max_players: overrides.max_players ?? 2,
    current_players: overrides.current_players ?? 0,
    status: overrides.status ?? 'waiting',
    visibility: overrides.visibility ?? 'public',
    invite_code: overrides.invite_code ?? null,
    is_fixed_size: overrides.is_fixed_size ?? true,
    created_at: overrides.created_at ?? new Date().toISOString(),
    started_at: overrides.started_at ?? null,
    settings: overrides.settings ?? null,
  };
}

export function createMockLobbyPayload(
  store: MockLobbyStore,
  lobbyId: string,
  playerProfiles: Map<string, { displayName: string }>
): LobbyPayload | null {
  const lobby = store.lobbies.get(lobbyId);
  if (!lobby) return null;

  const playerIds = store.lobbyPlayers.get(lobbyId) || new Set();
  const players: LobbyPlayer[] = Array.from(playerIds).map(playerId => ({
    playerId,
    displayName: playerProfiles.get(playerId)?.displayName || `Player ${playerId.slice(0, 8)}`,
  }));

  return {
    ...lobby,
    players,
  };
}

export function addPlayerToLobby(
  store: MockLobbyStore,
  lobbyId: string,
  playerId: string
): void {
  if (!store.lobbies.has(lobbyId)) {
    throw new Error('LOBBY_NOT_FOUND');
  }

  const lobby = store.lobbies.get(lobbyId)!;
  if (lobby.status !== 'waiting') {
    throw new Error('LOBBY_LOCKED');
  }

  if (lobby.is_fixed_size && lobby.current_players >= lobby.max_players) {
    throw new Error('LOBBY_FULL');
  }

  // Check if player is already in a different lobby
  const existingLobbyId = store.playerLobbies.get(playerId);
  if (existingLobbyId && existingLobbyId !== lobbyId) {
    throw new Error('ALREADY_IN_LOBBY');
  }

  // Add player to lobby
  if (!store.lobbyPlayers.has(lobbyId)) {
    store.lobbyPlayers.set(lobbyId, new Set());
  }
  store.lobbyPlayers.get(lobbyId)!.add(playerId);
  store.playerLobbies.set(playerId, lobbyId);

  // Update lobby current_players count
  lobby.current_players = store.lobbyPlayers.get(lobbyId)!.size;
}

export function removePlayerFromLobby(
  store: MockLobbyStore,
  lobbyId: string,
  playerId: string
): void {
  const lobby = store.lobbies.get(lobbyId);
  if (!lobby) return;

  const players = store.lobbyPlayers.get(lobbyId);
  if (!players || !players.has(playerId)) return;

  players.delete(playerId);
  store.playerLobbies.delete(playerId);

  lobby.current_players = players.size;

  // If lobby is empty, mark as finished
  if (players.size === 0) {
    lobby.status = 'finished';
  } else if (lobby.host_id === playerId && players.size > 0) {
    // Transfer host to first remaining player
    const newHostId = Array.from(players)[0];
    lobby.host_id = newHostId;
  }
}

export function createLobbyInStore(
  store: MockLobbyStore,
  params: {
    hostId: string;
    name?: string | null;
    maxPlayers: number;
    isFixedSize: boolean;
    visibility: LobbyVisibility;
    settings?: Record<string, unknown> | null;
  }
): LobbyRecord {
  // Check if host is already in a lobby
  const existingLobbyId = store.playerLobbies.get(params.hostId);
  if (existingLobbyId) {
    throw new Error('ALREADY_IN_LOBBY');
  }

  const lobby = createMockLobbyRecord({
    host_id: params.hostId,
    name: params.name ?? null,
    max_players: params.maxPlayers,
    is_fixed_size: params.isFixedSize,
    visibility: params.visibility,
    settings: params.settings ?? null,
    current_players: 0,
  });

  store.lobbies.set(lobby.id, lobby);
  store.lobbyPlayers.set(lobby.id, new Set());
  addPlayerToLobby(store, lobby.id, params.hostId);

  return lobby;
}

export function getLobbyFromStore(
  store: MockLobbyStore,
  lobbyId: string
): LobbyRecord | null {
  return store.lobbies.get(lobbyId) || null;
}

export function getPlayerActiveLobbyIdFromStore(
  store: MockLobbyStore,
  playerId: string,
  excludeLobbyId?: string
): string | null {
  const lobbyId = store.playerLobbies.get(playerId);
  if (!lobbyId) return null;

  if (excludeLobbyId && lobbyId === excludeLobbyId) {
    return null;
  }

  const lobby = store.lobbies.get(lobbyId);
  if (!lobby || (lobby.status !== 'waiting' && lobby.status !== 'in_progress')) {
    return null;
  }

  return lobbyId;
}

export function clearMockLobbyStore(store: MockLobbyStore): void {
  store.lobbies.clear();
  store.lobbyPlayers.clear();
  store.playerLobbies.clear();
}
