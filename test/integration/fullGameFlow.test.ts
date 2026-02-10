import {
  playCompleteGame,
  assertValidGameEnd,
} from '../utils/gameTestUtils';

describe('Full Game Flow Integration Tests', () => {
  let consoleLogSpy: jest.SpyInstance;

  // Silence console.log spam during tests
  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should complete a full 2-player game with medium bots', async () => {
    const { winner, session } = await playCompleteGame(2, 'medium');

    // Assert winner is one of the players
    const gameState = session.getGameState();
    const playerIds = gameState.players.map(p => p.id);
    expect(playerIds).toContain(winner);

    // Assert valid game end
    assertValidGameEnd(session);
  }, 120000); // 2 minute timeout

  it('should complete a full 3-player game with medium bots', async () => {
    const { winner, session } = await playCompleteGame(3, 'medium');

    // Assert winner is one of the players
    const gameState = session.getGameState();
    const playerIds = gameState.players.map(p => p.id);
    expect(playerIds).toContain(winner);

    // Assert valid game end
    assertValidGameEnd(session);
  }, 120000); // 2 minute timeout

  it('should complete a full 4-player game with medium bots', async () => {
    const { winner, session } = await playCompleteGame(4, 'medium');

    // Assert winner is one of the players
    const gameState = session.getGameState();
    const playerIds = gameState.players.map(p => p.id);
    expect(playerIds).toContain(winner);

    // Assert valid game end
    assertValidGameEnd(session);
  }, 120000); // 2 minute timeout
});
