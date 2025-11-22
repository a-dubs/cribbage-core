import { CribbageGame } from '../src/core/CribbageGame';
import { Phase } from '../src/types';

describe('pegPositions', () => {
  it('should initialize pegPositions to 0 for both pegs', () => {
    const game = new CribbageGame(
      [
        { id: 'player1', name: 'Player 1' },
        { id: 'player2', name: 'Player 2' },
      ],
      0
    );

    const gameState = (game as any).gameState;
    expect(gameState.players[0].pegPositions).toEqual({
      current: 0,
      previous: 0,
    });
    expect(gameState.players[1].pegPositions).toEqual({
      current: 0,
      previous: 0,
    });
  });

  it('should initialize pegPositions with starting score', () => {
    const game = new CribbageGame(
      [
        { id: 'player1', name: 'Player 1' },
        { id: 'player2', name: 'Player 2' },
      ],
      50
    );

    const gameState = (game as any).gameState;
    expect(gameState.players[0].pegPositions).toEqual({
      current: 50,
      previous: 50,
    });
    expect(gameState.players[1].pegPositions).toEqual({
      current: 50,
      previous: 50,
    });
  });

  it('should update pegPositions when score increases', () => {
    const game = new CribbageGame(
      [
        { id: 'player1', name: 'Player 1' },
        { id: 'player2', name: 'Player 2' },
      ],
      0
    );

    const gameState = (game as any).gameState;
    const player = gameState.players[0];

    // Manually update score for testing
    (game as any).updatePlayerScore(player, 2);

    expect(player.score).toBe(2);
    expect(player.pegPositions).toEqual({
      current: 2,
      previous: 0,
    });
  });

  it('should leapfrog pegs when scoring multiple times', () => {
    const game = new CribbageGame(
      [
        { id: 'player1', name: 'Player 1' },
        { id: 'player2', name: 'Player 2' },
      ],
      0
    );

    const gameState = (game as any).gameState;
    const player = gameState.players[0];

    // First score
    (game as any).updatePlayerScore(player, 2);
    expect(player.pegPositions).toEqual({
      current: 2,
      previous: 0,
    });

    // Second score - pegs should leapfrog
    (game as any).updatePlayerScore(player, 5);
    expect(player.pegPositions).toEqual({
      current: 7,
      previous: 2,
    });

    // Third score
    (game as any).updatePlayerScore(player, 3);
    expect(player.pegPositions).toEqual({
      current: 10,
      previous: 7,
    });
  });

  it('should not move pegPositions when score does not change', () => {
    const game = new CribbageGame(
      [
        { id: 'player1', name: 'Player 1' },
        { id: 'player2', name: 'Player 2' },
      ],
      0
    );

    const gameState = (game as any).gameState;
    const player = gameState.players[0];

    // First score to move pegs off the starting position
    (game as any).updatePlayerScore(player, 4);
    expect(player.pegPositions).toEqual({
      current: 4,
      previous: 0,
    });

    // Zero-point update should not change pegs or score
    (game as any).updatePlayerScore(player, 0);
    expect(player.score).toBe(4);
    expect(player.pegPositions).toEqual({
      current: 4,
      previous: 0,
    });
  });
});
