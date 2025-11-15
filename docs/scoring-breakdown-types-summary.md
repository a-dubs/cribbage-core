# Scoring Breakdown Types - Complete Enumeration

This document provides a clean enumeration of all scoring breakdown types for review and approval.

## Hand/Crib Scoring Types

| Type | Points | Description | Detection | Example Cards |
|------|--------|-------------|-----------|---------------|
| `FIFTEEN` | 2 | Combination summing to 15 | Any 2-5 cards sum to 15 (peg values) | `[5_SPADES, KING_HEARTS]` |
| `PAIR` | 2 | Two cards same rank | Two cards same rank, NOT in run | `[5_SPADES, 5_HEARTS]` |
| `THREE_OF_A_KIND` | 6 | Three cards same rank | Three cards same rank, NOT in run | `[5_SPADES, 5_HEARTS, 5_CLUBS]` |
| `FOUR_OF_A_KIND` | 12 | Four cards same rank | Four cards same rank, NOT in run | `[5_SPADES, 5_HEARTS, 5_CLUBS, 5_DIAMONDS]` |
| `RUN_OF_3` | 3 | Three consecutive cards | Three consecutive (run value), NOT in complex run | `[5_SPADES, 6_HEARTS, 7_CLUBS]` |
| `RUN_OF_4` | 4 | Four consecutive cards | Four consecutive (run value), NOT in complex run | `[5_SPADES, 6_HEARTS, 7_CLUBS, 8_DIAMONDS]` |
| `RUN_OF_5` | 5 | Five consecutive cards | Five consecutive (run value), NOT in complex run | `[5_SPADES, 6_HEARTS, 7_CLUBS, 8_DIAMONDS, 9_SPADES]` |
| `DOUBLE_RUN_OF_3` | 8 | Run of 3 with one duplicate | Run of 3 + one duplicate card | `[2_SPADES, 3_HEARTS, 4_CLUBS, 4_DIAMONDS]` |
| `DOUBLE_RUN_OF_4` | 10 | Run of 4 with one duplicate | Run of 4 + one duplicate card | `[2_SPADES, 3_HEARTS, 4_CLUBS, 5_DIAMONDS, 5_SPADES]` |
| `TRIPLE_RUN_OF_3` | 15 | Run of 3 with two duplicates | Run of 3 + two duplicate cards | `[2_SPADES, 3_HEARTS, 4_CLUBS, 4_DIAMONDS, 4_HEARTS]` |
| `QUADRUPLE_RUN_OF_3` | 16 | Run of 3 with three duplicates | Run of 3 + three duplicate cards | `[2_SPADES, 3_HEARTS, 3_CLUBS, 4_DIAMONDS, 4_HEARTS]` |
| `FLUSH_4` | 4 | Four cards same suit | All 4 hand cards same suit, cut different, NOT crib | `[5_HEARTS, 7_HEARTS, 9_HEARTS, JACK_HEARTS]` |
| `FLUSH_5` | 5 | Five cards same suit | All 4 hand + cut card same suit | `[5_HEARTS, 7_HEARTS, 9_HEARTS, JACK_HEARTS, 3_HEARTS]` |
| `RIGHT_JACK` | 1 | Jack matching cut card suit | Jack in hand with same suit as cut card | `[JACK_SPADES]` (cut: `3_SPADES`) |

## Pegging Scoring Types

| Type | Points | Description | Detection | Example Cards |
|------|--------|-------------|-----------|---------------|
| `PEGGING_FIFTEEN` | 2 | Stack sums to 15 | Sum of all cards = 15 | All cards in pegging stack |
| `PEGGING_THIRTY_ONE` | 2 | Stack sums to 31 | Sum of all cards = 31 | All cards in pegging stack |
| `PEGGING_PAIR` | 2 | Last 2 cards same rank | Last 2 cards same rank | `[7_HEARTS, 7_CLUBS]` |
| `PEGGING_THREE_OF_A_KIND` | 6 | Last 3 cards same rank | Last 3 cards same rank | `[7_HEARTS, 7_CLUBS, 7_DIAMONDS]` |
| `PEGGING_FOUR_OF_A_KIND` | 12 | Last 4 cards same rank | Last 4 cards same rank | `[7_HEARTS, 7_CLUBS, 7_DIAMONDS, 7_SPADES]` |
| `PEGGING_RUN_OF_3` | 3 | Last 3 cards form run | Last 3 cards consecutive, no duplicates | `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS]` |
| `PEGGING_RUN_OF_4` | 4 | Last 4 cards form run | Last 4 cards consecutive, no duplicates | `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS]` |
| `PEGGING_RUN_OF_5` | 5 | Last 5 cards form run | Last 5 cards consecutive, no duplicates | `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS]` |
| `PEGGING_RUN_OF_6` | 6 | Last 6 cards form run | Last 6 cards consecutive, no duplicates | `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS, SIX_CLUBS]` |
| `PEGGING_RUN_OF_7` | 7 | Last 7 cards form run | Last 7 cards consecutive, no duplicates | `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS, SIX_CLUBS, SEVEN_SPADES]` |

## Special Scoring Types

| Type | Points | Description | Detection | Example Cards |
|------|--------|-------------|-----------|---------------|
| `LAST_CARD` | 1 | Player played last card | Last card in pegging round | `[7_SPADES]` |
| `HEELS` | 2 | Dealer's turn card is Jack | Turn card is a Jack | `[JACK_SPADES]` |

## Detection Priority Order

**Critical**: Detection must occur in this order to prevent duplication:

1. **Complex Runs** (double/triple/quadruple) - highest priority
2. **Simple Runs** (only if cards not in complex run)
3. **Pairs/Three of a Kind/Four of a Kind** (only if cards not in runs)
4. **Fifteens** (all combinations, independent)
5. **Flush** (independent)
6. **Right Jack** (independent)

## Key Rules

1. **Complex runs consume cards**: If `[2, 3, 4, 4]` is detected as "DOUBLE_RUN_OF_3" (8 points), it does NOT also show as "RUN_OF_3" + "RUN_OF_3" + "PAIR"

2. **Multiple fifteens are separate**: Each combination summing to 15 is a separate breakdown item

3. **Pegging can have multiple items**: A single play can score fifteen + pair + run simultaneously

4. **No duplication**: Cards used in one breakdown item cannot be used in another (except fifteens, which are independent)

5. **"Go" action**: `ActionType.GO` is not a scoring event - it's just an action. No breakdown item is needed. The `LAST_CARD` breakdown item is used when a player scores 1 point for playing the last card.

6. **Pegging fifteen/thirty-one**: These breakdown items include ALL cards in the pegging stack, not just the ones that sum to 15/31

## Total Count

- **Hand/Crib Types**: 14 types
- **Pegging Types**: 10 types  
- **Special Types**: 2 types
- **Total**: 26 scoring breakdown types

