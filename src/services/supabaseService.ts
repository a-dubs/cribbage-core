import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type GameEvent, type GameSnapshot, type GameState } from '../types';

export type SupabaseProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  friend_code: string | null;
};

export type LobbyVisibility = 'public' | 'private' | 'friends';
export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';
export type Friendship = { user_id: string; friend_id: string; created_at: string };
export type FriendRequest = {
  id: string;
  sender_id: string;
  recipient_id: string;
  status: FriendRequestStatus;
  created_at: string;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment is not fully configured');
  }
}

export function toUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_REGEX.test(value) ? value : null;
}

export function getServiceClient(): SupabaseClient {
  ensureEnv();
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return serviceClient;
}

function getAnonClient(): SupabaseClient {
  ensureEnv();
  if (!anonClient) {
    anonClient = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return anonClient;
}

function authClientForToken(token: string): SupabaseClient {
  ensureEnv();
  return createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function generateFriendCode(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; email?: string }> {
  const client = authClientForToken(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error('Invalid or expired token');
  }
  return { userId: data.user.id, email: data.user.email ?? undefined };
}

export async function signUpWithEmail(params: {
  email: string;
  password: string;
  username: string;
  displayName: string;
}): Promise<{ accessToken: string; refreshToken: string; userId: string; profile: SupabaseProfile }> {
  const svc = getServiceClient();
  const anon = getAnonClient();

  const { data: createdUser, error: createError } = await svc.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
  });

  if (createError || !createdUser?.user) {
    throw new Error(createError?.message ?? 'Failed to create user');
  }

  const userId = createdUser.user.id;
  const friendCode = generateFriendCode();

  const { error: profileError, data: profileInsert } = await svc
    .from('profiles')
    .insert({
      id: userId,
      username: params.username,
      display_name: params.displayName,
      friend_code: friendCode,
    })
    .select()
    .single();

  if (profileError || !profileInsert) {
    throw new Error(profileError?.message ?? 'Failed to create profile');
  }

  // Generate a session for convenience
  const { data: loginData, error: loginError } = await anon.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });

  if (loginError || !loginData.session) {
    throw new Error(loginError?.message ?? 'Failed to sign in after signup');
  }

  const session = loginData.session;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId,
    profile: profileInsert as SupabaseProfile,
  };
}

export async function signInWithEmail(params: {
  email: string;
  password: string;
}): Promise<{ accessToken: string; refreshToken: string; userId: string; profile: SupabaseProfile | null }> {
  const anon = getAnonClient();
  const svc = getServiceClient();
  const { data, error } = await anon.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });

  if (error || !data.session || !data.user) {
    throw new Error(error?.message ?? 'Invalid credentials');
  }

  const userId = data.user.id;
  const profile = await getProfile(userId, svc);

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    userId,
    profile,
  };
}

export async function getProfile(userId: string, client: SupabaseClient = getServiceClient()): Promise<SupabaseProfile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as SupabaseProfile | null) ?? null;
}

export type LobbyRecord = {
  id: string;
  name: string | null;
  host_id: string | null;
  max_players: number;
  current_players: number;
  status: 'waiting' | 'in_progress' | 'finished';
  visibility: LobbyVisibility;
  invite_code: string | null;
  is_fixed_size: boolean;
  created_at: string;
  started_at: string | null;
  settings: Record<string, unknown> | null;
};

export type LobbyPlayer = {
  playerId: string;
  displayName: string;
};

export type LobbyPayload = LobbyRecord & { players: LobbyPlayer[] };

async function fetchLobbyPlayers(lobbyId: string, client: SupabaseClient): Promise<LobbyPlayer[]> {
  const { data, error } = await client
    .from('lobby_players')
    .select(
      `
        player_id,
        profiles ( display_name )
      `
    )
    .eq('lobby_id', lobbyId);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as any[];
  return rows.map(row => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const displayName = profile?.display_name ?? 'Unknown';
    return {
      playerId: String(row.player_id),
      displayName,
    };
  });
}

export async function listLobbies(): Promise<LobbyPayload[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('lobbies')
    .select('*')
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const lobbies = (data ?? []) as LobbyRecord[];
  const results: LobbyPayload[] = [];
  for (const lobby of lobbies) {
    const players = await fetchLobbyPlayers(lobby.id, client);
    results.push({ ...lobby, players });
  }
  return results;
}

export async function createLobby(params: {
  hostId: string;
  name?: string | null;
  maxPlayers: number;
  isFixedSize: boolean;
  visibility: LobbyVisibility;
  settings?: Record<string, unknown> | null;
}): Promise<LobbyPayload> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('lobbies')
    .insert({
      name: params.name,
      host_id: params.hostId,
      max_players: params.maxPlayers,
      is_fixed_size: params.isFixedSize,
      visibility: params.visibility,
      settings: params.settings ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create lobby');
  }

  // Add host to lobby players
  const insertPlayer = await client
    .from('lobby_players')
    .insert({ lobby_id: data.id, player_id: params.hostId })
    .select('player_id')
    .single();

  if (insertPlayer.error) {
    throw new Error(insertPlayer.error.message);
  }

  const players = await fetchLobbyPlayers(data.id, client);
  return { ...(data as LobbyRecord), players };
}

export async function joinLobby(params: {
  lobbyId: string;
  playerId: string;
  inviteCode?: string | null;
}): Promise<LobbyPayload> {
  const client = getServiceClient();
  const { data: lobby, error: lobbyError } = await client.from('lobbies').select('*').eq('id', params.lobbyId).single();
  if (lobbyError || !lobby) {
    throw new Error('LOBBY_NOT_FOUND');
  }

  const lobbyRecord = lobby as LobbyRecord;

  if (lobbyRecord.status !== 'waiting') {
    throw new Error('LOBBY_LOCKED');
  }

  if (lobbyRecord.is_fixed_size && lobbyRecord.current_players >= lobbyRecord.max_players) {
    throw new Error('LOBBY_FULL');
  }

  if (lobbyRecord.visibility === 'private' && lobbyRecord.invite_code && params.inviteCode !== lobbyRecord.invite_code) {
    throw new Error('INVALID_INVITE');
  }

  // Check existing membership
  const existing = await client
    .from('lobby_players')
    .select('id')
    .eq('lobby_id', params.lobbyId)
    .eq('player_id', params.playerId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(existing.error.message);
  }
  if (existing.data) {
    // Already in lobby: return current lobby state
    const players = await fetchLobbyPlayers(lobbyRecord.id, client);
    return { ...lobbyRecord, players };
  }

  const insertPlayer = await client
    .from('lobby_players')
    .insert({ lobby_id: lobbyRecord.id, player_id: params.playerId })
    .select('player_id')
    .single();

  if (insertPlayer.error) {
    throw new Error(insertPlayer.error.message);
  }

  const players = await fetchLobbyPlayers(lobbyRecord.id, client);
  return { ...lobbyRecord, players };
}

export async function leaveLobby(params: { lobbyId: string; playerId: string }): Promise<void> {
  const client = getServiceClient();
  const { error } = await client
    .from('lobby_players')
    .delete()
    .eq('lobby_id', params.lobbyId)
    .eq('player_id', params.playerId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function listFriends(userId: string): Promise<SupabaseProfile[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('friendships')
    .select(
      `
      user_id,
      friend_id,
      friend_profile:profiles!friend_id(id, username, display_name, avatar_url, friend_code),
      user_profile:profiles!user_id(id, username, display_name, avatar_url, friend_code)
    `
    )
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as any[];
  const profiles: SupabaseProfile[] = [];
  rows.forEach(row => {
    const friend =
      row.friend_id === userId
        ? row.user_profile
        : row.friend_profile;
    if (friend) {
      profiles.push({
        id: friend.id,
        username: friend.username,
        display_name: friend.display_name,
        avatar_url: friend.avatar_url,
        friend_code: friend.friend_code,
      });
    }
  });
  return profiles;
}

export async function listFriendRequests(userId: string): Promise<{
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('friend_requests')
    .select('*')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);

  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as FriendRequest[];
  return {
    incoming: rows.filter(r => r.recipient_id === userId),
    outgoing: rows.filter(r => r.sender_id === userId),
  };
}

export async function sendFriendRequest(params: {
  senderId: string;
  recipientUsername: string;
}): Promise<FriendRequest> {
  const client = getServiceClient();
  const { data: recipientProfile, error: profileError } = await client
    .from('profiles')
    .select('id')
    .eq('username', params.recipientUsername)
    .maybeSingle();
  if (profileError) {
    throw new Error(profileError.message);
  }
  if (!recipientProfile?.id) {
    throw new Error('NOT_FOUND');
  }
  const { data, error } = await client
    .from('friend_requests')
    .insert({
      sender_id: params.senderId,
      recipient_id: recipientProfile.id,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to send request');
  }
  return data as FriendRequest;
}

export async function respondToFriendRequest(params: {
  requestId: string;
  recipientId: string;
  accept: boolean;
}): Promise<void> {
  const client = getServiceClient();
  const status: FriendRequestStatus = params.accept ? 'accepted' : 'declined';
  const { error } = await client
    .from('friend_requests')
    .update({ status })
    .eq('id', params.requestId)
    .eq('recipient_id', params.recipientId);
  if (error) {
    throw new Error(error.message);
  }
  if (status === 'accepted') {
    // Create friendship row (canonical ordering handled by trigger)
    const sender = await client
      .from('friend_requests')
      .select('sender_id')
      .eq('id', params.requestId)
      .single();
    if (sender.error || !sender.data?.sender_id) {
      throw new Error(sender.error?.message ?? 'Failed to lookup sender');
    }
    await client.from('friendships').insert({
      user_id: params.recipientId,
      friend_id: sender.data.sender_id as string,
    });
  }
}

export async function getProfileFromToken(token: string): Promise<SupabaseProfile | null> {
  const { userId } = await verifyAccessToken(token);
  return getProfile(userId);
}

type GamePlayerInput = {
  playerId: string | null;
  playerName: string;
};

type PersistedEvent = {
  event: GameEvent;
  snapshot?: GameSnapshot;
  storeSnapshot?: boolean;
};

export type GameListRow = {
  game: any;
  player: {
    player_id: string;
    player_name: string;
    final_score: number;
    is_winner: boolean;
  };
};

export async function createGameRecord(params: {
  lobbyId?: string | null;
  players: GamePlayerInput[];
  initialState?: GameState | null;
  startedAt?: Date;
}): Promise<string> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('games')
    .insert({
      lobby_id: params.lobbyId ?? null,
      started_at: (params.startedAt ?? new Date()).toISOString(),
      game_state: params.initialState ?? null,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Failed to create game record');
  }

  if (params.players.length > 0) {
    const payload = params.players.map(player => ({
      game_id: data.id,
      player_id: toUuidOrNull(player.playerId),
      player_name: player.playerName,
    }));
    const { error: playerError } = await client.from('game_players').insert(payload);
    if (playerError) {
      throw new Error(playerError.message);
    }
  }

  return data.id as string;
}

export async function persistGameEvents(params: {
  gameId: string;
  events: PersistedEvent[];
}): Promise<void> {
  if (!params.events.length) return;
  const client = getServiceClient();
  const rows = params.events.map(({ event }) => ({
    game_id: params.gameId,
    snapshot_id: event.snapshotId,
    phase: event.phase,
    action_type: event.actionType,
    player_id: toUuidOrNull(event.playerId ?? undefined),
    cards: event.cards ?? null,
    score_change: event.scoreChange ?? 0,
    score_breakdown: event.scoreBreakdown ?? null,
    timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date(event.timestamp).toISOString(),
  }));

  const { data, error } = await client.from('game_events').insert(rows).select('id, snapshot_id');
  if (error) {
    throw new Error(error.message);
  }

  const snapshotsPayload: Array<{ game_id: string; snapshot_id: number; game_state: GameState; game_event_id: string }> = [];
  if (data) {
    data.forEach((insertedRow: any, index: number) => {
      const config = params.events[index];
      if (!config?.storeSnapshot || !config.snapshot) return;
      snapshotsPayload.push({
        game_id: params.gameId,
        snapshot_id: insertedRow.snapshot_id ?? config.event.snapshotId,
        game_state: config.snapshot.gameState,
        game_event_id: insertedRow.id as string,
      });
    });
  }

  if (snapshotsPayload.length > 0) {
    const { error: snapError } = await client.from('game_snapshots').insert(snapshotsPayload);
    if (snapError) {
      throw new Error(snapError.message);
    }
  }
}

export async function completeGameRecord(params: {
  gameId: string;
  winnerId?: string | null;
  finalState?: GameState | null;
  finalScores?: Array<{ playerId: string | null; playerName: string; score: number; isWinner?: boolean }>;
  roundCount?: number;
  endedAt?: Date;
}): Promise<void> {
  const client = getServiceClient();
  const { error } = await client
    .from('games')
    .update({
      ended_at: (params.endedAt ?? new Date()).toISOString(),
      winner_id: toUuidOrNull(params.winnerId ?? undefined),
      round_count: params.roundCount ?? null,
      final_scores: params.finalScores ?? null,
      game_state: params.finalState ?? null,
    })
    .eq('id', params.gameId);
  if (error) {
    throw new Error(error.message);
  }

  if (params.finalScores?.length) {
    for (const score of params.finalScores) {
      const matchFilter = toUuidOrNull(score.playerId ?? undefined)
        ? { game_id: params.gameId, player_id: toUuidOrNull(score.playerId ?? undefined) }
        : { game_id: params.gameId, player_name: score.playerName };
      const { error: updateError } = await client
        .from('game_players')
        .update({
          final_score: score.score,
          is_winner: Boolean(score.isWinner),
        })
        .match(matchFilter);
      if (updateError) {
        throw new Error(updateError.message);
      }
    }
  }
}

async function ensureGameMembership(gameId: string, userId: string): Promise<void> {
  const client = getServiceClient();
  const membership = await client
    .from('game_players')
    .select('id')
    .eq('game_id', gameId)
    .eq('player_id', userId)
    .maybeSingle();
  if (membership.error) {
    throw new Error(membership.error.message);
  }
  if (!membership.data) {
    throw new Error('NOT_AUTHORIZED');
  }
}

export async function listUserGames(userId: string): Promise<GameListRow[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('game_players')
    .select(
      `
        player_id,
        player_name,
        final_score,
        is_winner,
        game:games (*)
      `
    )
    .eq('player_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as any[];
  return rows.map(row => ({
    game: row.game,
    player: {
      player_id: row.player_id,
      player_name: row.player_name,
      final_score: row.final_score,
      is_winner: row.is_winner,
    },
  }));
}

export async function getGameEventsForUser(gameId: string, userId: string): Promise<any[]> {
  await ensureGameMembership(gameId, userId);
  const client = getServiceClient();
  const { data, error } = await client
    .from('game_events')
    .select('*')
    .eq('game_id', gameId)
    .order('snapshot_id', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getGameSnapshotsForUser(gameId: string, userId: string): Promise<any[]> {
  await ensureGameMembership(gameId, userId);
  const client = getServiceClient();
  const { data, error } = await client
    .from('game_snapshots')
    .select('*')
    .eq('game_id', gameId)
    .order('snapshot_id', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}
