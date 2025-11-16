# Scoring Breakdown Type Enumeration

This document provides a complete enumeration of all scoring breakdown types, including their detection logic, point values, and examples.

## Detection Order (Critical)

**IMPORTANT**: Detection must occur in this order to prevent duplication:

1. **Complex Runs** (double/triple/quadruple) - highest priority
2. **Simple Runs** (only if cards not in complex run)
3. **Pairs/Trips/Four of a Kind** (only if cards not in runs)
4. **Fifteens** (all combinations)
5. **Flush** (independent)
6. **Right Jack** (independent)

## Hand/Crib Scoring Types

### FIFTEEN
- **Type**: `'FIFTEEN'`
- **Points**: 2
- **Detection**: Any combination of 2-5 cards (from hand + cut card) that sums to exactly 15 using peg values
- **Cards**: The specific cards in the combination
- **Description**: "Fifteen"
- **Example**: Hand: `[5_SPADES, KING_HEARTS]`, Cut: `[TEN_CLUBS]` → One fifteen: `[5_SPADES, KING_HEARTS]` (5+10=15)
- **Note**: Multiple fifteens are separate breakdown items (e.g., `[5, 5, 5]` with cut `[KING]` = 3 fifteens)

### PAIR
- **Type**: `'PAIR'`
- **Points**: 2
- **Detection**: Two cards with the same rank (run value), NOT part of any run
- **Cards**: The two cards forming the pair
- **Description**: "Pair"
- **Example**: Hand: `[5_SPADES, 5_HEARTS, 7_CLUBS, 8_DIAMONDS]`, Cut: `[9_SPADES]` → One pair: `[5_SPADES, 5_HEARTS]`
- **Note**: If cards are part of a double/triple/quadruple run, they are NOT counted as a separate pair

### THREE_OF_A_KIND
- **Type**: `'THREE_OF_A_KIND'`
- **Points**: 6
- **Detection**: Three cards with the same rank (run value), NOT part of any run
- **Cards**: The three cards forming the three of a kind
- **Description**: "Three of a kind"
- **Example**: Hand: `[5_SPADES, 5_HEARTS, 5_CLUBS, 7_DIAMONDS]`, Cut: `[8_SPADES]` → One three of a kind: `[5_SPADES, 5_HEARTS, 5_CLUBS]`
- **Note**: If cards are part of a triple/quadruple run, they are NOT counted as separate three of a kind

### FOUR_OF_A_KIND
- **Type**: `'FOUR_OF_A_KIND'`
- **Points**: 12
- **Detection**: Four cards with the same rank (run value), NOT part of any run
- **Cards**: The four cards forming the four of a kind
- **Description**: "Four of a kind"
- **Example**: Hand: `[5_SPADES, 5_HEARTS, 5_CLUBS, 5_DIAMONDS]`, Cut: `[7_SPADES]` → One four of a kind: `[5_SPADES, 5_HEARTS, 5_CLUBS, 5_DIAMONDS]`
- **Note**: If cards are part of a quadruple run, they are NOT counted as separate four of a kind

### RUN_OF_3
- **Type**: `'RUN_OF_3'`
- **Points**: 3
- **Detection**: Three consecutive cards (by run value), sorted), NOT part of any complex run
- **Cards**: The three cards forming the run
- **Description**: "Run of 3"
- **Example**: Hand: `[5_SPADES, 6_HEARTS, 7_CLUBS, 9_DIAMONDS]`, Cut: `[10_SPADES]` → One run: `[5_SPADES, 6_HEARTS, 7_CLUBS]`
- **Note**: Cards must be consecutive (e.g., 5,6,7) and not part of a double/triple/quadruple run

### RUN_OF_4
- **Type**: `'RUN_OF_4'`
- **Points**: 4
- **Detection**: Four consecutive cards (by run value), NOT part of any complex run
- **Cards**: The four cards forming the run
- **Description**: "Run of 4"
- **Example**: Hand: `[5_SPADES, 6_HEARTS, 7_CLUBS, 8_DIAMONDS]`, Cut: `[9_SPADES]` → One run: `[5_SPADES, 6_HEARTS, 7_CLUBS, 8_DIAMONDS, 9_SPADES]` (includes cut card)

### RUN_OF_5
- **Type**: `'RUN_OF_5'`
- **Points**: 5
- **Detection**: Five consecutive cards (by run value), NOT part of any complex run
- **Cards**: All five cards (hand + cut card) forming the run
- **Description**: "Run of 5"
- **Example**: Hand: `[5_SPADES, 6_HEARTS, 7_CLUBS, 8_DIAMONDS]`, Cut: `[9_SPADES]` → One run: `[5_SPADES, 6_HEARTS, 7_CLUBS, 8_DIAMONDS, 9_SPADES]`

### DOUBLE_RUN_OF_3
- **Type**: `'DOUBLE_RUN_OF_3'`
- **Points**: 8
- **Detection**: Run of 3 with exactly one duplicate card (e.g., `[2, 3, 4, 4]` or `[2, 2, 3, 4]`)
- **Cards**: All four cards (the run + duplicate)
- **Description**: "Double run of 3"
- **Example**: Hand: `[2_SPADES, 3_HEARTS, 4_CLUBS, 4_DIAMONDS]`, Cut: `[7_SPADES]` → One double run: `[2_SPADES, 3_HEARTS, 4_CLUBS, 4_DIAMONDS]`
- **Note**: This is worth 8 points (3×2 + 2 for pair = 8), but shown as ONE item, not separate run + pair

### DOUBLE_RUN_OF_4
- **Type**: `'DOUBLE_RUN_OF_4'`
- **Points**: 10
- **Detection**: Run of 4 with exactly one duplicate card (e.g., `[2, 3, 4, 5, 5]` or `[2, 2, 3, 4, 5]`)
- **Cards**: All five cards (the run + duplicate)
- **Description**: "Double run of 4"
- **Example**: Hand: `[2_SPADES, 3_HEARTS, 4_CLUBS, 5_DIAMONDS]`, Cut: `[5_SPADES]` → One double run: `[2_SPADES, 3_HEARTS, 4_CLUBS, 5_DIAMONDS, 5_SPADES]`
- **Note**: This is worth 10 points (4×2 + 2 for pair = 10), but shown as ONE item

### TRIPLE_RUN_OF_3
- **Type**: `'TRIPLE_RUN_OF_3'`
- **Points**: 15
- **Detection**: Run of 3 with exactly two duplicate cards (e.g., `[2, 3, 4, 4, 4]` or `[2, 2, 2, 3, 4]` or `[2, 2, 3, 3, 4]`)
- **Cards**: All five cards (the run + duplicates)
- **Description**: "Triple run of 3"
- **Example**: Hand: `[2_SPADES, 3_HEARTS, 4_CLUBS, 4_DIAMONDS]`, Cut: `[4_HEARTS]` → One triple run: `[2_SPADES, 3_HEARTS, 4_CLUBS, 4_DIAMONDS, 4_HEARTS]`
- **Note**: This is worth 15 points (3×3 + 6 for trips = 15), but shown as ONE item

### QUADRUPLE_RUN_OF_3
- **Type**: `'QUADRUPLE_RUN_OF_3'`
- **Points**: 16
- **Detection**: Run of 3 with exactly three duplicate cards (e.g., `[2, 3, 3, 4, 4]` - two duplicates of one rank, one duplicate of another)
- **Cards**: All five cards (the run + duplicates)
- **Description**: "Quadruple run of 3"
- **Example**: Hand: `[2_SPADES, 3_HEARTS, 3_CLUBS, 4_DIAMONDS]`, Cut: `[4_HEARTS]` → One quadruple run: `[2_SPADES, 3_HEARTS, 3_CLUBS, 4_DIAMONDS, 4_HEARTS]`
- **Note**: This is worth 16 points (3×4 + 4 for two pairs = 16), but shown as ONE item

### FLUSH_4
- **Type**: `'FLUSH_4'`
- **Points**: 4
- **Detection**: All four hand cards are the same suit, AND cut card is different suit, AND it's NOT a crib
- **Cards**: The four hand cards (cut card NOT included)
- **Description**: "Flush (4 cards)"
- **Example**: Hand: `[5_HEARTS, 7_HEARTS, 9_HEARTS, JACK_HEARTS]`, Cut: `[3_SPADES]`, isCrib: `false` → One flush: `[5_HEARTS, 7_HEARTS, 9_HEARTS, JACK_HEARTS]`
- **Note**: Cribs require 5 cards (including cut) for flush to count

### FLUSH_5
- **Type**: `'FLUSH_5'`
- **Points**: 5
- **Detection**: All four hand cards + cut card are the same suit
- **Cards**: All five cards (hand + cut card)
- **Description**: "Flush (5 cards)"
- **Example**: Hand: `[5_HEARTS, 7_HEARTS, 9_HEARTS, JACK_HEARTS]`, Cut: `[3_HEARTS]` → One flush: `[5_HEARTS, 7_HEARTS, 9_HEARTS, JACK_HEARTS, 3_HEARTS]`
- **Note**: Works for both hand and crib

### RIGHT_JACK
- **Type**: `'RIGHT_JACK'`
- **Points**: 1
- **Detection**: Hand contains a Jack with the same suit as the cut card
- **Cards**: The Jack card (and optionally the cut card for context, but typically just the Jack)
- **Description**: "Right Jack"
- **Example**: Hand: `[5_SPADES, 7_HEARTS, 9_CLUBS, JACK_SPADES]`, Cut: `[3_SPADES]` → One right jack: `[JACK_SPADES]`
- **Note**: Also called "Nobs" or "One for his nob"

## Pegging Scoring Types

### PEGGING_FIFTEEN
- **Type**: `'PEGGING_FIFTEEN'`
- **Points**: 2
- **Detection**: Sum of all cards in pegging stack equals exactly 15
- **Cards**: **ALL cards in the pegging stack** (not just the ones that sum to 15)
- **Description**: "Fifteen"
- **Example**: Stack: `[5_SPADES, 10_HEARTS]` → One fifteen: `[5_SPADES, 10_HEARTS]` (all cards in stack)

### PEGGING_THIRTY_ONE
- **Type**: `'PEGGING_THIRTY_ONE'`
- **Points**: 2
- **Detection**: Sum of all cards in pegging stack equals exactly 31
- **Cards**: **ALL cards in the pegging stack** (not just the ones that sum to 31)
- **Description**: "Thirty-one"
- **Example**: Stack: `[5_SPADES, 10_HEARTS, 10_CLUBS, 6_DIAMONDS]` → One thirty-one: `[5_SPADES, 10_HEARTS, 10_CLUBS, 6_DIAMONDS]` (all cards in stack)

### PEGGING_PAIR
- **Type**: `'PEGGING_PAIR'`
- **Points**: 2
- **Detection**: Last 2 cards in pegging stack have the same rank (run value)
- **Cards**: The last 2 cards
- **Description**: "Pair"
- **Example**: Stack: `[5_SPADES, 7_HEARTS, 7_CLUBS]` → One pair: `[7_HEARTS, 7_CLUBS]`

### PEGGING_THREE_OF_A_KIND
- **Type**: `'PEGGING_THREE_OF_A_KIND'`
- **Points**: 6
- **Detection**: Last 3 cards in pegging stack have the same rank (run value)
- **Cards**: The last 3 cards
- **Description**: "Three of a kind"
- **Example**: Stack: `[5_SPADES, 7_HEARTS, 7_CLUBS, 7_DIAMONDS]` → One three of a kind: `[7_HEARTS, 7_CLUBS, 7_DIAMONDS]`

### PEGGING_FOUR_OF_A_KIND
- **Type**: `'PEGGING_FOUR_OF_A_KIND'`
- **Points**: 12
- **Detection**: Last 4 cards in pegging stack have the same rank (run value)
- **Cards**: The last 4 cards
- **Description**: "Four of a kind"
- **Example**: Stack: `[5_SPADES, 7_HEARTS, 7_CLUBS, 7_DIAMONDS, 7_SPADES]` → One four of a kind: `[7_HEARTS, 7_CLUBS, 7_DIAMONDS, 7_SPADES]`

### PEGGING_RUN_OF_3
- **Type**: `'PEGGING_RUN_OF_3'`
- **Points**: 3
- **Detection**: Last 3 cards in pegging stack form a consecutive run (by run value), no duplicates
- **Cards**: The last 3 cards
- **Description**: "Run of 3"
- **Example**: Stack: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS]` → One run: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS]` (sum = 6)
- **Note**: Cards don't need to be in order in the stack, but must form consecutive sequence when sorted

### PEGGING_RUN_OF_4
- **Type**: `'PEGGING_RUN_OF_4'`
- **Points**: 4
- **Detection**: Last 4 cards in pegging stack form a consecutive run (by run value), no duplicates
- **Cards**: The last 4 cards
- **Description**: "Run of 4"
- **Example**: Stack: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS]` → One run: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS]` (sum = 10)

### PEGGING_RUN_OF_5
- **Type**: `'PEGGING_RUN_OF_5'`
- **Points**: 5
- **Detection**: Last 5 cards in pegging stack form a consecutive run (by run value), no duplicates
- **Cards**: The last 5 cards
- **Description**: "Run of 5"
- **Example**: Stack: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS]` → One run: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS]` (sum = 15)
- **Note**: This would also score PEGGING_FIFTEEN (separate breakdown item)

### PEGGING_RUN_OF_6
- **Type**: `'PEGGING_RUN_OF_6'`
- **Points**: 6
- **Detection**: Last 6 cards in pegging stack form a consecutive run (by run value), no duplicates
- **Cards**: The last 6 cards
- **Description**: "Run of 6"
- **Example**: Stack: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS, SIX_CLUBS]` → One run: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS, SIX_CLUBS]` (sum = 21)

### PEGGING_RUN_OF_7
- **Type**: `'PEGGING_RUN_OF_7'`
- **Points**: 7
- **Detection**: Last 7 cards in pegging stack form a consecutive run (by run value), no duplicates
- **Cards**: The last 7 cards
- **Description**: "Run of 7"
- **Example**: Stack: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS, SIX_CLUBS, SEVEN_SPADES]` → One run: `[ACE_SPADES, TWO_HEARTS, THREE_CLUBS, FOUR_DIAMONDS, FIVE_HEARTS, SIX_CLUBS, SEVEN_SPADES]` (sum = 28)
- **Note**: Maximum possible pegging run (1+2+3+4+5+6+7 = 28, which is under 31)

## Special Scoring Types

### LAST_CARD
- **Type**: `'LAST_CARD'`
- **Points**: 1
- **Detection**: Player played the last card in a pegging round (all other players have no cards left or have said "Go")
- **Cards**: The last card played (or the entire pegging stack if contextually relevant)
- **Description**: "Last card"
- **Example**: Player plays final card when all others have said "Go" → One last card: `[7_SPADES]`
- **Note**: "Go" (ActionType.GO) is not a scoring event - it's just an action indicating a player cannot play. The LAST_CARD breakdown item is used when a player scores 1 point for playing the last card. The cards field may include the entire pegging stack for context, or just the last card played.

### HEELS
- **Type**: `'HEELS'`
- **Points**: 2
- **Detection**: Dealer's turn card is a Jack
- **Cards**: The turn card (Jack)
- **Description**: "Heels"
- **Example**: Turn card: `[JACK_SPADES]` → One heels: `[JACK_SPADES]`
- **Note**: Also called "Two for his heels"

## Detection Algorithm Pseudocode

### Hand/Crib Scoring Breakdown

```
function scoreHandWithBreakdown(hand, cutCard, isCrib):
  breakdown = []
  allCards = sortCards(hand + cutCard)
  usedCards = Set()
  
  // 1. Detect complex runs (highest priority)
  if (hasDoubleRunOf4(allCards)):
    item = createDoubleRunOf4(allCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  else if (hasTripleRunOf3(allCards)):
    item = createTripleRunOf3(allCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  else if (hasDoubleRunOf3(allCards)):
    item = createDoubleRunOf3(allCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  
  // 2. Detect simple runs (only unused cards)
  availableCards = allCards.filter(card => !usedCards.contains(card))
  if (hasRunOf5(availableCards)):
    item = createRunOf5(availableCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  else if (hasRunOf4(availableCards)):
    item = createRunOf4(availableCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  else if (hasRunOf3(availableCards)):
    item = createRunOf3(availableCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  
  // 3. Detect pairs/three of a kind/four of a kind (only unused cards)
  availableCards = allCards.filter(card => !usedCards.contains(card))
  if (hasFourOfAKind(availableCards)):
    item = createFourOfAKind(availableCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  else if (hasThreeOfAKind(availableCards)):
    item = createThreeOfAKind(availableCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  else if (hasPair(availableCards)):
    item = createPair(availableCards)
    breakdown.append(item)
    usedCards.addAll(item.cards)
  
  // 4. Detect all fifteens (all combinations)
  fifteens = findAllFifteens(allCards)
  for each fifteen in fifteens:
    breakdown.append(createFifteen(fifteen))
  
  // 5. Detect flush (independent)
  if (hasFlush5(hand, cutCard)):
    breakdown.append(createFlush5(hand, cutCard))
  else if (hasFlush4(hand, cutCard, isCrib)):
    breakdown.append(createFlush4(hand))
  
  // 6. Detect right jack (independent)
  if (hasRightJack(hand, cutCard)):
    breakdown.append(createRightJack(hand, cutCard))
  
  total = sum(breakdown.map(item => item.points))
  return { total, breakdown }
```

### Pegging Scoring Breakdown

```
function scorePeggingWithBreakdown(peggingStack):
  breakdown = []
  
  // 1. Check for fifteen
  if (sum(peggingStack) === 15):
    breakdown.append(createPeggingFifteen(peggingStack))
  
  // 2. Check for thirty-one
  if (sum(peggingStack) === 31):
    breakdown.append(createPeggingThirtyOne(peggingStack))
  
  // 3. Check for same rank sequences (from end of stack)
  lastCards = peggingStack.slice(-4) // Check up to 4 cards
  if (last4SameRank(lastCards)):
    breakdown.append(createPeggingFourOfAKind(lastCards))
  else if (last3SameRank(lastCards)):
    breakdown.append(createPeggingThreeOfAKind(lastCards.slice(-3)))
  else if (last2SameRank(lastCards)):
    breakdown.append(createPeggingPair(lastCards.slice(-2)))
  
  // 4. Check for runs (from end of stack, no duplicates)
  for length from 7 down to 3:  // Maximum is 7 (ACE through 7 = 28)
    lastCards = peggingStack.slice(-length)
    if (isConsecutiveRun(lastCards) && !hasDuplicates(lastCards)):
      breakdown.append(createPeggingRun(length, lastCards))
      break // Only count longest run
  
  total = sum(breakdown.map(item => item.points))
  return { total, breakdown }
```

## Edge Cases

1. **Multiple Fifteens**: Each combination is a separate breakdown item
   - Example: `[5, 5, 5]` with cut `[KING]` = 3 separate "FIFTEEN" items (each worth 2 points)

2. **Complex Run with Fifteens**: Complex runs don't prevent fifteens
   - Example: `[2, 3, 4, 4]` = one "DOUBLE_RUN_OF_3" (8 points) + any fifteens that exist

3. **Pegging Multiple Scores**: Can have multiple breakdown items (e.g., fifteen + pair + run)
   - Example: Stack `[5, 5, 5]` = "PEGGING_FIFTEEN" (2) + "PEGGING_TRIPS" (6) = 8 total

4. **No Scoring**: Empty breakdown array, `scoreChange: 0`

