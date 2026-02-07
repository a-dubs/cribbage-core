import {
  ActionType,
  GameEvent,
  GameSnapshot,
  PlayerIdAndName,
} from '../types';
import { GameLoop } from '../gameplay/GameLoop';
import {
  createGameRecord,
  persistGameEvents,
  toUuidOrNull,
} from '../services/supabaseService';
import { Lobby } from './types';
import { logger } from '../utils/logger';

type Logger = typeof logger;

export class PersistenceService {
  constructor(private readonly logger: Logger) {}

  /**
   * Maps players to the format expected by Supabase game records
   */
  mapPlayersForGameRecord(
    players: PlayerIdAndName[]
  ): Array<{ playerId: string | null; playerName: string }> {
    return players.map(player => ({
      playerId: toUuidOrNull(player.id),
      playerName: player.name,
    }));
  }

  /**
   * Determines if a snapshot should be stored for a given event
   */
  shouldStoreSnapshotForEvent(event: GameEvent): boolean {
    return (
      event.actionType === ActionType.START_ROUND ||
      event.actionType === ActionType.READY_FOR_NEXT_ROUND ||
      event.actionType === ActionType.WIN
    );
  }

  /**
   * Gets the appropriate snapshot for a given event
   */
  snapshotForEvent(
    event: GameEvent,
    latestSnapshot: GameSnapshot,
    roundStartSnapshot?: GameSnapshot
  ): GameSnapshot | undefined {
    if (event.actionType === ActionType.START_ROUND) {
      return roundStartSnapshot ?? latestSnapshot;
    }
    if (
      event.actionType === ActionType.READY_FOR_NEXT_ROUND ||
      event.actionType === ActionType.WIN
    ) {
      return latestSnapshot;
    }
    return undefined;
  }

  /**
   * Creates a Supabase game record for a lobby
   * @param supabaseGameIdByLobbyId Map to store the created game ID
   */
  async createSupabaseGameForLobby(
    lobby: Lobby,
    playersInfo: PlayerIdAndName[],
    gameLoop: GameLoop,
    supabaseGameIdByLobbyId: Map<string, string>
  ): Promise<string | null> {
    try {
      this.logger.info(
        `[Supabase] Creating game record for lobby ${lobby.id} with ${playersInfo.length} players`
      );
      const gameId = await createGameRecord({
        lobbyId: lobby.id,
        players: this.mapPlayersForGameRecord(playersInfo),
        initialState: gameLoop.cribbageGame.getGameState(),
        startedAt: new Date(),
      });
      supabaseGameIdByLobbyId.set(lobby.id, gameId);
      this.logger.info(
        `[Supabase] Created game record ${gameId} for lobby ${lobby.id}`
      );
      return gameId;
    } catch (error) {
      this.logger.error(
        `[Supabase] Failed to create game record for lobby ${lobby.id}. ` +
          `This is a critical error - game persistence is required.`,
        error
      );
      return null;
    }
  }

  /**
   * Persists round history events to Supabase
   * @param supabaseGameIdByLobbyId Map to read the game ID
   * @param currentRoundGameEventsByLobbyId Map to read and clear events
   * @param roundStartSnapshotByLobbyId Map to read round start snapshot
   */
  async persistRoundHistory(
    lobbyId: string,
    latestSnapshot: GameSnapshot,
    supabaseGameIdByLobbyId: Map<string, string>,
    currentRoundGameEventsByLobbyId: Map<string, GameEvent[]>,
    roundStartSnapshotByLobbyId: Map<string, GameSnapshot>
  ): Promise<void> {
    const supabaseGameId = supabaseGameIdByLobbyId.get(lobbyId);
    if (!supabaseGameId) {
      this.logger.warn(
        `[Supabase] Persistence skipped: No game ID found for lobby ${lobbyId}`
      );
      return;
    }

    // Atomically capture and clear events to prevent race conditions
    // If START_ROUND fires during persistence, it won't be lost
    const roundEvents = currentRoundGameEventsByLobbyId.get(lobbyId) ?? [];
    if (roundEvents.length === 0) {
      this.logger.debug(
        `[Supabase] Persistence skipped: No events to persist for lobby ${lobbyId}`
      );
      return;
    }

    this.logger.info(
      `[Supabase] Persisting ${roundEvents.length} events for game ${supabaseGameId} (lobby ${lobbyId})`
    );

    // Clear immediately before async operation to prevent race conditions
    currentRoundGameEventsByLobbyId.set(lobbyId, []);

    const roundStartSnapshot = roundStartSnapshotByLobbyId.get(lobbyId);
    const eventsWithSnapshots = roundEvents.map(event => {
      const snapshot = this.snapshotForEvent(
        event,
        latestSnapshot,
        roundStartSnapshot
      );
      return {
        event,
        snapshot,
        storeSnapshot: snapshot ? this.shouldStoreSnapshotForEvent(event) : false,
      };
    });

    const snapshotsToStore = eventsWithSnapshots.filter(
      e => e.storeSnapshot
    ).length;
    if (snapshotsToStore > 0) {
      this.logger.info(
        `[Supabase] Will store ${snapshotsToStore} snapshots along with events`
      );
    }

    try {
      await persistGameEvents({
        gameId: supabaseGameId,
        events: eventsWithSnapshots,
      });
      this.logger.info(
        `[Supabase] Successfully persisted ${roundEvents.length} events for game ${supabaseGameId}`
      );
    } catch (error) {
      this.logger.error(
        `[Supabase] Failed to persist round history for game ${supabaseGameId}. ` +
          `This is a critical error - game persistence is required.`,
        error
      );
      // Note: Events are already cleared, so they won't be retried
      // This is acceptable since persistence failures are logged for monitoring
    }
  }
}
