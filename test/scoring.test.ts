// Import necessary modules and functions
import { scoreHand } from '../src/core/scoring';
import { Card } from '../src/types';

describe('Cribbage Scoring Tests', () => {
  /**
   * Test: Basic Fifteens
   * Description: Test scoring for hands with combinations summing to 15.
   */
  it('should correctly score fifteens in a hand', () => {
    const testCases = [
      {
        hand: [
          'FIVE_SPADES',
          'KING_CLUBS',
          'EIGHT_CLUBS',
          'THREE_CLUBS',
        ] as Card[],
        cutCard: 'NINE_CLUBS' as Card,
        isCrib: false,
      }, // 15-2 from 5+10

      {
        hand: [
          'FIVE_SPADES',
          'TEN_HEARTS',
          'FIVE_DIAMONDS',
          'FIVE_CLUBS',
        ] as Card[],
        cutCard: 'KING_SPADES' as Card,
        isCrib: false,
      }, // 6 fifteens from 5+10s and 1 from all three 5s and then 6 points for the three 5s

      {
        hand: [
          'FIVE_SPADES',
          'TEN_HEARTS',
          'ACE_CLUBS',
          'FOUR_CLUBS',
        ] as Card[],
        cutCard: 'KING_CLUBS' as Card,
        isCrib: false,
      }, // 2 fifteens from 5+10s and 2 from A+4+10s

      {
        hand: [
          'TWO_CLUBS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_HEARTS' as Card,
        isCrib: false,
      }, // All even numbers
    ];

    const expectedScores = [
      2, // First hand
      20, // Second hand
      8, // Third hand
      0, // Fourth hand (no fifteens)
    ];

    testCases.forEach((testCase, index) => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(expectedScores[index]);
    });
  });

  /**
   * Test: Pairs
   * Description: Test scoring for hands with pairs, three of a kind, and four of a kind.
   */
  it('should correctly score pairs in a hand', () => {
    const testCases = [
      {
        hand: [
          'TWO_HEARTS',
          'TWO_SPADES',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_HEARTS' as Card,
        isCrib: false,
      }, // Pair of Fives

      {
        hand: [
          'TWO_HEARTS',
          'TWO_SPADES',
          'TWO_CLUBS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TWO_DIAMONDS' as Card,
        isCrib: false,
      }, // Four of a kind
    ];

    const expectedScores = [
      2, // First hand (one pair)
      12, // Second hand (four of a kind: 6 pairs)
    ];

    testCases.forEach((testCase, index) => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(expectedScores[index]);
    });
  });

  /**
   * Test: Runs
   * Description: Test scoring for runs of three or more cards.
   */
  it('should correctly score runs in a hand', () => {
    const testCases = [
      {
        hand: [
          'TEN_CLUBS',
          'JACK_SPADES', // make sure to not match the suit of the cut card
          'QUEEN_DIAMONDS',
          'THREE_SPADES',
        ] as Card[],
        cutCard: 'SEVEN_HEARTS' as Card,
        isCrib: false,
      }, // Run of 3, plus extra card in sequence

      {
        hand: [
          'TEN_CLUBS',
          'JACK_SPADES', // make sure to not match the suit of the cut card
          'QUEEN_DIAMONDS',
          'KING_HEARTS',
        ] as Card[],
        cutCard: 'NINE_HEARTS' as Card,
        isCrib: false,
      }, // Run of 5
    ];

    const expectedScores = [
      3, // First hand
      5, // Second hand
    ];

    testCases.forEach((testCase, index) => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(expectedScores[index]);
    });
  });

  /**
   * Test: Flushes
   * Description: Test scoring for flushes.
   */
  it('should correctly score flushes in a hand', () => {
    const testCases = [
      {
        hand: [
          'TWO_HEARTS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_HEARTS' as Card,
        isCrib: false,
      }, // Flush of 5 cards

      {
        hand: [
          'TWO_HEARTS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_SPADES' as Card,
        isCrib: false,
      }, // Flush of 4 cards, no turn card match

      {
        hand: [
          'TWO_HEARTS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_SPADES' as Card,
        isCrib: true,
      }, // Crib failed flush - turn card does not match - should score 0

      {
        hand: [
          'TWO_HEARTS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_HEARTS' as Card,
        isCrib: true,
      }, // Crib flush - turn card matches - should score 5
    ];

    const expectedScores = [
      5, // Full flush
      4, // Partial flush
      0, // Crib flush with no match
      5, // Crib flush with match
    ];

    testCases.forEach((testCase, index) => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(expectedScores[index]);
    });
  });

  /**
   * Test: Right Jack (Nobs)
   * Description: Test scoring for having the right jack in the hand.
   */
  it('should correctly score right jacks (nobs)', () => {
    const testCases = [
      {
        hand: [
          'JACK_DIAMONDS',
          'SEVEN_HEARTS',
          'TWO_HEARTS',
          'ACE_HEARTS',
        ] as Card[],
        cutCard: 'NINE_DIAMONDS' as Card,
        isCrib: false,
      }, // Jack matches turn card suit

      {
        hand: [
          'JACK_DIAMONDS',
          'SEVEN_HEARTS',
          'TWO_HEARTS',
          'ACE_HEARTS',
        ] as Card[],
        cutCard: 'NINE_HEARTS' as Card,
        isCrib: false,
      }, // Jack does not match turn card suit
    ];

    const expectedScores = [
      1, // First hand (right jack)
      0, // Second hand (not a right jack)
    ];

    testCases.forEach((testCase, index) => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(expectedScores[index]);
    });
  });

  /**
   * Test: Edge Cases
   * Description: Test edge cases like an empty hand (invalid), invalid card counts, and maximum possible scores.
   */
  it('should handle edge cases and invalid inputs', () => {
    expect(() => scoreHand([], 'FOUR_HEARTS', false)).toThrowError(
      'Hand must contain exactly 4 cards.'
    );

    expect(() =>
      scoreHand(
        [
          'FIVE_HEARTS',
          'SEVEN_HEARTS',
          'TWO_HEARTS',
          'THREE_HEARTS',
          'FOUR_HEARTS',
        ] as Card[],
        'FOUR_HEARTS' as Card,
        false
      )
    ).toThrowError('Hand must contain exactly 4 cards.');
  });

  /**
   * Test: Double Runs
   *
   * Description: Test scoring for double runs of three or more cards.
   */
  it('should correctly score double runs in a hand', () => {
    const testCases = [
      // Double run of 3
      {
        hand: [
          'TEN_CLUBS',
          'JACK_SPADES', // make sure to not match the suit of the cut card
          'QUEEN_DIAMONDS',
          'QUEEN_CLUBS',
        ] as Card[],
        cutCard: 'SEVEN_HEARTS' as Card,
        isCrib: false,
        expectedScore: 8,
      },

      // double run of 4
      {
        hand: [
          'TEN_CLUBS',
          'JACK_SPADES', // make sure to not match the suit of the cut card
          'QUEEN_DIAMONDS',
          'QUEEN_CLUBS',
        ] as Card[],
        cutCard: 'KING_HEARTS' as Card,
        isCrib: false,
        expectedScore: 10,
      },

      // double double run of 3
      {
        hand: [
          'QUEEN_DIAMONDS',
          'QUEEN_CLUBS',
          'KING_HEARTS',
          'KING_CLUBS',
        ] as Card[],
        cutCard: 'JACK_SPADES' as Card,
        isCrib: false,
        expectedScore: 16,
      },
    ];

    testCases.forEach(testCase => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      try {
        expect(score).toEqual(testCase.expectedScore);
      } catch (e) {
        throw new Error(
          `Failed for hand: ${JSON.stringify(testCase.hand)} with cut card: ${
            testCase.cutCard
          }; Expected ${testCase.expectedScore} but got ${score}`
        );
      }
    });
  });

  // test various hand combos from played games:
  it('should handle various real world assortments of high scoring hands', () => {
    // 1: JACK_CLUBS, JACK_DIAMONDS, KING_DIAMONDS, FIVE_CLUBS with turn card QUEEN_DIAMONDS

    // each test case will contain: hand, turn card, is crib, and expected score
    const testCase1 = {
      hand: [
        'JACK_CLUBS',
        'JACK_DIAMONDS',
        'KING_DIAMONDS',
        'FIVE_CLUBS',
      ] as Card[],
      cutCard: 'QUEEN_DIAMONDS' as Card,
      isCrib: false,
      expectedScore: 17,
    };

    const testCases = [testCase1];

    testCases.forEach(testCase => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(testCase.expectedScore);
    });
  });
});
