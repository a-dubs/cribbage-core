import {
  Game,
  GameState,
  HandScore,
  Player,
  Phase,
  ActionType,
  Card,
} from '../types'; // Update the path to match your project structure

export class GameStatistics {
  /**
   * Calculate the average hand score for a given player.
   */
  static averageHandScore(playerId: string, gameHistory: GameState[]): number {
    const scores = gameHistory
      .filter(
        state =>
          state.playerId === playerId &&
          state.phase === Phase.COUNTING &&
          state.actionType === ActionType.SCORE_HAND
      )
      .map(state => state.scoreChange);

    return scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  }

  /**
   * Calculate the average crib score for a given player.
   */
  static averageCribScore(playerId: string, gameHistory: GameState[]): number {
    const scores = gameHistory
      .filter(
        state =>
          state.playerId === playerId &&
          state.phase === Phase.COUNTING &&
          state.actionType === ActionType.SCORE_CRIB
      )
      .map(state => state.scoreChange);
    return scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  }

  /**
   * Calculate the maximum hand score for a given player.
   */
  static maximumHandScore(playerId: string, gameHistory: GameState[]): number {
    return gameHistory
      .filter(
        state =>
          state.playerId === playerId &&
          state.phase === Phase.COUNTING &&
          state.actionType === ActionType.SCORE_HAND
      )
      .reduce((max, state) => Math.max(max, state.scoreChange), 0);
  }

  /**
   * Calculate the maximum crib score for a given player.
   */
  static maximumCribScore(playerId: string, gameHistory: GameState[]): number {
    return gameHistory
      .filter(
        state =>
          state.playerId === playerId &&
          state.phase === Phase.COUNTING &&
          state.actionType === ActionType.SCORE_CRIB
      )
      .reduce((max, state) => Math.max(max, state.scoreChange), 0);
  }

  /**
   * Find the best-played hand for a given player, including the turn card and score.
   */
  static bestPlayedHand(
    playerId: string,
    gameHistory: GameState[]
  ): {
    hand: Card[];
    turnCard: Card;
    score: number;
    gameState: GameState;
  } | null {
    const handScores = gameHistory
      .filter(
        state =>
          state.playerId === playerId &&
          state.phase === Phase.COUNTING &&
          (state.actionType === ActionType.SCORE_HAND ||
            state.actionType === ActionType.SCORE_CRIB)
      )
      .map(state => ({
        hand: state.cards as Card[],
        turnCard: (() => {
          for (let i = gameHistory.indexOf(state); i >= 0; i--) {
            if (
              gameHistory[i].phase === Phase.CUTTING &&
              gameHistory[i].actionType === ActionType.TURN_CARD
            ) {
              return gameHistory[i].cards?.[0] as Card;
            }
          }
          throw new Error('No turn card found');
        })(),
        score: state.scoreChange,
        gameState: state,
      }));
    if (handScores.length === 0) return null;

    return handScores.reduce((best, current) =>
      current.score > best.score ? current : best
    );
  }

  /**
   * Calculate the number of times this played scored "his heels" (a jack was cut as the turn card).
   *
   * "His heels" is a special case in cribbage where a player scores 2 points if a jack is cut as the turn card.
   *
   * @param playerId The ID of the player to calculate the statistic for
   * @param gameHistory The history of the game to analyze
   * @returns The number of times the player scored "his heels"
   *
   */
  static scoredHisHeels(playerId: string, gameHistory: GameState[]): number {
    return gameHistory.filter(
      state =>
        state.playerId === playerId &&
        state.phase === Phase.COUNTING &&
        state.actionType === ActionType.SCORE_HEELS
    ).length;
  }

  static numberOfRounds(gameHistory: GameState[]): number {
    return gameHistory.filter(
      state =>
        state.phase === Phase.CUTTING && state.actionType === ActionType.CUT
    ).length;
  }
}
