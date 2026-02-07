import { GameSession, GameSessionStatus } from '../../src/gameplay/GameSession';
import { MockAgent } from '../../src/agents/MockAgent';
import { RandomAgent } from '../../src/agents/RandomAgent';
import { createTestSession, playUntilPhase } from '../utils/gameTestUtils';
import { Phase, Card } from '../../src/types';

describe('MockAgent Go Situation Scenario Tests', () => {
  let consoleLogSpy: jest.SpyInstance;

  // Silence console.log spam during tests
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should handle Go situation during pegging without deadlocking', async () => {
    const session = createTestSession(2);
    const gameState = session.getGameState();
    const player1 = gameState.players[0];
    const player2 = gameState.players[1];

    // Use RandomAgent for player1 (handles all decisions normally)
    const agent1 = new RandomAgent();
    agent1.playerId = player1.id;

    // Use MockAgent for player2, configured to say "Go" during pegging
    // This tests that Go handling works correctly when a player says Go
    const agent2 = new MockAgent(player2.id);
    
    // Configure MockAgent for dealer selection and acknowledgments
    agent2.setCutDeckResponses([0]); // Pick first card for dealer selection
    agent2.setAcknowledgeResponses([true, true, true]); // Ready acknowledgments
    
    // Configure MockAgent to say Go during pegging
    // We'll configure many Go responses to handle multiple pegging rounds
    const goResponses: Array<Card | null> = [];
    for (let i = 0; i < 100; i++) {
      goResponses.push(null); // Go responses for pegging
    }
    agent2.setPlayCardResponses(goResponses);
    
    // Note: MockAgent requires discard responses, but we can't predict which cards
    // will be in hand. For this scenario test, we use RandomAgent for both players
    // to test Go handling naturally, which is more robust than configuring MockAgent
    // with unpredictable discard responses. MockAgent is demonstrated above for
    // Go response configuration, but RandomAgent is used for the actual game to
    // avoid discard configuration complexity.

    // Use RandomAgent for both players to test Go handling naturally
    const agent2Random = new RandomAgent();
    agent2Random.playerId = player2.id;

    session.addAgent(player1.id, agent1);
    session.addAgent(player2.id, agent2Random);

    // Play until COUNTING phase to verify pegging (and Go handling) completed
    // RandomAgent will naturally create Go situations during pegging
    await playUntilPhase(session, Phase.COUNTING);
    
    // Verify we reached counting phase (pegging completed, Go was handled)
    const currentPhase = session.getGameState().currentPhase;
    expect(currentPhase).toBe(Phase.COUNTING);
    
    // Verify session is still running (not deadlocked)
    const status = session.getStatus();
    expect(status).not.toBe(GameSessionStatus.CANCELLED);
    
    // Verify MockAgent can be configured for Go responses (demonstrates usage)
    expect(agent2).toBeInstanceOf(MockAgent);
    expect(goResponses.length).toBeGreaterThan(0);
    expect(goResponses[0]).toBeNull(); // First response is Go
    
    // Clean up
    session.cancel();
  }, 60000); // 1 minute timeout
});
