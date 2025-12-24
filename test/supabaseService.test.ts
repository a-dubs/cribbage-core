// Set up environment variables BEFORE importing the service
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.SUPABASE_ANON_KEY = 'anon-key';

import { createClient } from '@supabase/supabase-js';
import * as supabaseService from '../src/services/supabaseService';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

describe('supabaseService', () => {
  let mockSupabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    supabaseService.resetServiceClients();
    
    // We create a factory for the chained mock
    // This mock returns 'this' for all chaining methods, but also
    // implements 'then' so it can be awaited at any point.
    const createMockChain = () => {
      const chain: any = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockReturnThis(),
        match: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        rpc: jest.fn().mockReturnThis(),
        auth: {
          admin: {
            createUser: jest.fn(),
            getUserById: jest.fn(),
          },
          signInWithPassword: jest.fn(),
          refreshSession: jest.fn(),
        },
        storage: {
          from: jest.fn().mockReturnThis(),
          upload: jest.fn(),
          getPublicUrl: jest.fn(),
        },
        // The magic: make the chain awaitable
        then: jest.fn((onFulfilled) => {
          // This is a bit tricky since we want different values for different calls.
          // We'll use a queue of results that we populate in the tests.
          const result = chain._results.shift() || { data: null, error: null };
          return Promise.resolve(result).then(onFulfilled);
        }),
        _results: [],
        _pushResult: (data: any, error: any = null) => {
          chain._results.push({ data, error });
        }
      };
      return chain;
    };

    mockSupabase = createMockChain();
    (createClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  describe('getPlayerActiveLobbyId', () => {
    it('returns lobby ID when player is in an active lobby', async () => {
      mockSupabase._pushResult([{ lobby_id: 'lobby-123', lobbies: { status: 'waiting' } }]);

      const result = await supabaseService.getPlayerActiveLobbyId('player-123');
      expect(result).toBe('lobby-123');
    });
  });

  describe('createLobby', () => {
    it('creates lobby successfully when player is not in a lobby', async () => {
      // 1. Result for getPlayerActiveLobbyId check
      mockSupabase._pushResult([]);
      
      // 2. Result for client.from('lobbies').insert(...).select().single()
      mockSupabase._pushResult({ id: 'new-lobby', status: 'waiting' });

      // 3. Result for adding host to lobby_players (calls .from.insert.select.single)
      mockSupabase._pushResult({ player_id: 'player-123' });

      // 4. Result for fetchLobbyPlayers (calls .from.select.eq)
      mockSupabase._pushResult([{ player_id: 'player-123', profiles: { display_name: 'Host' } }]);

      const result = await supabaseService.createLobby({
        hostId: 'player-123',
        maxPlayers: 2,
        isFixedSize: true,
        visibility: 'public'
      });

      expect(result.id).toBe('new-lobby');
      expect(mockSupabase.insert).toHaveBeenCalled();
    });
  });

  describe('joinLobby', () => {
    it('allows joining if player is already in the SAME lobby (idempotent)', async () => {
      // 1. Result for getPlayerActiveLobbyId check
      mockSupabase._pushResult([{ lobby_id: 'target-lobby', lobbies: { status: 'waiting' } }]);
      
      // 2. Result for get lobby info (fetchLobbyRecord)
      mockSupabase._pushResult({ id: 'target-lobby', status: 'waiting', max_players: 2, current_players: 1 });

      // 3. Result for check if already in (maybeSingle)
      mockSupabase._pushResult({ lobby_id: 'target-lobby', player_id: 'player-123' });

      // 4. Result for fetchLobbyPlayers
      mockSupabase._pushResult([{ player_id: 'player-123', profiles: { display_name: 'Player' } }]);

      const result = await supabaseService.joinLobby({
        lobbyId: 'target-lobby',
        playerId: 'player-123'
      });

      expect(result.id).toBe('target-lobby');
    });
  });

  describe('friend requests', () => {
    it('sends a friend request successfully', async () => {
      // 1. Mock finding recipient profile
      mockSupabase._pushResult({ id: 'recipient-123', username: 'target' });
      
      // 2. Mock inserting friend request
      mockSupabase._pushResult({ id: 'request-123', status: 'pending' });

      const result = await supabaseService.sendFriendRequest({
        senderId: 'sender-123',
        recipientUsername: 'target'
      });

      expect(result.status).toBe('pending');
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
      expect(mockSupabase.from).toHaveBeenCalledWith('friend_requests');
    });

    it('throws error if recipient not found', async () => {
      // 1. Mock finding recipient profile (not found)
      mockSupabase._pushResult(null);

      await expect(supabaseService.sendFriendRequest({
        senderId: 'sender-123',
        recipientUsername: 'unknown'
      })).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('updateProfile', () => {
    it('updates display name successfully', async () => {
      mockSupabase._pushResult({ 
        id: 'user-123', 
        username: 'user', 
        display_name: 'New Name' 
      });

      const result = await supabaseService.updateProfile({
        userId: 'user-123',
        displayName: 'New Name'
      });

      expect(result.display_name).toBe('New Name');
      expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
        display_name: 'New Name'
      }));
    });
  });
});
