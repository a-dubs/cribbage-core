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
export type LobbyStatus = 'waiting' | 'in_progress' | 'finished';
export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';
export type Friendship = { user_id: string; friend_id: string; created_at: string };
export type FriendRequest = {
  id: string;
  sender_id: string;
  recipient_id: string;
  status: FriendRequestStatus;
  created_at: string;
};
export type FriendRequestWithProfiles = FriendRequest & {
  sender_profile: SupabaseProfile | null;
  recipient_profile: SupabaseProfile | null;
};
export type LobbyInvitation = {
  id: string;
  lobby_id: string;
  sender_id: string;
  recipient_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  created_at: string;
};
export type LobbyInvitationWithLobby = LobbyInvitation & {
  lobbies: LobbyRecord | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Username must match database constraint: lowercase letters, numbers, underscores, and hyphens only, 3-20 chars
const USERNAME_REGEX = /^[a-z0-9_-]{3,20}$/;

function ensureEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment is not fully configured');
  }
}

export function toUuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_REGEX.test(value) ? value : null;
}

/**
 * Validates and normalizes username to match database constraint
 * - Converts to lowercase
 * - Trims whitespace
 * - Validates format: lowercase letters, numbers, underscores only, 3-20 chars
 * @throws Error if username is invalid
 */
function validateAndNormalizeUsername(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error('Username is required');
  }
  
  const normalized = trimmed.toLowerCase();
  
  if (normalized.length < 3 || normalized.length > 20) {
    throw new Error('Username must be between 3 and 20 characters');
  }
  
  if (!USERNAME_REGEX.test(normalized)) {
    throw new Error('Username can only contain lowercase letters, numbers, underscores, and hyphens');
  }
  
  return normalized;
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

/**
 * For testing purposes only: resets the cached service and anon clients.
 */
export function resetServiceClients(): void {
  serviceClient = null;
  anonClient = null;
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

function canonicalizeFriendPair(a: string, b: string): { userId: string; friendId: string } {
  return a < b ? { userId: a, friendId: b } : { userId: b, friendId: a };
}

function publicAvatarUrl(path: string): string {
  const supabase = getServiceClient();
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; email?: string }> {
  const client = authClientForToken(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    // Log more details about the error for debugging
    const errorMessage = error?.message || 'Unknown error';
    const errorStatus = error?.status || 'unknown';
    throw new Error(`Invalid or expired token (status: ${errorStatus}): ${errorMessage}`);
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

  // Validate and normalize username to match database constraint
  const normalizedUsername = validateAndNormalizeUsername(params.username);
  const trimmedDisplayName = params.displayName.trim();
  if (!trimmedDisplayName) {
    throw new Error('DISPLAY_NAME_REQUIRED');
  }

  const { error: profileError, data: profileInsert } = await svc
    .from('profiles')
    .insert({
      id: userId,
      username: normalizedUsername,
      display_name: trimmedDisplayName,
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

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; userId: string; profile: SupabaseProfile | null }> {
  const anon = getAnonClient();
  const svc = getServiceClient();
  const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session || !data.user) {
    throw new Error(error?.message ?? 'Failed to refresh token');
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

/**
 * Check if a player is currently in any active lobby (waiting or in_progress)
 * @param playerId - Player to check
 * @param excludeLobbyId - Optional lobby ID to exclude from check (for idempotent joins)
 * @returns The lobby ID if found, null otherwise
 */
export async function getPlayerActiveLobbyId(
  playerId: string,
  excludeLobbyId?: string
): Promise<string | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('lobby_players')
    .select('lobby_id, lobbies!inner(status)')
    .eq('player_id', playerId)
    .in('lobbies.status', ['waiting', 'in_progress']);

  if (error) {
    throw new Error(error.message);
  }

  if (data && data.length > 0) {
    // If we have an excludeLobbyId, check if any other lobby is active
    if (excludeLobbyId) {
      const otherLobby = data.find((row: any) => row.lobby_id !== excludeLobbyId);
      return otherLobby ? String(otherLobby.lobby_id) : null;
    }
    return String(data[0].lobby_id);
  }

  return null;
}

export type LobbyRecord = {
  id: string;
  name: string | null;
  host_id: string | null;
  max_players: number;
  current_players: number;
  status: LobbyStatus;
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

async function fetchLobbyRecord(lobbyId: string, client: SupabaseClient): Promise<LobbyRecord | null> {
  const { data, error } = await client.from('lobbies').select('*').eq('id', lobbyId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as LobbyRecord | null) ?? null;
}

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
  const results: LobbyPayload[] = await Promise.all(
    lobbies.map(async lobby => {
      const players = await fetchLobbyPlayers(lobby.id, client);
      return { ...lobby, players };
    })
  );
  return results;
}

export async function getLobbyWithPlayers(lobbyId: string): Promise<LobbyPayload | null> {
  const client = getServiceClient();
  const lobby = await fetchLobbyRecord(lobbyId, client);
  if (!lobby) return null;
  const players = await fetchLobbyPlayers(lobbyId, client);
  return { ...lobby, players };
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

  // Check if user is already in an active lobby
  const existingLobbyId = await getPlayerActiveLobbyId(params.hostId);
  if (existingLobbyId) {
    throw new Error('ALREADY_IN_LOBBY');
  }

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

async function ensureLobbyHost(lobbyId: string, hostId: string, client: SupabaseClient): Promise<LobbyRecord> {
  const lobby = await fetchLobbyRecord(lobbyId, client);
  if (!lobby) {
    throw new Error('LOBBY_NOT_FOUND');
  }
  if (lobby.host_id !== hostId) {
    throw new Error('NOT_HOST');
  }
  return lobby;
}

export async function joinLobby(params: {
  lobbyId: string;
  playerId: string;
  inviteCode?: string | null;
}): Promise<LobbyPayload> {
  const client = getServiceClient();

  // Check if player is already in a DIFFERENT active lobby
  const existingLobbyId = await getPlayerActiveLobbyId(
    params.playerId,
    params.lobbyId // Allow if already in THIS lobby (idempotent)
  );
  if (existingLobbyId) {
    throw new Error('ALREADY_IN_LOBBY');
  }

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

export async function leaveLobby(params: { lobbyId: string; playerId: string }): Promise<LobbyPayload | null> {
  const client = getServiceClient();

  // Fetch the lobby first to check if the leaving player is the host
  const lobbyBefore = await fetchLobbyRecord(params.lobbyId, client);
  if (!lobbyBefore) return null;

  const wasHost = lobbyBefore.host_id === params.playerId;

  const { error } = await client.from('lobby_players').delete().eq('lobby_id', params.lobbyId).eq('player_id', params.playerId);
  if (error) {
    throw new Error(error.message);
  }

  const lobby = await fetchLobbyRecord(params.lobbyId, client);
  if (!lobby) return null;

  const players = await fetchLobbyPlayers(params.lobbyId, client);

  // If lobby is empty, mark it as finished
  if ((lobby.current_players ?? 0) === 0) {
    await client.from('lobbies').update({ status: 'finished' }).eq('id', params.lobbyId);
    lobby.status = 'finished';
  } else if (wasHost && players.length > 0) {
    // Transfer host to another player if the host left and there are remaining players
    const newHostId = players[0].playerId;
    const { error: updateError } = await client.from('lobbies').update({ host_id: newHostId }).eq('id', params.lobbyId);
    if (updateError) {
      throw new Error(updateError.message);
    }
    lobby.host_id = newHostId;
  }

  return { ...lobby, players };
}

export async function sendLobbyInvite(params: { lobbyId: string; senderId: string; recipientId: string }): Promise<LobbyInvitation> {
  const client = getServiceClient();
  await ensureLobbyHost(params.lobbyId, params.senderId, client);
  const { data, error } = await client
    .from('lobby_invitations')
    .insert({
      lobby_id: params.lobbyId,
      sender_id: params.senderId,
      recipient_id: params.recipientId,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create invite');
  }
  return data as LobbyInvitation;
}

export async function listLobbyInvitations(userId: string): Promise<{
  incoming: LobbyInvitationWithLobby[];
  outgoing: LobbyInvitationWithLobby[];
}> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('lobby_invitations')
    .select(
      `
      id,
      lobby_id,
      sender_id,
      recipient_id,
      status,
      created_at,
      lobbies!inner(id, name, host_id, max_players, current_players, status, invite_code, is_fixed_size, visibility)
    `
    )
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);

  if (error) {
    throw new Error(error.message);
  }
  type RawLobbyInvitationRow = LobbyInvitation & {
    lobbies: LobbyRecord[] | LobbyRecord | null;
  };
  const rows = ((data ?? []) as RawLobbyInvitationRow[])
    .map(row => ({
      ...row,
      lobbies: Array.isArray(row.lobbies) ? row.lobbies[0] ?? null : row.lobbies ?? null,
    })) as LobbyInvitationWithLobby[];
  return {
    incoming: rows.filter(row => row.recipient_id === userId),
    outgoing: rows.filter(row => row.sender_id === userId),
  };
}

export async function respondToLobbyInvitation(params: {
  invitationId: string;
  recipientId: string;
  accept: boolean;
}): Promise<{ invitation: LobbyInvitation; lobby?: LobbyPayload }> {
  const client = getServiceClient();
  const { data: invitation, error: invitationError } = await client
    .from('lobby_invitations')
    .select(
      `
      id,
      lobby_id,
      sender_id,
      recipient_id,
      status,
      created_at,
      lobbies(id, invite_code)
    `
    )
    .eq('id', params.invitationId)
    .single();
  if (invitationError || !invitation) {
    throw new Error(invitationError?.message ?? 'INVITE_NOT_FOUND');
  }
  if (invitation.recipient_id !== params.recipientId) {
    throw new Error('NOT_AUTHORIZED');
  }
  const status: 'accepted' | 'declined' = params.accept ? 'accepted' : 'declined';
  const { error: updateError } = await client
    .from('lobby_invitations')
    .update({ status })
    .eq('id', params.invitationId)
    .eq('recipient_id', params.recipientId);
  if (updateError) {
    throw new Error(updateError.message);
  }
  if (!params.accept) {
    return { invitation: { ...(invitation as LobbyInvitation), status } };
  }
  const lobbyId = invitation.lobby_id as string;
  const lobby = await joinLobby({
    lobbyId,
    playerId: params.recipientId,
    inviteCode: (invitation as any).lobbies?.invite_code ?? undefined,
  });
  return {
    invitation: { ...(invitation as LobbyInvitation), status: 'accepted' },
    lobby,
  };
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

export async function listFriendRequestsWithProfiles(userId: string): Promise<{
  incoming: FriendRequestWithProfiles[];
  outgoing: FriendRequestWithProfiles[];
}> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('friend_requests')
    .select(
      `
      id,
      sender_id,
      recipient_id,
      status,
      created_at,
      sender_profile:profiles!sender_id(id, username, display_name, avatar_url, friend_code),
      recipient_profile:profiles!recipient_id(id, username, display_name, avatar_url, friend_code)
    `
    )
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);

  if (error) {
    throw new Error(error.message);
  }

  type RawFriendRequestWithProfilesRow = FriendRequest & {
    sender_profile: SupabaseProfile[] | SupabaseProfile | null;
    recipient_profile: SupabaseProfile[] | SupabaseProfile | null;
  };
  const rows = ((data ?? []) as RawFriendRequestWithProfilesRow[])
    .map(row => ({
      ...row,
      sender_profile: Array.isArray(row.sender_profile) ? row.sender_profile[0] ?? null : row.sender_profile ?? null,
      recipient_profile: Array.isArray(row.recipient_profile)
        ? row.recipient_profile[0] ?? null
        : row.recipient_profile ?? null,
    })) as FriendRequestWithProfiles[];
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
  
  // Prevent self-friending
  if (params.senderId === recipientProfile.id) {
    throw new Error('CANNOT_ADD_SELF');
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
    const { userId, friendId } = canonicalizeFriendPair(params.recipientId, sender.data.sender_id as string);
    await client.from('friendships').insert({
      user_id: userId,
      friend_id: friendId,
    });
  }
}

export async function removeFriendship(params: { userId: string; friendId: string }): Promise<void> {
  const client = getServiceClient();
  const { userId, friendId } = canonicalizeFriendPair(params.userId, params.friendId);
  const { error } = await client.from('friendships').delete().eq('user_id', userId).eq('friend_id', friendId);
  if (error) {
    throw new Error(error.message);
  }
}

export async function sendFriendRequestFromLobby(params: {
  senderId: string;
  targetUserId: string;
  lobbyId: string;
}): Promise<FriendRequest> {
  const client = getServiceClient();
  
  // Prevent self-friending
  if (params.senderId === params.targetUserId) {
    throw new Error('CANNOT_ADD_SELF');
  }
  
  const membershipCheck = await client
    .from('lobby_players')
    .select('player_id')
    .eq('lobby_id', params.lobbyId)
    .in('player_id', [params.senderId, params.targetUserId]);
  if (membershipCheck.error) {
    throw new Error(membershipCheck.error.message);
  }
  const players = membershipCheck.data ?? [];
  const senderInLobby = players.some(p => p.player_id === params.senderId);
  const targetInLobby = players.some(p => p.player_id === params.targetUserId);
  if (!senderInLobby || !targetInLobby) {
    throw new Error('NOT_IN_LOBBY');
  }
  const { data, error } = await client
    .from('friend_requests')
    .insert({
      sender_id: params.senderId,
      recipient_id: params.targetUserId,
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to send request');
  }
  return data as FriendRequest;
}

export async function searchProfilesByUsername(query: string): Promise<SupabaseProfile[]> {
  const client = getServiceClient();
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    throw new Error('QUERY_TOO_SHORT');
  }
  const { data, error } = await client
    .from('profiles')
    .select('id, username, display_name, avatar_url, friend_code')
    .ilike('username', `${trimmed}%`)
    .limit(20);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as SupabaseProfile[];
}

export async function listPresetAvatars(): Promise<string[]> {
  const client = getServiceClient();
  const { data, error } = await client.storage.from('avatars').list('presets', { limit: 100 });
  if (error) {
    throw new Error(error.message);
  }
  const files = data ?? [];
  return files.filter(f => f.name).map(file => publicAvatarUrl(`presets/${file.name}`));
}

export async function getProfileFromToken(token: string): Promise<SupabaseProfile | null> {
  const { userId } = await verifyAccessToken(token);
  return getProfile(userId);
}

export async function updateProfile(params: {
  userId: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
}): Promise<SupabaseProfile> {
  const client = getServiceClient();
  const updates: Record<string, string | null | undefined> = {};
  if (params.displayName !== undefined) {
    const trimmed = params.displayName.trim();
    if (!trimmed) throw new Error('DISPLAY_NAME_REQUIRED');
    updates.display_name = trimmed;
  }
  if (params.username !== undefined) {
    // Validate and normalize username to match database constraint
    updates.username = validateAndNormalizeUsername(params.username);
  }
  if (params.avatarUrl !== undefined) {
    updates.avatar_url = params.avatarUrl;
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('NO_FIELDS');
  }
  const { data, error } = await client
    .from('profiles')
    .update(updates)
    .eq('id', params.userId)
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update profile');
  }
  return data as SupabaseProfile;
}

export async function updateLobbyName(params: { lobbyId: string; hostId: string; name: string }): Promise<LobbyPayload> {
  const client = getServiceClient();
  const trimmed = params.name.trim();
  if (!trimmed) {
    throw new Error('NAME_REQUIRED');
  }
  const lobby = await ensureLobbyHost(params.lobbyId, params.hostId, client);
  if (lobby.status !== 'waiting') {
    throw new Error('LOBBY_NOT_WAITING');
  }
  const { data, error } = await client
    .from('lobbies')
    .update({ name: trimmed })
    .eq('id', params.lobbyId)
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update lobby name');
  }
  const players = await fetchLobbyPlayers(params.lobbyId, client);
  return { ...(data as LobbyRecord), players };
}

export async function updateLobbySize(params: {
  lobbyId: string;
  hostId: string;
  maxPlayers: number;
  isFixedSize?: boolean;
}): Promise<LobbyPayload> {
  const client = getServiceClient();
  if (params.maxPlayers < 2 || params.maxPlayers > 4) {
    throw new Error('INVALID_SIZE');
  }
  const lobby = await ensureLobbyHost(params.lobbyId, params.hostId, client);
  if (lobby.status !== 'waiting') {
    throw new Error('LOBBY_NOT_WAITING');
  }
  const currentPlayers = lobby.current_players ?? (await fetchLobbyPlayers(params.lobbyId, client)).length;
  if (params.maxPlayers < currentPlayers) {
    throw new Error('SIZE_TOO_SMALL');
  }
  const payload: Partial<LobbyRecord> = {
    max_players: params.maxPlayers,
  } as Partial<LobbyRecord>;
  if (params.isFixedSize !== undefined) {
    (payload as any).is_fixed_size = params.isFixedSize;
  }
  const { data, error } = await client
    .from('lobbies')
    .update(payload)
    .eq('id', params.lobbyId)
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update lobby size');
  }
  const players = await fetchLobbyPlayers(params.lobbyId, client);
  return { ...(data as LobbyRecord), players };
}

export async function lockLobby(params: { lobbyId: string; hostId: string }): Promise<LobbyPayload> {
  const client = getServiceClient();
  const lobby = await ensureLobbyHost(params.lobbyId, params.hostId, client);
  if (lobby.status !== 'waiting') {
    throw new Error('LOBBY_NOT_WAITING');
  }
  const currentPlayers = lobby.current_players ?? (await fetchLobbyPlayers(params.lobbyId, client)).length;
  const { data, error } = await client
    .from('lobbies')
    .update({
      max_players: currentPlayers,
      is_fixed_size: true,
    })
    .eq('id', params.lobbyId)
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to lock lobby');
  }
  const players = await fetchLobbyPlayers(params.lobbyId, client);
  return { ...(data as LobbyRecord), players };
}

export async function startLobby(params: { lobbyId: string; hostId: string }): Promise<LobbyPayload> {
  const client = getServiceClient();
  const lobby = await ensureLobbyHost(params.lobbyId, params.hostId, client);
  if (lobby.status !== 'waiting') {
    throw new Error('LOBBY_NOT_WAITING');
  }
  const currentPlayers = lobby.current_players ?? (await fetchLobbyPlayers(params.lobbyId, client)).length;
  const updatePayload: Partial<LobbyRecord> = {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  } as Partial<LobbyRecord>;
  if (!lobby.is_fixed_size) {
    (updatePayload as any).is_fixed_size = true;
    (updatePayload as any).max_players = Math.max(lobby.max_players ?? currentPlayers, currentPlayers);
  }
  const { data, error } = await client
    .from('lobbies')
    .update(updatePayload)
    .eq('id', params.lobbyId)
    .select()
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to start lobby');
  }
  const players = await fetchLobbyPlayers(params.lobbyId, client);
  return { ...(data as LobbyRecord), players };
}

export async function removeLobbyPlayer(params: {
  lobbyId: string;
  hostId: string;
  targetPlayerId: string;
}): Promise<LobbyPayload> {
  const client = getServiceClient();
  const lobby = await ensureLobbyHost(params.lobbyId, params.hostId, client);
  if (lobby.status !== 'waiting') {
    throw new Error('LOBBY_NOT_WAITING');
  }
  const { error } = await client
    .from('lobby_players')
    .delete()
    .eq('lobby_id', params.lobbyId)
    .eq('player_id', params.targetPlayerId);
  if (error) {
    throw new Error(error.message);
  }
  let updated = await fetchLobbyRecord(params.lobbyId, client);
  if (!updated) {
    throw new Error('LOBBY_NOT_FOUND');
  }
  if ((updated.current_players ?? 0) === 0) {
    const finish = await client.from('lobbies').update({ status: 'finished' }).eq('id', params.lobbyId).select().single();
    if (!finish.error && finish.data) {
      updated = finish.data as LobbyRecord;
    } else if (finish.error) {
      throw new Error(finish.error.message);
    }
  }
  const players = await fetchLobbyPlayers(params.lobbyId, client);
  return { ...updated, players };
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
