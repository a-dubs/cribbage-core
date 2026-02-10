import { GameSession, GameSessionStatus } from '../src/gameplay/GameSession';
import { RandomAgent } from '../src/agents/RandomAgent';
import { HeuristicSimpleAgent } from '../src/agents/HeuristicSimpleAgent';
import { Phase, PlayerIdAndName } from '../src/types';

describe('GameSession Integration Tests - Complete Games', () => {
  let consoleLogSpy: jest.SpyInstance;

  // Silence console.log spam during tests, but keep console.error visible
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // Helper to create players
  function createPlayers(count: number): PlayerIdAndName[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `player-${i + 1}`,
      name: `Player ${i + 1}`,
    }));
  }

  // Helper to create and run a complete game
  async function runCompleteGame(
    players: PlayerIdAndName[],
    useHeuristic: boolean = false
  ): Promise<{
    session: GameSession;
    winner: string;
    finalState: any;
    snapshotHistory: any[];
  }> {
    const session = GameSession.create(players);

    // Add agents for all players
    for (const player of players) {
      const agent = useHeuristic
        ? new HeuristicSimpleAgent()
        : new RandomAgent();
      agent.playerId = player.id;
      session.addAgent(player.id, agent);
    }

    // Start the game and wait for completion
    const winner = await session.start();

    // Get final state
    const finalState = session.getGameState();
    const snapshotHistory = session.getSnapshotHistory();

    return {
      session,
      winner,
      finalState,
      snapshotHistory,
    };
  }

  // Helper to assert game completion invariants
  function assertGameCompletion(
    players: PlayerIdAndName[],
    winner: string,
    finalState: any,
    snapshotHistory: any[],
    session: GameSession
  ): void {
    // Assert: Winner is one of the players
    expect(players.map((p: PlayerIdAndName) => p.id)).toContain(winner);

    // Assert: Game ends with Phase.END
    expect(finalState.currentPhase).toBe(Phase.END);

    // Assert: Snapshot history is non-empty
    expect(snapshotHistory.length).toBeGreaterThan(0);

    // Assert: Winner has score >= 121
    const winnerPlayer = finalState.players.find((p: any) => p.id === winner);
    expect(winnerPlayer).toBeDefined();
    expect(winnerPlayer!.score).toBeGreaterThanOrEqual(121);

    // Assert: No pending decision requests at end
    const lastSnapshot = snapshotHistory[snapshotHistory.length - 1];
    expect(lastSnapshot.pendingDecisionRequests).toEqual([]);

    // Assert: Session status is ENDED
    expect(session.getStatus()).toBe(GameSessionStatus.ENDED);
  }

  it('should complete a full 2-player game with RandomAgent', async () => {
    const players = createPlayers(2);
    const { session, winner, finalState, snapshotHistory } =
      await runCompleteGame(players, false);

    assertGameCompletion(players, winner, finalState, snapshotHistory, session);
  }, 120000); // 2 minute timeout

  it('should complete a full 3-player game with RandomAgent', async () => {
    const players = createPlayers(3);
    const { session, winner, finalState, snapshotHistory } =
      await runCompleteGame(players, false);

    assertGameCompletion(players, winner, finalState, snapshotHistory, session);
  }, 120000); // 2 minute timeout

  it('should complete a full 4-player game with HeuristicSimpleAgent', async () => {
    const players = createPlayers(4);
    const { session, winner, finalState, snapshotHistory } =
      await runCompleteGame(players, true);

    assertGameCompletion(players, winner, finalState, snapshotHistory, session);
  }, 120000); // 2 minute timeout
});
