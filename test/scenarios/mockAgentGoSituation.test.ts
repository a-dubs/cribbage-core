import { GameSessionStatus } from '../../src/gameplay/GameSession';
import { RandomAgent } from '../../src/agents/RandomAgent';
import { createTestSession, playUntilPhase } from '../utils/gameTestUtils';
import { Phase } from '../../src/types';

describe('MockAgent Go Situation Scenario Tests', () => {
  let consoleLogSpy: jest.SpyInstance;

  // Silence console.log spam during tests
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should handle natural Go situations during pegging without deadlocking', async () => {
    const session = createTestSession(2);
    const gameState = session.getGameState();
    const player1 = gameState.players[0];
    const player2 = gameState.players[1];

    const agent1 = new RandomAgent();
    agent1.playerId = player1.id;

    const agent2 = new RandomAgent();
    agent2.playerId = player2.id;

    session.addAgent(player1.id, agent1);
    session.addAgent(player2.id, agent2);

    // Play until COUNTING phase to verify pegging (and Go handling) completed
    // RandomAgent will naturally create Go situations during pegging
    await playUntilPhase(session, Phase.COUNTING);
    
    // Verify we reached counting phase (pegging completed, Go was handled)
    const currentPhase = session.getGameState().currentPhase;
    expect(currentPhase).toBe(Phase.COUNTING);
    
    // Verify session is still running (not deadlocked)
    const status = session.getStatus();
    expect(status).not.toBe(GameSessionStatus.CANCELLED);
    
    // Clean up
    session.cancel();
  }, 60000); // 1 minute timeout
});
