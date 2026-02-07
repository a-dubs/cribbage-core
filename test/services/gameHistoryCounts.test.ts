describe('getGameHistoryCountsByLobbyId (test endpoint helper)', () => {
  it('returns counts for key action and phase signals', async () => {
    const lobbyId = 'test-lobby-id';
    const gameId = 'test-game-id';

    const calls: Array<{
      table: string;
      filters: Record<string, string>;
    }> = [];

    const createQuery = (table: string) => {
      const state = { table, filters: {} as Record<string, string> };
      const chain: any = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: { id: gameId }, error: null }),
        eq: (key: string, value: string) => {
          state.filters[key] = value;
          return chain;
        },
      };

      // For count queries, supabase-js resolves the builder as a promise of
      // `{ count, error }`. We emulate that behavior via `then`.
      chain.then = (onFulfilled: any, onRejected: any) => {
        try {
          calls.push({ table: state.table, filters: { ...state.filters } });

          const actionType = state.filters.action_type;
          const phase = state.filters.phase;

          const countByKey: Record<string, number> = {
            // overall
            __events__: 123,
            __snapshots__: 7,
            // action types
            READY_FOR_COUNTING: 2,
            DISCARD: 2,
            CUT_DECK: 1,
            PLAY_CARD: 12,
            // phase transitions
            'BEGIN_PHASE|COUNTING': 1,
            'END_PHASE|COUNTING': 1,
          };

          let count = 0;
          if (table === 'game_events' && !actionType) count = countByKey.__events__;
          else if (table === 'game_snapshots') count = countByKey.__snapshots__;
          else if (table === 'game_events' && actionType && phase) {
            count = countByKey[`${actionType}|${phase}`] ?? 0;
          } else if (table === 'game_events' && actionType) {
            count = countByKey[actionType] ?? 0;
          }

          return Promise.resolve(onFulfilled({ count, error: null }));
        } catch (err) {
          return Promise.resolve(onRejected(err));
        }
      };

      return chain;
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getGameHistoryCountsByLobbyId } = require('../../src/services/supabaseService');
    const result = await getGameHistoryCountsByLobbyId(lobbyId, {
      from: (table: string) => createQuery(table),
    });

    expect(result).toEqual({
      gameId,
      eventsCount: 123,
      snapshotsCount: 7,
      readyForCountingCount: 2,
      discardCount: 2,
      cutDeckCount: 1,
      playCardCount: 12,
      beginPhaseCountingCount: 1,
      endPhaseCountingCount: 1,
    });

    // Smoke check: we queried history tables for this game.
    expect(calls.some(c => c.table === 'game_events')).toBe(true);
    expect(calls.some(c => c.table === 'game_snapshots')).toBe(true);
  });
});

