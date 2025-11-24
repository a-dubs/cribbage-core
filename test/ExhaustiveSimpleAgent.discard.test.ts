import { ExhaustiveSimpleAgent } from '../src/agents/ExhaustiveSimpleAgent';
import { CribbageGame } from '../src/core/CribbageGame';
import { GameState, GameSnapshot, Card, ActionType } from '../src/types';

/**
 * Helper to convert GameState to GameSnapshot for tests
 */
function stateToSnapshot(gameState: GameState): GameSnapshot {
  return {
    gameState,
    gameEvent: {
      gameId: gameState.id,
      phase: gameState.currentPhase,
      actionType: ActionType.START_ROUND,
      playerId: null,
      cards: null,
      scoreChange: 0,
      timestamp: new Date(),
      snapshotId: gameState.snapshotId,
    },
    pendingDecisionRequests: [],
  };
}

describe('ExhaustiveSimpleAgent discard tests', () => {
  it('should handle discarding 1 card from 5-card hand (4-player game)', async () => {
    const agent = new ExhaustiveSimpleAgent();
    agent.playerId = 'test-player';

    // Create a 4-player game to get 5-card hands
    const game = new CribbageGame([
      { id: 'test-player', name: 'Test Player' },
      { id: 'player2', name: 'Player 2' },
      { id: 'player3', name: 'Player 3' },
      { id: 'player4', name: 'Player 4' },
    ]);

    // Set up game: select dealer and start round
    game.getGameState().players[0].isDealer = true;
    game.startRound();
    game.deal();

    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === 'test-player')!;
    const snapshot = stateToSnapshot(gameState);

    // Player should have 5 cards in a 4-player game
    expect(player.hand).toHaveLength(5);

    // Test discarding 1 card (4-player rule)
    const discards = await agent.discard(snapshot, 'test-player', 1);

    // Should return exactly 1 card
    expect(discards).toHaveLength(1);
    expect(player.hand).toContain(discards[0]);
  });

  it('should handle discarding 2 cards from 6-card hand (2-player game)', async () => {
    const agent = new ExhaustiveSimpleAgent();
    agent.playerId = 'test-player';

    // Create a 2-player game to get 6-card hands
    const game = new CribbageGame([
      { id: 'test-player', name: 'Test Player' },
      { id: 'player2', name: 'Player 2' },
    ]);

    // Set up game: select dealer and start round
    game.getGameState().players[0].isDealer = true;
    game.startRound();
    game.deal();

    const gameState = game.getGameState();
    const player = gameState.players.find(p => p.id === 'test-player')!;
    const snapshot = stateToSnapshot(gameState);

    // Player should have 6 cards in a 2-player game
    expect(player.hand).toHaveLength(6);

    // Test discarding 2 cards (2-player rule)
    const discards = await agent.discard(snapshot, 'test-player', 2);

    // Should return exactly 2 cards
    expect(discards).toHaveLength(2);
    expect(player.hand).toContain(discards[0]);
    expect(player.hand).toContain(discards[1]);
  });
});
