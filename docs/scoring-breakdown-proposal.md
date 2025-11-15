# Scoring Breakdown System - Proposal & Specification

## Overview

This document proposes a comprehensive scoring breakdown system that provides detailed, itemized scoring information for all scoring events in Cribbage. The system will enhance user experience by showing exactly how points were earned, with each scoring item tied to the specific cards that contributed to it.

## Goals

1. **Granularity**: Show specific scoring reasons (e.g., "fifteen", "pair", "double run of 3") instead of generic reasons (e.g., "hand", "points")
2. **Card Attribution**: Each scoring item shows which cards contributed to it
3. **No Duplication**: Complex scores (like double runs) are shown as single items, not broken into component parts
4. **Comprehensive Coverage**: Support all scoring types for both hand/crib scoring and pegging
5. **Future-Proof**: Enable end-of-round summary displays with detailed breakdowns

## Architecture

### Core Changes

**1. New Type: `ScoreBreakdownItem`**

```typescript
export interface ScoreBreakdownItem {
  type: ScoreBreakdownType;  // Type of scoring (e.g., 'FIFTEEN', 'PAIR', 'DOUBLE_RUN_OF_3')
  points: number;            // Points awarded for this specific item
  cards: Card[];             // Cards that contributed to this score
  description: string;     // Human-readable description (e.g., "Double run of 3")
}
```

**2. Enhanced `GameEvent`**

```typescript
export interface GameEvent {
  // ... existing fields ...
  scoreChange: number;                    // Total points (unchanged, for backwards compatibility)
  scoreBreakdown: ScoreBreakdownItem[];   // NEW: Detailed breakdown (empty array if no scoring)
}
```

**3. New Type: `ScoreBreakdownType`**

```typescript
export type ScoreBreakdownType =
  // Hand/Crib Scoring
  | 'FIFTEEN'                    // Combination summing to 15
  | 'PAIR'                       // Two cards of same rank
  | 'THREE_OF_A_KIND'            // Three cards of same rank
  | 'FOUR_OF_A_KIND'             // Four cards of same rank
  | 'RUN_OF_3'                   // Three consecutive cards
  | 'RUN_OF_4'                   // Four consecutive cards
  | 'RUN_OF_5'                   // Five consecutive cards
  | 'DOUBLE_RUN_OF_3'            // Run of 3 with one duplicate (e.g., 2,3,4,4)
  | 'DOUBLE_RUN_OF_4'             // Run of 4 with one duplicate
  | 'TRIPLE_RUN_OF_3'            // Run of 3 with two duplicates (e.g., 2,3,4,4,4)
  | 'QUADRUPLE_RUN_OF_3'         // Run of 3 with three duplicates (e.g., 2,3,3,4,4)
  | 'FLUSH_4'                    // Four cards of same suit (hand only, not crib)
  | 'FLUSH_5'                    // Five cards of same suit (including cut card)
  | 'RIGHT_JACK'                 // Jack in hand matching cut card suit
  // Pegging Scoring
  | 'PEGGING_FIFTEEN'            // Pegging stack sums to 15 (all cards in stack)
  | 'PEGGING_THIRTY_ONE'         // Pegging stack sums to 31 (all cards in stack)
  | 'PEGGING_PAIR'               // Last 2 cards same rank
  | 'PEGGING_THREE_OF_A_KIND'    // Last 3 cards same rank
  | 'PEGGING_FOUR_OF_A_KIND'     // Last 4 cards same rank
  | 'PEGGING_RUN_OF_3'           // Last 3 cards form run
  | 'PEGGING_RUN_OF_4'           // Last 4 cards form run
  | 'PEGGING_RUN_OF_5'           // Last 5 cards form run
  | 'PEGGING_RUN_OF_6'           // Last 6 cards form run
  | 'PEGGING_RUN_OF_7'           // Last 7 cards form run (maximum possible)
  // Special Scoring
  | 'LAST_CARD'                  // Player played last card in pegging round
  | 'HEELS';                     // Dealer got jack as turn card
```

### Scoring Function Changes

**Current State:**
- `scoreHand()` returns only total points
- `scorePegging()` returns only total points
- Individual scoring functions (`countFifteens()`, `pairs()`, `score_runs()`, etc.) return totals

**Proposed State:**
- `scoreHandWithBreakdown()` returns `{ total: number, breakdown: ScoreBreakdownItem[] }`
- `scorePeggingWithBreakdown()` returns `{ total: number, breakdown: ScoreBreakdownItem[] }`
- Keep existing functions for backwards compatibility (they can call new functions internally)

### Detection Logic

**Key Principle: Complex scores take precedence over simple scores**

1. **Detect complex runs first** (double/triple/quadruple runs)
   - These consume cards that would otherwise be counted as simple runs and pairs
   - Example: `[2, 3, 4, 4]` = one "double run of 3" (8 points), NOT "run of 3" + "run of 3" + "pair"

2. **Then detect simple runs** (only if not part of complex run)

3. **Then detect pairs/trips/four of a kind** (only if not part of complex run)

4. **Then detect fifteens** (all combinations that sum to 15)

5. **Then detect flush and right jack** (independent of other scores)

## Implementation Plan

### Phase 1: Core Library (cribbage-core)

#### Step 1.1: Type Definitions
- [ ] Add `ScoreBreakdownItem` interface
- [ ] Add `ScoreBreakdownType` type
- [ ] Update `GameEvent` interface to include `scoreBreakdown: ScoreBreakdownItem[]`
- [ ] Create helper function to generate human-readable descriptions from `ScoreBreakdownType`

#### Step 1.2: Scoring Breakdown Functions (TDD)
- [ ] Write exhaustive unit tests for all scoring breakdown types
- [ ] Implement `scoreHandWithBreakdown()` function
  - [ ] Detect complex runs (double/triple/quadruple) first
  - [ ] Detect simple runs (excluding cards in complex runs)
  - [ ] Detect pairs/trips/four of a kind (excluding cards in runs)
  - [ ] Detect all fifteen combinations
  - [ ] Detect flush (4 or 5 cards)
  - [ ] Detect right jack
- [ ] Implement `scorePeggingWithBreakdown()` function
  - [ ] Detect fifteen (if sum = 15)
  - [ ] Detect thirty-one (if sum = 31)
  - [ ] Detect same rank sequences (pair/trips/four of a kind)
  - [ ] Detect runs (3-8 cards)
- [ ] Ensure backwards compatibility: existing `scoreHand()` and `scorePegging()` functions still work

#### Step 1.3: Integration with CribbageGame
- [ ] Update `scoreHand()` method to call `scoreHandWithBreakdown()` and populate `GameEvent.scoreBreakdown`
- [ ] Update `scoreCrib()` method to call `scoreHandWithBreakdown()` (with `isCrib: true`) and populate `GameEvent.scoreBreakdown`
- [ ] Update `playCard()` method to call `scorePeggingWithBreakdown()` and populate `GameEvent.scoreBreakdown`
- [ ] Update `recordGameEvent()` to accept optional `scoreBreakdown` parameter
- [ ] Ensure `LAST_CARD` and `SCORE_HEELS` events include appropriate breakdown items

#### Step 1.4: Testing
- [ ] Unit tests for all scoring breakdown types (hand/crib)
- [ ] Unit tests for all scoring breakdown types (pegging)
- [ ] Integration tests with `CribbageGame` to verify `GameEvent.scoreBreakdown` is populated correctly
- [ ] Test edge cases (multiple fifteens, complex runs, etc.)
- [ ] Test backwards compatibility (existing code still works)

### Phase 2: App Integration (cribbage-with-friends-app)

#### Step 2.1: Type Updates
- [ ] Update imports to use new `ScoreBreakdownItem` and `ScoreBreakdownType` from `cribbage-core`
- [ ] Ensure `GameEvent` type includes `scoreBreakdown` field

#### Step 2.2: UI State Derivation
- [ ] Update `getScoreReason()` in `utils/uiState.ts` to use breakdown
  - [ ] If breakdown has items, show first item's description (or combine if multiple)
  - [ ] Fallback to generic reasons if breakdown is empty (backwards compatibility)
- [ ] Update `scorePopups` in `UiState` to include breakdown information
  - [ ] Add `breakdown: ScoreBreakdownItem[]` to score popup structure
  - [ ] Update `derivePopups()` to pass breakdown from `GameEvent`

#### Step 2.3: UI Components
- [ ] Update `PointsScoredMessage` component to display breakdown
  - [ ] Show breakdown list when available
  - [ ] Each item shows: description, points, cards
- [ ] Create breakdown display component (for future end-of-round summary)
  - [ ] Reusable component that takes `ScoreBreakdownItem[]` and displays nicely

#### Step 2.4: Testing
- [ ] Test UI state derivation with breakdown data
- [ ] Test popup display with various breakdown scenarios
- [ ] Test backwards compatibility (old events without breakdown still work)

## Scoring Breakdown Type Enumeration

See the detailed enumeration document for complete list of all scoring types, their detection logic, point values, and examples.

## Backwards Compatibility

- Existing `scoreHand()` and `scorePegging()` functions remain unchanged (they can internally call new functions)
- `GameEvent.scoreBreakdown` is optional (defaults to empty array)
- App-side code handles missing breakdown gracefully (falls back to generic reasons)
- Old `GameEvent` records without breakdown still work

## Future Enhancements

1. **End-of-Round Summary**: Use breakdown data from all scoring events in a round to show:
   - Simple table: players × (turn card, pegging, hand, crib)
   - Detailed breakdown: All scoring items grouped by type and player

2. **Statistics**: Track which scoring types are most common, average points per type, etc.

3. **Tutorials**: Use breakdown data to explain scoring rules with real examples

## Notes

1. **Cut card in hand scoring**: Yes - the cut card is included in hand scoring breakdown items
2. **Multiple fifteens**: Each combination summing to 15 is a separate breakdown item
3. **Pegging runs**: Maximum is 7 cards (ACE through 7 = 28, which is under 31)
4. **"Go" action**: `ActionType.GO` is not a scoring event - it's just an action indicating a player cannot play. No breakdown item is needed for "Go". The `LAST_CARD` breakdown item is used when a player scores 1 point for playing the last card.
5. **Pegging fifteen/thirty-one**: These breakdown items include ALL cards in the pegging stack, not just the ones that sum to 15/31

