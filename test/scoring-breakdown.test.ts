// Comprehensive tests for scoring breakdown system
// Tests all 26 scoring breakdown types with detailed verification

import { Card, ScoreBreakdownItem } from '../src/types';
import {
  scoreHandWithBreakdown,
  scorePeggingWithBreakdown,
} from '../src/core/scoring';

describe('Scoring Breakdown System', () => {
  // Helper function to verify breakdown item
  function verifyBreakdownItem(
    item: ScoreBreakdownItem,
    expectedType: ScoreBreakdownItem['type'],
    expectedPoints: number,
    expectedCardCount: number | any, // any to allow expect.any(Number)
    expectedDescription?: string
  ) {
    expect(item.type).toBe(expectedType);
    expect(item.points).toBe(expectedPoints);
    // Check if expectedCardCount is a Jest matcher (like expect.any)
    if (expectedCardCount && typeof expectedCardCount === 'object' && expectedCardCount.asymmetricMatch) {
      expect(item.cards.length).toEqual(expectedCardCount);
    } else {
      expect(item.cards.length).toBe(expectedCardCount);
    }
    if (expectedDescription) {
      expect(item.description).toBe(expectedDescription);
    }
  }

  // Helper to verify total matches breakdown sum
  function verifyTotalMatchesBreakdown(
    total: number,
    breakdown: ScoreBreakdownItem[]
  ) {
    const breakdownSum = breakdown.reduce((sum, item) => sum + item.points, 0);
    expect(total).toBe(breakdownSum);
  }

  describe('Hand/Crib Scoring Breakdown', () => {
    describe('FIFTEEN', () => {
      it('should detect single fifteen', () => {
        const hand: Card[] = ['FIVE_SPADES', 'KING_HEARTS', 'EIGHT_CLUBS', 'THREE_CLUBS'];
        const cutCard: Card = 'NINE_CLUBS';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        expect(result.breakdown.length).toBe(1);
        verifyBreakdownItem(
          result.breakdown[0],
          'FIFTEEN',
          2,
          2,
          'Fifteen'
        );
        expect(result.breakdown[0].cards).toContain('FIVE_SPADES');
        expect(result.breakdown[0].cards).toContain('KING_HEARTS');
      });

      it('should detect multiple fifteens', () => {
        const hand: Card[] = ['FIVE_SPADES', 'FIVE_DIAMONDS', 'FIVE_CLUBS', 'SEVEN_HEARTS'];
        const cutCard: Card = 'KING_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        // Should have multiple FIFTEEN items (one for each combination)
        const fifteenItems = result.breakdown.filter(item => item.type === 'FIFTEEN');
        expect(fifteenItems.length).toBeGreaterThan(1);
        fifteenItems.forEach(item => {
          verifyBreakdownItem(item, 'FIFTEEN', 2, expect.any(Number), 'Fifteen');
        });
      });
    });

    describe('PAIR', () => {
      it('should detect pair', () => {
        const hand: Card[] = ['FIVE_SPADES', 'FIVE_HEARTS', 'SEVEN_CLUBS', 'EIGHT_DIAMONDS'];
        const cutCard: Card = 'NINE_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const pairItem = result.breakdown.find(item => item.type === 'PAIR');
        expect(pairItem).toBeDefined();
        if (pairItem) {
          verifyBreakdownItem(pairItem, 'PAIR', 2, 2, 'Pair');
          expect(pairItem.cards).toContain('FIVE_SPADES');
          expect(pairItem.cards).toContain('FIVE_HEARTS');
        }
      });

      it('should not detect pair if cards are in a double run', () => {
        const hand: Card[] = ['TWO_SPADES', 'THREE_HEARTS', 'FOUR_CLUBS', 'FOUR_DIAMONDS'];
        const cutCard: Card = 'SEVEN_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        // Should have DOUBLE_RUN_OF_3, not separate PAIR
        const doubleRun = result.breakdown.find(item => item.type === 'DOUBLE_RUN_OF_3');
        expect(doubleRun).toBeDefined();
        const pairItem = result.breakdown.find(item => item.type === 'PAIR');
        // The pair should NOT appear separately (it's part of the double run)
        expect(pairItem).toBeUndefined();
      });
    });

    describe('THREE_OF_A_KIND', () => {
      it('should detect three of a kind', () => {
        const hand: Card[] = ['FIVE_SPADES', 'FIVE_HEARTS', 'FIVE_CLUBS', 'SEVEN_DIAMONDS'];
        const cutCard: Card = 'EIGHT_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const tripsItem = result.breakdown.find(item => item.type === 'THREE_OF_A_KIND');
        expect(tripsItem).toBeDefined();
        if (tripsItem) {
          verifyBreakdownItem(tripsItem, 'THREE_OF_A_KIND', 6, 3, 'Three of a kind');
          expect(tripsItem.cards).toContain('FIVE_SPADES');
          expect(tripsItem.cards).toContain('FIVE_HEARTS');
          expect(tripsItem.cards).toContain('FIVE_CLUBS');
        }
      });
    });

    describe('FOUR_OF_A_KIND', () => {
      it('should detect four of a kind', () => {
        const hand: Card[] = ['FIVE_SPADES', 'FIVE_HEARTS', 'FIVE_CLUBS', 'FIVE_DIAMONDS'];
        const cutCard: Card = 'SEVEN_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const fourOfAKindItem = result.breakdown.find(item => item.type === 'FOUR_OF_A_KIND');
        expect(fourOfAKindItem).toBeDefined();
        if (fourOfAKindItem) {
          verifyBreakdownItem(fourOfAKindItem, 'FOUR_OF_A_KIND', 12, 4, 'Four of a kind');
        }
      });
    });

    describe('RUN_OF_3', () => {
      it('should detect run of 3', () => {
        const hand: Card[] = ['FIVE_SPADES', 'SIX_HEARTS', 'SEVEN_CLUBS', 'NINE_DIAMONDS'];
        const cutCard: Card = 'TEN_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'RUN_OF_3');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'RUN_OF_3', 3, 3, 'Run of 3');
        }
      });
    });

    describe('RUN_OF_4', () => {
      it('should detect run of 4', () => {
        // Hand with 4 consecutive cards, cut card doesn't extend the run
        const hand: Card[] = ['FIVE_SPADES', 'SIX_HEARTS', 'SEVEN_CLUBS', 'EIGHT_DIAMONDS'];
        const cutCard: Card = 'TWO_SPADES'; // Not part of the run
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'RUN_OF_4');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'RUN_OF_4', 4, 4, 'Run of 4');
        }
      });
    });

    describe('RUN_OF_5', () => {
      it('should detect run of 5', () => {
        const hand: Card[] = ['FIVE_SPADES', 'SIX_HEARTS', 'SEVEN_CLUBS', 'EIGHT_DIAMONDS'];
        const cutCard: Card = 'NINE_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'RUN_OF_5');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'RUN_OF_5', 5, 5, 'Run of 5');
        }
      });
    });

    describe('DOUBLE_RUN_OF_3', () => {
      it('should detect double run of 3', () => {
        const hand: Card[] = ['TWO_SPADES', 'THREE_HEARTS', 'FOUR_CLUBS', 'FOUR_DIAMONDS'];
        const cutCard: Card = 'SEVEN_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const doubleRunItem = result.breakdown.find(item => item.type === 'DOUBLE_RUN_OF_3');
        expect(doubleRunItem).toBeDefined();
        if (doubleRunItem) {
          verifyBreakdownItem(doubleRunItem, 'DOUBLE_RUN_OF_3', 8, 4, 'Double run of 3');
          // Should NOT have separate PAIR or RUN_OF_3 items
          const pairItem = result.breakdown.find(item => item.type === 'PAIR');
          const runItem = result.breakdown.find(item => item.type === 'RUN_OF_3');
          expect(pairItem).toBeUndefined();
          expect(runItem).toBeUndefined();
        }
      });
    });

    describe('DOUBLE_RUN_OF_4', () => {
      it('should detect double run of 4', () => {
        const hand: Card[] = ['TWO_SPADES', 'THREE_HEARTS', 'FOUR_CLUBS', 'FIVE_DIAMONDS'];
        const cutCard: Card = 'FIVE_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const doubleRunItem = result.breakdown.find(item => item.type === 'DOUBLE_RUN_OF_4');
        expect(doubleRunItem).toBeDefined();
        if (doubleRunItem) {
          verifyBreakdownItem(doubleRunItem, 'DOUBLE_RUN_OF_4', 10, 5, 'Double run of 4');
        }
      });
    });

    describe('TRIPLE_RUN_OF_3', () => {
      it('should detect triple run of 3', () => {
        const hand: Card[] = ['TWO_SPADES', 'THREE_HEARTS', 'FOUR_CLUBS', 'FOUR_DIAMONDS'];
        const cutCard: Card = 'FOUR_HEARTS';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const tripleRunItem = result.breakdown.find(item => item.type === 'TRIPLE_RUN_OF_3');
        expect(tripleRunItem).toBeDefined();
        if (tripleRunItem) {
          verifyBreakdownItem(tripleRunItem, 'TRIPLE_RUN_OF_3', 15, 5, 'Triple run of 3');
        }
      });
    });

    describe('QUADRUPLE_RUN_OF_3', () => {
      it('should detect quadruple run of 3', () => {
        const hand: Card[] = ['TWO_SPADES', 'THREE_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS'];
        const cutCard: Card = 'FOUR_HEARTS';
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const quadrupleRunItem = result.breakdown.find(item => item.type === 'QUADRUPLE_RUN_OF_3');
        expect(quadrupleRunItem).toBeDefined();
        if (quadrupleRunItem) {
          verifyBreakdownItem(quadrupleRunItem, 'QUADRUPLE_RUN_OF_3', 16, 5, 'Quadruple run of 3');
        }
      });
    });

    describe('FLUSH_4', () => {
      it('should detect flush of 4 (hand only, not crib)', () => {
        const hand: Card[] = ['FIVE_HEARTS', 'SEVEN_HEARTS', 'NINE_HEARTS', 'JACK_HEARTS'];
        const cutCard: Card = 'THREE_SPADES'; // Different suit
        const result = scoreHandWithBreakdown(hand, cutCard, false); // isCrib: false

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const flushItem = result.breakdown.find(item => item.type === 'FLUSH_4');
        expect(flushItem).toBeDefined();
        if (flushItem) {
          verifyBreakdownItem(flushItem, 'FLUSH_4', 4, 4, 'Flush (4 cards)');
        }
      });

      it('should not detect flush of 4 in crib', () => {
        const hand: Card[] = ['FIVE_HEARTS', 'SEVEN_HEARTS', 'NINE_HEARTS', 'JACK_HEARTS'];
        const cutCard: Card = 'THREE_SPADES';
        const result = scoreHandWithBreakdown(hand, cutCard, true); // isCrib: true

        const flush4Item = result.breakdown.find(item => item.type === 'FLUSH_4');
        expect(flush4Item).toBeUndefined(); // Crib requires 5 cards for flush
      });
    });

    describe('FLUSH_5', () => {
      it('should detect flush of 5 (hand + cut card)', () => {
        const hand: Card[] = ['FIVE_HEARTS', 'SEVEN_HEARTS', 'NINE_HEARTS', 'JACK_HEARTS'];
        const cutCard: Card = 'THREE_HEARTS'; // Same suit
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const flushItem = result.breakdown.find(item => item.type === 'FLUSH_5');
        expect(flushItem).toBeDefined();
        if (flushItem) {
          verifyBreakdownItem(flushItem, 'FLUSH_5', 5, 5, 'Flush (5 cards)');
        }
      });
    });

    describe('RIGHT_JACK', () => {
      it('should detect right jack', () => {
        const hand: Card[] = ['FIVE_SPADES', 'SEVEN_HEARTS', 'NINE_CLUBS', 'JACK_SPADES'];
        const cutCard: Card = 'THREE_SPADES'; // Same suit as Jack
        const result = scoreHandWithBreakdown(hand, cutCard, false);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const rightJackItem = result.breakdown.find(item => item.type === 'RIGHT_JACK');
        expect(rightJackItem).toBeDefined();
        if (rightJackItem) {
          verifyBreakdownItem(rightJackItem, 'RIGHT_JACK', 1, 1, 'Right Jack');
          expect(rightJackItem.cards).toContain('JACK_SPADES');
        }
      });
    });
  });

  describe('Pegging Scoring Breakdown', () => {
    describe('PEGGING_FIFTEEN', () => {
      it('should detect pegging fifteen', () => {
        const peggingStack: Card[] = ['FIVE_SPADES', 'TEN_HEARTS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const fifteenItem = result.breakdown.find(item => item.type === 'PEGGING_FIFTEEN');
        expect(fifteenItem).toBeDefined();
        if (fifteenItem) {
          verifyBreakdownItem(fifteenItem, 'PEGGING_FIFTEEN', 2, 2, 'Fifteen');
          // Should include ALL cards in stack
          expect(fifteenItem.cards).toEqual(peggingStack);
        }
      });
    });

    describe('PEGGING_THIRTY_ONE', () => {
      it('should detect pegging thirty-one', () => {
        const peggingStack: Card[] = ['FIVE_SPADES', 'TEN_HEARTS', 'TEN_CLUBS', 'SIX_DIAMONDS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const thirtyOneItem = result.breakdown.find(item => item.type === 'PEGGING_THIRTY_ONE');
        expect(thirtyOneItem).toBeDefined();
        if (thirtyOneItem) {
          verifyBreakdownItem(thirtyOneItem, 'PEGGING_THIRTY_ONE', 2, 4, 'Thirty-one');
          // Should include ALL cards in stack
          expect(thirtyOneItem.cards).toEqual(peggingStack);
        }
      });
    });

    describe('PEGGING_PAIR', () => {
      it('should detect pegging pair', () => {
        const peggingStack: Card[] = ['FIVE_SPADES', 'SEVEN_HEARTS', 'SEVEN_CLUBS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const pairItem = result.breakdown.find(item => item.type === 'PEGGING_PAIR');
        expect(pairItem).toBeDefined();
        if (pairItem) {
          verifyBreakdownItem(pairItem, 'PEGGING_PAIR', 2, 2, 'Pair');
          expect(pairItem.cards).toContain('SEVEN_HEARTS');
          expect(pairItem.cards).toContain('SEVEN_CLUBS');
        }
      });
    });

    describe('PEGGING_THREE_OF_A_KIND', () => {
      it('should detect pegging three of a kind', () => {
        const peggingStack: Card[] = ['FIVE_SPADES', 'SEVEN_HEARTS', 'SEVEN_CLUBS', 'SEVEN_DIAMONDS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const tripsItem = result.breakdown.find(item => item.type === 'PEGGING_THREE_OF_A_KIND');
        expect(tripsItem).toBeDefined();
        if (tripsItem) {
          verifyBreakdownItem(tripsItem, 'PEGGING_THREE_OF_A_KIND', 6, 3, 'Three of a kind');
        }
      });
    });

    describe('PEGGING_FOUR_OF_A_KIND', () => {
      it('should detect pegging four of a kind', () => {
        const peggingStack: Card[] = ['FIVE_SPADES', 'SEVEN_HEARTS', 'SEVEN_CLUBS', 'SEVEN_DIAMONDS', 'SEVEN_SPADES'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const fourOfAKindItem = result.breakdown.find(item => item.type === 'PEGGING_FOUR_OF_A_KIND');
        expect(fourOfAKindItem).toBeDefined();
        if (fourOfAKindItem) {
          verifyBreakdownItem(fourOfAKindItem, 'PEGGING_FOUR_OF_A_KIND', 12, 4, 'Four of a kind');
        }
      });
    });

    describe('PEGGING_RUN_OF_3', () => {
      it('should detect pegging run of 3', () => {
        const peggingStack: Card[] = ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'PEGGING_RUN_OF_3');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'PEGGING_RUN_OF_3', 3, 3, 'Run of 3');
        }
      });
    });

    describe('PEGGING_RUN_OF_4', () => {
      it('should detect pegging run of 4', () => {
        const peggingStack: Card[] = ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'PEGGING_RUN_OF_4');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'PEGGING_RUN_OF_4', 4, 4, 'Run of 4');
        }
      });
    });

    describe('PEGGING_RUN_OF_5', () => {
      it('should detect pegging run of 5', () => {
        const peggingStack: Card[] = ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS', 'FIVE_HEARTS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'PEGGING_RUN_OF_5');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'PEGGING_RUN_OF_5', 5, 5, 'Run of 5');
        }
        // Should also have PEGGING_FIFTEEN (sum = 15)
        const fifteenItem = result.breakdown.find(item => item.type === 'PEGGING_FIFTEEN');
        expect(fifteenItem).toBeDefined();
      });
    });

    describe('PEGGING_RUN_OF_6', () => {
      it('should detect pegging run of 6', () => {
        const peggingStack: Card[] = ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS', 'FIVE_HEARTS', 'SIX_CLUBS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'PEGGING_RUN_OF_6');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'PEGGING_RUN_OF_6', 6, 6, 'Run of 6');
        }
      });
    });

    describe('PEGGING_RUN_OF_7', () => {
      it('should detect pegging run of 7 (maximum)', () => {
        const peggingStack: Card[] = ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS', 'FIVE_HEARTS', 'SIX_CLUBS', 'SEVEN_SPADES'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        const runItem = result.breakdown.find(item => item.type === 'PEGGING_RUN_OF_7');
        expect(runItem).toBeDefined();
        if (runItem) {
          verifyBreakdownItem(runItem, 'PEGGING_RUN_OF_7', 7, 7, 'Run of 7');
        }
      });
    });

    describe('Multiple pegging scores', () => {
      it('should detect multiple scoring types simultaneously', () => {
        // Stack that scores fifteen + pair + run
        const peggingStack: Card[] = ['FIVE_SPADES', 'FIVE_HEARTS', 'FIVE_CLUBS'];
        const result = scorePeggingWithBreakdown(peggingStack);

        verifyTotalMatchesBreakdown(result.total, result.breakdown);
        // Should have PEGGING_FIFTEEN (5+5+5 = 15)
        const fifteenItem = result.breakdown.find(item => item.type === 'PEGGING_FIFTEEN');
        expect(fifteenItem).toBeDefined();
        // Should have PEGGING_THREE_OF_A_KIND (three 5s)
        const tripsItem = result.breakdown.find(item => item.type === 'PEGGING_THREE_OF_A_KIND');
        expect(tripsItem).toBeDefined();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle hand with no scoring', () => {
      const hand: Card[] = ['TWO_CLUBS', 'FOUR_HEARTS', 'SIX_HEARTS', 'EIGHT_HEARTS'];
      const cutCard: Card = 'TEN_HEARTS';
      const result = scoreHandWithBreakdown(hand, cutCard, false);

      expect(result.total).toBe(0);
      expect(result.breakdown.length).toBe(0);
    });

    it('should handle pegging stack with no scoring', () => {
      const peggingStack: Card[] = ['TWO_SPADES', 'THREE_HEARTS'];
      const result = scorePeggingWithBreakdown(peggingStack);

      expect(result.total).toBe(0);
      expect(result.breakdown.length).toBe(0);
    });

    it('should prioritize complex runs over simple runs and pairs', () => {
      const hand: Card[] = ['TWO_SPADES', 'THREE_HEARTS', 'FOUR_CLUBS', 'FOUR_DIAMONDS'];
      const cutCard: Card = 'SEVEN_SPADES';
      const result = scoreHandWithBreakdown(hand, cutCard, false);

      // Should have DOUBLE_RUN_OF_3, not separate RUN_OF_3 + PAIR
      const doubleRun = result.breakdown.find(item => item.type === 'DOUBLE_RUN_OF_3');
      expect(doubleRun).toBeDefined();
      const simpleRun = result.breakdown.find(item => item.type === 'RUN_OF_3');
      const pair = result.breakdown.find(item => item.type === 'PAIR');
      expect(simpleRun).toBeUndefined();
      expect(pair).toBeUndefined();
    });
  });
});

