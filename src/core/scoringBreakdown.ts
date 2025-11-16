/**
 * Scoring Breakdown Implementation
 * 
 * This file contains the implementation of detailed scoring breakdowns
 * for both hand/crib scoring and pegging scoring.
 */

import { Card, ScoreBreakdownItem, ScoreBreakdownType } from '../types';

/**
 * Generate human-readable description from breakdown type
 */
export function getBreakdownDescription(type: ScoreBreakdownType): string {
  const descriptions: Record<ScoreBreakdownType, string> = {
    // Hand/Crib
    FIFTEEN: 'Fifteen',
    PAIR: 'Pair',
    THREE_OF_A_KIND: 'Three of a kind',
    FOUR_OF_A_KIND: 'Four of a kind',
    RUN_OF_3: 'Run of 3',
    RUN_OF_4: 'Run of 4',
    RUN_OF_5: 'Run of 5',
    DOUBLE_RUN_OF_3: 'Double run of 3',
    DOUBLE_RUN_OF_4: 'Double run of 4',
    TRIPLE_RUN_OF_3: 'Triple run of 3',
    QUADRUPLE_RUN_OF_3: 'Quadruple run of 3',
    FLUSH_4: 'Flush (4 cards)',
    FLUSH_5: 'Flush (5 cards)',
    RIGHT_JACK: 'Right Jack',
    // Pegging
    PEGGING_FIFTEEN: 'Fifteen',
    PEGGING_THIRTY_ONE: 'Thirty-one',
    PEGGING_PAIR: 'Pair',
    PEGGING_THREE_OF_A_KIND: 'Three of a kind',
    PEGGING_FOUR_OF_A_KIND: 'Four of a kind',
    PEGGING_RUN_OF_3: 'Run of 3',
    PEGGING_RUN_OF_4: 'Run of 4',
    PEGGING_RUN_OF_5: 'Run of 5',
    PEGGING_RUN_OF_6: 'Run of 6',
    PEGGING_RUN_OF_7: 'Run of 7',
    // Special
    LAST_CARD: 'Last card',
    HEELS: 'Heels',
  };
  return descriptions[type];
}

/**
 * Create a breakdown item
 */
function createBreakdownItem(
  type: ScoreBreakdownType,
  points: number,
  cards: Card[]
): ScoreBreakdownItem {
  return {
    type,
    points,
    cards,
    description: getBreakdownDescription(type),
  };
}

// Export for use in scoring.ts
export { createBreakdownItem };

