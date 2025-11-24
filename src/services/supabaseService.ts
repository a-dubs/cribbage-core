import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  friend_code: string | null;
};

export type LobbyVisibility = 'public' | 'private' | 'friends';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

function ensureEnv(): void {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment is not fully configured');
  }
}

function getServiceClient(): SupabaseClient {
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

export async function getProfileFromToken(token: string): Promise<SupabaseProfile | null> {
  const { userId } = await verifyAccessToken(token);
  return getProfile(userId);
}
