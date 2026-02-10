import {
  playCompleteGame,
} from '../utils/gameTestUtils';
import { GameSessionStatus } from '../../src/gameplay/GameSession';

describe('GameSession Timing Performance Tests', () => {
  it('should complete a 2-player game with medium bots in reasonable time', async () => {
    const startTime = Date.now();

    const { winner, session } = await playCompleteGame(2, 'medium');

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Assert game completed successfully
    expect(winner).toBeDefined();
    expect(session.getStatus()).toBe(GameSessionStatus.ENDED);

    // Assert completion time is reasonable (generous threshold to avoid flakiness)
    // This is a performance test, so we want to ensure games don't take too long
    // Use a generous threshold to avoid flakiness across environments.
    expect(duration).toBeLessThan(30000); // 30 seconds locally

    // Log timing for visibility
    console.log(`2-player game completed in ${duration}ms`);
  }, 30000); // 30 second timeout (test should complete well before this)
});
