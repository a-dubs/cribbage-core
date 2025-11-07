# Agent Performance Tracking - Work In Progress

## Problem Statement

During integration testing with the `bots-test` script, we observed that `PLAY_CARD` decisions were taking 0-3870ms for computation (after subtracting the 500ms delay from `Fixed500msSimpleAgent`). However, unit tests show that `HeuristicSimpleAgent.makeMove` should be very fast (0-1ms) even with 47 remaining cards.

**Question**: Why don't the slow computations show up in our performance unit tests?

## Root Cause Analysis

The issue is that we're measuring different things:

1. **Unit Tests**: Measure `makeMove()` execution time directly (agent computation only)
2. **Integration Tests**: Measure time between `WAITING_FOR_PLAY_CARD` event and `PLAY_CARD` event (includes game loop overhead, event processing, etc.)

The 3870ms computation time in integration tests likely includes:
- Agent computation time (should be fast: 0-1ms)
- Game loop overhead
- Event processing and state updates
- Other async operations

## Current State

### What Was Implemented

1. **Agent-Level Timing Tracking** (partially complete):
   - Added `lastComputationTimeMs` property to `HeuristicSimpleAgent` and `DelayedSimpleAgent`
   - Agents track computation time (excluding delays)
   - Enhanced `bots-test` script to compare agent-reported vs event-based timing

2. **Limitation Discovered**:
   - `lastComputationTimeMs` only stores the last computation time
   - We read it after the game ends, so we can't see per-decision timing
   - This makes it impossible to match agent-reported timing with specific decisions

### What Was Started (Stashed)

Started implementing array-based computation time tracking:

1. **Created `ComputationTimeEntry` interface**:
   ```typescript
   export interface ComputationTimeEntry {
     decisionType: 'makeMove' | 'discard' | 'waitForContinue';
     computationTimeMs: number;
     timestamp: Date;
   }
   ```

2. **Changed `lastComputationTimeMs` to `computationTimes` array**:
   - Stores all computation times, not just the last one
   - Each entry includes decision type, computation time, and timestamp

3. **Updated `HeuristicSimpleAgent`**:
   - `makeMove()`: Pushes computation time to array
   - `discard()`: Added override to track computation time
   - `waitForContinue()`: Added override to track computation time

4. **Updated `DelayedSimpleAgent`**:
   - Imported `ComputationTimeEntry` type
   - Need to update `makeMove()` to track computation time before delay

## What Needs to Be Completed

### 1. Finish Array-Based Tracking Implementation

**File: `cribbage-core/src/agents/DelayedSimpleAgent.ts`**
- Update `makeMove()` to track computation time in the array (before delay)
- Ensure computation time is tracked correctly (delay is separate)

**File: `cribbage-core/src/agents/HeuristicSimpleAgent.ts`**
- Verify `discard()` and `waitForContinue()` are correctly tracking computation times
- Ensure the array is initialized properly (should be empty array by default)

### 2. Update Bots-Test Script to Use Array

**File: `cribbage-core/scripts/run-bots.ts`**

Current approach (broken):
```typescript
const agentComputationMs = (agent as any).lastComputationTimeMs;
```

New approach needed:
- Match computation times from array with decisions by:
  - Decision type (`makeMove` → `WAITING_FOR_PLAY_CARD`, etc.)
  - Timestamp proximity (find closest computation time to decision timestamp)
  - Or sequential matching (if decisions happen in order)

**Matching Strategy**:
1. For each `WAITING_FOR_*` event, find the corresponding action event
2. Look up agent's `computationTimes` array
3. Find matching entry by:
   - Decision type mapping:
     - `WAITING_FOR_PLAY_CARD` → `makeMove`
     - `WAITING_FOR_DISCARD` → `discard`
     - `WAITING_FOR_CONTINUE` → `waitForContinue`
     - `WAITING_FOR_DEAL` → (no agent method, skip)
   - Timestamp proximity (within reasonable window, e.g., 5 seconds)
4. Use matched computation time for comparison

### 3. Enhance Output

Update the breakdown output to show:
- Event-based timing (current)
- Agent-reported computation timing (from array)
- Overhead calculation (event-based - agent-reported)
- Success rate of matching (how many decisions had matching computation times)

### 4. Testing

After implementation:
1. Run `pnpm run bots-test 5 random-delay fixed-500ms`
2. Verify computation times are being captured correctly
3. Verify matching is working (all decisions should have matching computation times)
4. Compare agent-reported vs event-based timing to identify overhead

## Expected Outcome

Once complete, we should be able to see:
- **Agent-reported computation time**: Actual time spent in agent logic (should be 0-1ms for `HeuristicSimpleAgent`)
- **Event-based timing**: Total time from request to response (includes overhead)
- **Overhead**: Difference between the two (game loop, event processing, etc.)

This will help us understand:
- If the 3870ms is actually agent computation (unlikely) or overhead (likely)
- Where the overhead is coming from (game loop, event processing, etc.)
- Whether unit tests are accurately representing real-world performance

## Files Modified (Stashed)

- `cribbage-core/src/agents/HeuristicSimpleAgent.ts`
- `cribbage-core/src/agents/DelayedSimpleAgent.ts`
- `cribbage-core/scripts/run-bots.ts` (partially - needs array matching logic)

## Related Files

- `cribbage-core/test/SimpleAgent.makeMove.performance.test.ts` - Unit tests that show fast performance
- `cribbage-core/src/gameplay/GameLoop.ts` - Game loop that calls agents
- `cribbage-core/src/core/CribbageGame.ts` - Game state management

## Next Steps

1. Unstash changes: `git stash pop`
2. Complete `DelayedSimpleAgent.makeMove()` tracking
3. Implement array matching logic in `run-bots.ts`
4. Test and verify matching accuracy
5. Analyze results to identify overhead sources

