import {
  scorePegging,
  scoreHand,
  parseCard,
  sumOfPeggingStack,
} from '../src/core/scoring';
import { Card } from '../src/types';

describe('Scoring Performance Tests', () => {
  describe('parseCard performance', () => {
    it('should parse cards quickly', () => {
      const cards: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
        'FIVE_SPADES',
        'SIX_HEARTS',
        'SEVEN_CLUBS',
        'EIGHT_DIAMONDS',
        'NINE_SPADES',
        'TEN_HEARTS',
        'JACK_CLUBS',
        'QUEEN_DIAMONDS',
        'KING_SPADES',
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        for (const card of cards) {
          parseCard(card);
        }
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / (iterations * cards.length);

      console.log(`parseCard: ${iterations * cards.length} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(0.1); // Should be very fast
    });
  });

  describe('scorePegging performance', () => {
    it('should score empty stack quickly', () => {
      const iterations = 10000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging([]);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging([]): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(0.1);
    });

    it('should score small stacks quickly', () => {
      const stacks: Card[][] = [
        ['ACE_SPADES'],
        ['ACE_SPADES', 'TWO_HEARTS'],
        ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS'],
        ['FIVE_SPADES', 'FIVE_HEARTS'], // Pair
        ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS'], // Run
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        for (const stack of stacks) {
          scorePegging(stack);
        }
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / (iterations * stacks.length);

      console.log(`scorePegging(small stacks): ${iterations * stacks.length} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(1); // Should be fast
    });

    it('should score medium stacks efficiently', () => {
      const stack: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
        'FIVE_SPADES',
        'SIX_HEARTS',
        'SEVEN_CLUBS',
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(7 cards): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(5); // Should handle medium stacks reasonably
    });

    it('should score large stacks efficiently', () => {
      const stack: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
        'FIVE_SPADES',
        'SIX_HEARTS',
        'SEVEN_CLUBS',
        'EIGHT_DIAMONDS',
        'NINE_SPADES',
        'TEN_HEARTS',
      ];

      const iterations = 500;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(10 cards): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(10); // Should handle large stacks reasonably
    });

    it('should handle stacks with pairs efficiently', () => {
      const stack: Card[] = [
        'FIVE_SPADES',
        'FIVE_HEARTS',
        'FIVE_CLUBS',
        'FIVE_DIAMONDS',
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(4 of a kind): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(2);
    });

    it('should handle stacks with runs efficiently', () => {
      const stack: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
        'FIVE_SPADES',
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(run of 5): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(2);
    });

    it('should handle stacks that sum to 15 efficiently', () => {
      const stack: Card[] = ['FIVE_SPADES', 'TEN_HEARTS'];

      const iterations = 10000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(sum=15): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(0.5);
    });

    it('should handle stacks that sum to 31 efficiently', () => {
      const stack: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
        'FIVE_SPADES',
        'SIX_HEARTS',
        'TEN_CLUBS',
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(sum=31): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(5);
    });
  });

  describe('scoreHand performance', () => {
    it('should score hands quickly', () => {
      const hand: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
      ];
      const cutCard: Card = 'FIVE_SPADES';

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scoreHand(hand, cutCard, false);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scoreHand: ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(5);
    });

    it('should score hands with pairs efficiently', () => {
      const hand: Card[] = [
        'FIVE_SPADES',
        'FIVE_HEARTS',
        'SIX_CLUBS',
        'SEVEN_DIAMONDS',
      ];
      const cutCard: Card = 'EIGHT_SPADES';

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scoreHand(hand, cutCard, false);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scoreHand(with pairs): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(5);
    });

    it('should score hands with runs efficiently', () => {
      const hand: Card[] = [
        'ACE_SPADES',
        'TWO_HEARTS',
        'THREE_CLUBS',
        'FOUR_DIAMONDS',
      ];
      const cutCard: Card = 'FIVE_SPADES';

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scoreHand(hand, cutCard, false);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scoreHand(with runs): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(5);
    });
  });

  describe('sumOfPeggingStack performance', () => {
    it('should sum stacks quickly', () => {
      const stacks: Card[][] = [
        [],
        ['ACE_SPADES'],
        ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS'],
        ['FIVE_SPADES', 'FIVE_HEARTS', 'FIVE_CLUBS', 'FIVE_DIAMONDS'],
        [
          'ACE_SPADES',
          'TWO_HEARTS',
          'THREE_CLUBS',
          'FOUR_DIAMONDS',
          'FIVE_SPADES',
          'SIX_HEARTS',
          'SEVEN_CLUBS',
          'EIGHT_DIAMONDS',
          'NINE_SPADES',
          'TEN_HEARTS',
        ],
      ];

      const iterations = 10000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        for (const stack of stacks) {
          sumOfPeggingStack(stack);
        }
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / (iterations * stacks.length);

      console.log(`sumOfPeggingStack: ${iterations * stacks.length} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(0.1); // Should be very fast
    });
  });

  describe('scorePegging with various realistic game states', () => {
    it('should handle early game pegging efficiently', () => {
      // Early game: few cards played
      const stacks: Card[][] = [
        ['ACE_SPADES'],
        ['ACE_SPADES', 'TWO_HEARTS'],
        ['FIVE_SPADES', 'TEN_HEARTS'], // 15
      ];

      const iterations = 2000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        for (const stack of stacks) {
          scorePegging(stack);
        }
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / (iterations * stacks.length);

      console.log(`scorePegging(early game): ${iterations * stacks.length} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(1);
    });

    it('should handle mid game pegging efficiently', () => {
      // Mid game: some cards played
      const stacks: Card[][] = [
        ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS'],
        ['FIVE_SPADES', 'FIVE_HEARTS', 'FIVE_CLUBS'], // Trips
        ['ACE_SPADES', 'TWO_HEARTS', 'THREE_CLUBS', 'FOUR_DIAMONDS', 'FIVE_SPADES'], // Run
      ];

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        for (const stack of stacks) {
          scorePegging(stack);
        }
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / (iterations * stacks.length);

      console.log(`scorePegging(mid game): ${iterations * stacks.length} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(2);
    });

    it('should handle complex scoring scenarios efficiently', () => {
      // Complex: multiple scoring opportunities
      const stack: Card[] = [
        'FIVE_SPADES',
        'FIVE_HEARTS',
        'FIVE_CLUBS',
        'FIVE_DIAMONDS',
      ]; // 4 of a kind = 12 points

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        scorePegging(stack);
      }

      const duration = Date.now() - startTime;
      const avgTime = duration / iterations;

      console.log(`scorePegging(complex): ${iterations} calls in ${duration}ms (avg: ${avgTime.toFixed(3)}ms per call)`);
      expect(avgTime).toBeLessThan(2);
    });
  });
});

