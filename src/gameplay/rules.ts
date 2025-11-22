/**
 * Centralized configuration for multi-player game rules
 * Supports 2, 3, and 4 player games with proper card distribution and crib handling
 */

export interface PlayerCountConfig {
  handSize: number;           // Cards dealt to each player
  discardPerPlayer: number;   // Cards each player must discard to crib
  autoCribCardsFromDeck: number; // Cards auto-dealt to crib from deck (before player dealing)
}

/**
 * Get the list of supported player counts
 * @returns Array of valid player counts [2, 3, 4]
 */
export function getSupportedPlayerCounts(): number[] {
  return [2, 3, 4];
}

/**
 * Check if a player count is supported
 * @param playerCount - Number of players to validate
 * @returns True if the player count is supported
 */
export function isValidPlayerCount(playerCount: number): boolean {
  return getSupportedPlayerCounts().includes(playerCount);
}

/**
 * Get configuration for a specific player count
 * @param playerCount - Number of players in the game
 * @returns Configuration for hand size, discard count, and auto-crib cards
 * @throws Error if player count is not supported
 */
export function getPlayerCountConfig(playerCount: number): PlayerCountConfig {
  if (!isValidPlayerCount(playerCount)) {
    throw new Error(
      `Unsupported player count: ${playerCount}. Supported counts are: ${getSupportedPlayerCounts().join(', ')}`
    );
  }

  switch (playerCount) {
    case 2:
      return {
        handSize: 6,
        discardPerPlayer: 2,
        autoCribCardsFromDeck: 0,
      };
    case 3:
      return {
        handSize: 5,
        discardPerPlayer: 1,
        autoCribCardsFromDeck: 1, // One card auto-dealt to crib
      };
    case 4:
      return {
        handSize: 5,
        discardPerPlayer: 1,
        autoCribCardsFromDeck: 0,
      };
    default:
      // Should never reach here due to isValidPlayerCount check
      throw new Error(`Unsupported player count: ${playerCount}`);
  }
}

/**
 * Calculate the expected crib size after all discards
 * @param playerCount - Number of players in the game
 * @returns Total number of cards that should be in the crib
 */
export function getExpectedCribSize(playerCount: number): number {
  const config = getPlayerCountConfig(playerCount);
  return playerCount * config.discardPerPlayer + config.autoCribCardsFromDeck;
}

/**
 * Validate that a player count is within supported range and throw if not
 * Used for constructor validation
 * @param playerCount - Number of players to validate
 * @throws Error if player count is invalid
 */
export function validatePlayerCount(playerCount: number): void {
  if (playerCount < 2 || playerCount > 4) {
    throw new Error(
      `Invalid player count: ${playerCount}. Games must have between 2 and 4 players.`
    );
  }
}
