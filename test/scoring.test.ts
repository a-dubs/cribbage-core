// Import necessary modules and functions
import { scoreHand, scorePegging } from '../src/core/scoring';
import { Card } from '../src/types';

describe('Cribbage Hand Scoring Tests', () => {
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
        expectedScore: 2, // 15-2 from 5+10
      },
      {
        hand: [
          'FIVE_SPADES',
          'TEN_HEARTS',
          'FIVE_DIAMONDS',
          'FIVE_CLUBS',
        ] as Card[],
        cutCard: 'KING_SPADES' as Card,
        isCrib: false,
        expectedScore: 20, // 6 fifteens from 5+10s and 1 from all three 5s and then 6 points for the three 5s
      },
      {
        hand: [
          'FIVE_SPADES',
          'TEN_HEARTS',
          'ACE_CLUBS',
          'FOUR_CLUBS',
        ] as Card[],
        cutCard: 'KING_CLUBS' as Card,
        isCrib: false,
        expectedScore: 8, // 2 fifteens from 5+10s and 2 from A+4+10s
      },
      {
        hand: [
          'TWO_CLUBS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_HEARTS' as Card,
        isCrib: false,
        expectedScore: 0, // All even numbers
      },
    ];

    testCases.forEach(testCase => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(testCase.expectedScore);
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
        expectedScore: 2, // Pair of Fives
      },
      {
        hand: [
          'TWO_HEARTS',
          'TWO_SPADES',
          'TWO_CLUBS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TWO_DIAMONDS' as Card,
        isCrib: false,
        expectedScore: 12, // Four of a kind
      },
    ];

    testCases.forEach(testCase => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(testCase.expectedScore);
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
        expectedScore: 3, // Run of 3, plus extra card in sequence
      },
      {
        hand: [
          'TEN_CLUBS',
          'JACK_SPADES', // make sure to not match the suit of the cut card
          'QUEEN_DIAMONDS',
          'KING_HEARTS',
        ] as Card[],
        cutCard: 'NINE_HEARTS' as Card,
        isCrib: false,
        expectedScore: 5, // Run of 5
      },
    ];

    testCases.forEach(testCase => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(testCase.expectedScore);
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
        expectedScore: 5, // Flush of 5 cards
      },
      {
        hand: [
          'TWO_HEARTS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_SPADES' as Card,
        isCrib: false,
        expectedScore: 4, // Flush of 4 cards, no turn card match
      },
      {
        hand: [
          'TWO_HEARTS',
          'FOUR_HEARTS',
          'SIX_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        cutCard: 'TEN_SPADES' as Card,
        isCrib: true,
        expectedScore: 0, // Crib failed flush - turn card does not match - should score 0
      },
    ];

    testCases.forEach(testCase => {
      const score = scoreHand(testCase.hand, testCase.cutCard, testCase.isCrib);
      expect(score).toEqual(testCase.expectedScore);
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

describe('Cribbage Pegging Scoring Tests', () => {
  // test, 15s, 31s, pairs & triples & quads, and runs

  // TESTING 15s
  it('should correctly score 15s in a pegging stack', () => {
    const testCases = [
      // simple 15 with 5 and face card
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'TEN_CLUBS',
        ] as Card[],
        expectedScore: 2, // 15 from 5+10
      },
      // simple 15 with 3 different cards
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_CLUBS',
          'TEN_SPADES',
          'THREE_DIAMONDS',
        ] as Card[],
        expectedScore: 2, // 15 from 2+10+3
      },
      // no 15 (16)
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_CLUBS',
          'TEN_SPADES',
          'FOUR_DIAMONDS',
        ] as Card[],
        expectedScore: 0, // no 15
      },
    ];

    testCases.forEach(testCase => {
      const score = scorePegging(testCase.peggingStack);
      try {
        expect(score).toEqual(testCase.expectedScore);
      } catch (e) {
        throw new Error(
          `Failed for pegging stack: ${JSON.stringify(
            testCase.peggingStack
          )}; Expected ${testCase.expectedScore} but got ${score}`
        );
      }
    });
  });

  // TESTING 31s
  it('should correctly score 31s in a pegging stack', () => {
    const testCases = [
      // simple 31
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'TEN_CLUBS',
          'SIX_DIAMONDS',
          'TEN_SPADES',
        ] as Card[],
        expectedScore: 2, // 31 from 5+10+6+10
      },
      // no 31
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'TEN_CLUBS',
          'SIX_DIAMONDS',
          'NINE_SPADES',
        ] as Card[],
        expectedScore: 0, // no 31
      },
    ];

    testCases.forEach(testCase => {
      const score = scorePegging(testCase.peggingStack);
      try {
        expect(score).toEqual(testCase.expectedScore);
      } catch (e) {
        throw new Error(
          `Failed for pegging stack: ${JSON.stringify(
            testCase.peggingStack
          )}; Expected ${testCase.expectedScore} but got ${score}`
        );
      }
    });
  });

  it('should correctly score pairs, triples, and quads in a pegging stack', () => {
    // test pairs, triples, and quads
    // for each test case, do one where it is and is not a match
    // for a total of 6 test cases
    const testCases = [
      // Pair
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_HEARTS',
          'THREE_CLUBS',
          'TWO_CLUBS',
          'TWO_SPADES',
        ] as Card[],
        expectedScore: 2, // Pair of twos
      },
      // Triple
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_HEARTS',
          'THREE_CLUBS',
          'TWO_CLUBS',
          'TWO_SPADES',
          'TWO_DIAMONDS',
        ] as Card[],
        expectedScore: 6, // Three twos
      },
      // Quad
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TEN_CLUBS',
          'TWO_CLUBS',
          'TWO_SPADES',
          'TWO_DIAMONDS',
          'TWO_HEARTS',
        ] as Card[],
        expectedScore: 12, // Four twos
      },
      // No pair
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_CLUBS',
          'TWO_DIAMONDS',
          'THREE_SPADES',
        ] as Card[],
        expectedScore: 0, // pair is not at the end
      },
      // No triple
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_CLUBS',
          'TWO_SPADES',
          'TWO_DIAMONDS',
          'THREE_DIAMONDS',
        ] as Card[],
        expectedScore: 0, // triple is not at the end
      },
      // No quad
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'TWO_CLUBS',
          'TWO_SPADES',
          'TWO_DIAMONDS',
          'TWO_HEARTS',
          'THREE_HEARTS',
        ] as Card[],
        expectedScore: 0, // quad is not at the end
      },
    ];

    testCases.forEach(testCase => {
      const score = scorePegging(testCase.peggingStack);
      try {
        expect(score).toEqual(testCase.expectedScore);
      } catch (e) {
        throw new Error(
          `Failed for pegging stack: ${JSON.stringify(
            testCase.peggingStack
          )}; Expected ${testCase.expectedScore} but got ${score}`
        );
      }
    });
  });

  // TESTING RUNS
  it('should correctly score runs in a pegging stack', () => {
    const testCases = [
      // Run of 3
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'SIX_CLUBS',
          'FIVE_SPADES',
          'SEVEN_DIAMONDS',
        ] as Card[],
        expectedScore: 3, // Run of 3
      },
      // Interrupted run of 3
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'SIX_CLUBS',
          'SEVEN_DIAMONDS',
          'FIVE_SPADES',
          'SEVEN_DIAMONDS',
        ] as Card[],
        expectedScore: 0, // no run
      },
      // Run of 3 buried in stack
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'SIX_CLUBS',
          'FIVE_SPADES',
          'SEVEN_DIAMONDS',
          'KING_CLUBS',
        ] as Card[],
        expectedScore: 0, // no run
      },
      // Run of 4
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'SIX_CLUBS',
          'SEVEN_DIAMONDS',
          'EIGHT_HEARTS',
        ] as Card[],
        expectedScore: 4, // Run of 4
      },
      // Interrupted run of 4
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'SIX_CLUBS',
          'SEVEN_DIAMONDS',
          'SEVEN_DIAMONDS',
          'EIGHT_HEARTS',
        ] as Card[],
        expectedScore: 0, // No run
      },
      // Run of 5
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'SIX_CLUBS',
          'SEVEN_DIAMONDS',
          'FOUR_HEARTS',
          'EIGHT_HEARTS',
        ] as Card[],
        expectedScore: 5, // Run of 5
      },
      // No run
      {
        // eslint-disable-next-line prettier/prettier
        peggingStack: [
          'FIVE_SPADES',
          'SIX_CLUBS',
          'EIGHT_DIAMONDS',
        ] as Card[],
        expectedScore: 0, // No run
      },
    ];

    testCases.forEach(testCase => {
      const score = scorePegging(testCase.peggingStack);
      try {
        expect(score).toEqual(testCase.expectedScore);
      } catch (e) {
        throw new Error(
          `Failed for pegging stack: ${JSON.stringify(
            testCase.peggingStack
          )}; Expected ${testCase.expectedScore} but got ${score}`
        );
      }
    });
  });
});
