# Comprehensive Game State Architecture Overhaul

This document consolidates multiple related architectural improvements to make the cribbage-core library more robust, maintainable, and suitable for production use. These changes work together to create a deterministic, event-driven game state system.

## Table of Contents

1. [Integrating Decision Requests into GameState/GameEvent](#1-integrating-decision-requests-into-gamestategameevent)
2. [Making Decision Requests Parallel/Async](#2-making-decision-requests-parallelasync)
3. [Immutable GameState with Automatic Event Logging](#3-immutable-gamestate-with-automatic-event-logging)
4. [Redacted Game State Views for Agents](#4-redacted-game-state-views-for-agents)
5. [Centralized UI State Derivation](#5-centralized-ui-state-derivation)
6. [Implementation Roadmap](#6-implementation-roadmap)
7. [Testing Strategy](#7-testing-strategy)

---

## 1. Integrating Decision Requests into GameState/GameEvent

### Problem Statement

**Original Question**: *"I currently have a separate notion of like decision requests and stuff but I want to bake that into the GameState/GameEvent system so that waiting for player decisions is part of the canonical game state rather than being tracked separately."*

**Current Issues**:
- Decision requests are sent via separate WebSocket events (`waitingForPlayer`, `requestMakeMove`, `discardRequest`, `continueRequest`) rather than being part of `GameSnapshot`
- Server stores `mostRecentWaitingForPlayer` separately from `mostRecentGameSnapshot`
- Client stores `waitingOnPlayerInfo`, `requestedDecisionType`, and `requestedDecisionData` separately from `gameState` and `recentGameEvent`
- Decision requests aren't recorded in game event history
- Reconnecting clients can't reconstruct full waiting state from `GameSnapshot` alone
- UI can't be fully derived from `GameState` + `GameEvent` alone

### Solution: Option C (Both GameState and GameEvent)

**Core Principle**: `GameState` represents the current state (including who we're waiting on), while `GameEvent` records state transitions (including when waiting starts/stops).

#### Type System Changes

**Add to `GameState`**:
```typescript
export interface GameState {
  // ... existing fields ...
  waitingForPlayer: {
    playerId: string;
    decisionType: AgentDecisionType;
    requestTimestamp: Date;
  } | null;
}
```

**Add to `ActionType` enum**:
```typescript
export enum ActionType {
  // ... existing actions ...
  WAITING_FOR_DEAL = 'WAITING_FOR_DEAL',
  WAITING_FOR_DISCARD = 'WAITING_FOR_DISCARD',
  WAITING_FOR_PLAY_CARD = 'WAITING_FOR_PLAY_CARD',
  WAITING_FOR_CONTINUE = 'WAITING_FOR_CONTINUE',
}
```

**Optional: Add to `GameEvent`**:
```typescript
export interface GameEvent {
  // ... existing fields ...
  waitingFor?: {
    playerId: string;
    decisionType: AgentDecisionType;
  } | null;
}
```

#### Key Design Decisions

- **Don't store detailed request data in `GameState`**: Request data (`peggingHand`, `peggingStack`, etc.) can be derived from `GameState` + `decisionType`
- **Clients derive request UI**: This keeps `GameState` lean and ensures request data is always consistent with actual state
- **Clear waiting state when action is taken**: `waitingForPlayer` is set to `null` before recording action events

#### Implementation Pattern

```typescript
// In GameLoop.ts
private async requestDecision(
  playerId: string,
  decisionType: AgentDecisionType
): Promise<void> {
  this.cribbageGame.setWaitingForPlayer(playerId, decisionType);
  this.cribbageGame.recordGameEvent(
    this.getWaitingActionType(decisionType),
    playerId,
    null,
    0
  );
  // GameSnapshot automatically emitted by recordGameEvent
}

// In CribbageGame methods (deal, discardToCrib, playCard, etc.)
// Clear waiting state BEFORE recording the action event
this.gameState.waitingForPlayer = null;
this.recordGameEvent(ActionType.DEAL, playerId, cards, scoreChange);
```

#### Benefits

✅ Deterministic UI: UI can be fully derived from `GameState` + `GameEvent`  
✅ Reconnection Safe: Reconnecting clients get full state including waiting info  
✅ Debuggable: Waiting state changes are in game history  
✅ Type Safe: Waiting state is typed and validated  
✅ Backwards Compatible: Can migrate gradually  

**See**: `question-about-decision-requests-and-game-state.md` for full details

---

## 2. Making Decision Requests Parallel/Async

### Problem Statement

**Current Issue**: Players must wait for the person before them to discard before they can make their discard. This creates unnecessary sequential waiting and poor UX.

**Current Implementation** (from `GameLoop.ts`):
```typescript
// Crib phase: Agents discard to crib
for (const player of this.cribbageGame.getGameState().players) {
  const agent = this.agents[player.id];
  // emit event saying who's turn it is
  this.emit('waitingForPlayer', { playerId: player.id, waitingFor: AgentDecisionType.DISCARD });
  const discards = await agent.discard(...); // Sequential - waits for each player
  this.cribbageGame.discardToCrib(player.id, discards);
}
```

### Solution: Parallel Decision Requests

**Key Insight**: Multiple players can make decisions simultaneously when the decision doesn't depend on other players' choices. This applies to:
- **Discarding**: All players can discard simultaneously (they don't see each other's discards)
- **Continue prompts**: All players can continue simultaneously
- **NOT pegging**: Players must take turns (depends on previous plays)

#### Implementation Pattern

**For Parallel Decisions**:
```typescript
// Request decisions from all players simultaneously
const decisionPromises = this.cribbageGame.getGameState().players.map(async (player) => {
  const agent = this.agents[player.id];
  if (!agent) throw new Error(`No agent for player ${player.id}`);
  
  // Set waiting state for this player
  this.cribbageGame.setWaitingForPlayer(player.id, AgentDecisionType.DISCARD);
  this.cribbageGame.recordGameEvent(
    ActionType.WAITING_FOR_DISCARD,
    player.id,
    null,
    0
  );
  
  // Request decision (non-blocking for other players)
  return agent.discard(
    this.cribbageGame.getGameState(),
    player.id,
    numberOfCardsToDiscard
  ).then(discards => ({ playerId: player.id, discards }));
});

// Wait for all decisions
const results = await Promise.all(decisionPromises);

// Process all discards (order doesn't matter)
for (const { playerId, discards } of results) {
  this.cribbageGame.discardToCrib(playerId, discards);
}
```

**For Sequential Decisions** (like pegging):
```typescript
// Keep existing sequential pattern for pegging
let currentPlayerId = this.cribbageGame.getFollowingPlayerId(dealerId);
while (/* game continues */) {
  await this.requestDecision(currentPlayerId, AgentDecisionType.PLAY_CARD);
  const card = await agent.makeMove(...);
  this.cribbageGame.playCard(currentPlayerId, card);
  currentPlayerId = this.cribbageGame.getFollowingPlayerId(currentPlayerId);
}
```

#### Updated `GameState.waitingForPlayer` Structure

To support multiple simultaneous waits, change from single to array:

```typescript
export interface GameState {
  // ... existing fields ...
  waitingForPlayers: {
    playerId: string;
    decisionType: AgentDecisionType;
    requestTimestamp: Date;
  }[];
}
```

**Benefits**:
- Multiple players can be waiting simultaneously
- Clearer representation of game state
- Easier to implement parallel requests
- Better UX (players don't wait unnecessarily)

#### Migration from Single to Array

**Phase 1**: Support both formats (backwards compatible)
```typescript
export interface GameState {
  // Legacy: single waiting player (deprecated)
  waitingForPlayer?: { playerId: string; decisionType: AgentDecisionType; requestTimestamp: Date; } | null;
  // New: multiple waiting players
  waitingForPlayers: { playerId: string; decisionType: AgentDecisionType; requestTimestamp: Date; }[];
}
```

**Phase 2**: Update all code to use `waitingForPlayers`
**Phase 3**: Remove `waitingForPlayer` field

#### Updated Helper Methods

```typescript
// In CribbageGame.ts
public addWaitingForPlayer(
  playerId: string,
  decisionType: AgentDecisionType
): void {
  if (!this.gameState.waitingForPlayers.find(w => w.playerId === playerId)) {
    this.gameState.waitingForPlayers.push({
      playerId,
      decisionType,
      requestTimestamp: new Date(),
    });
  }
}

public removeWaitingForPlayer(playerId: string): void {
  this.gameState.waitingForPlayers = this.gameState.waitingForPlayers.filter(
    w => w.playerId !== playerId
  );
}

public clearAllWaiting(): void {
  this.gameState.waitingForPlayers = [];
}
```

---

## 3. Immutable GameState with Automatic Event Logging

### Problem Statement

**From TODO.md**: *"Go through CribbageGame class and make it so that the gameState cannot be modified directly and that it must be modified via setters, that way, anytime a setter is called a game event is logged. this ensures consistent revisioning history of game state"*

**Current Issues**:
- `GameState` can be modified directly: `this.gameState.players[0].score += 5`
- No guarantee that `recordGameEvent()` is called after state changes
- Easy to forget to log events, leading to incomplete game history
- No type safety preventing direct mutations
- Inconsistent event logging across the codebase

### Solution: Immutable GameState with Setter Methods

**Core Principle**: All `GameState` modifications must go through setter methods that automatically log events. Direct property access is read-only.

#### Architecture Pattern

**1. Make `gameState` Private and Read-Only**:
```typescript
export class CribbageGame extends EventEmitter {
  private _gameState: GameState; // Private, can't be accessed directly
  
  // Read-only getter
  public getGameState(): Readonly<GameState> {
    return this._gameState;
  }
  
  // No public setter - all modifications via methods below
}
```

**2. Create Setter Methods for Each State Change**:
```typescript
// Example: Score modification
public addScoreToPlayer(playerId: string, points: number, reason: ActionType, cards: Card[] | null = null): void {
  const player = this._gameState.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player ${playerId} not found`);
  
  const oldScore = player.score;
  player.score += points;
  
  // Automatically log event
  this.recordGameEvent(reason, playerId, cards, points);
  
  // Emit change event if needed
  this.emit('playerScoreChanged', { playerId, oldScore, newScore: player.score });
}

// Example: Phase change
public setPhase(newPhase: Phase, reason: ActionType): void {
  const oldPhase = this._gameState.currentPhase;
  this._gameState.currentPhase = newPhase;
  
  // Automatically log event
  this.recordGameEvent(reason, null, null, 0);
  
  this.emit('phaseChanged', { oldPhase, newPhase });
}

// Example: Card operations
public addCardToHand(playerId: string, card: Card): void {
  const player = this._gameState.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player ${playerId} not found`);
  
  player.hand.push(card);
  // Note: Individual card additions might not need events
  // Events are logged when the full operation completes (e.g., deal())
}

public removeCardFromHand(playerId: string, card: Card): void {
  const player = this._gameState.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player ${playerId} not found`);
  
  const index = player.hand.indexOf(card);
  if (index === -1) throw new Error(`Card not in player's hand`);
  
  player.hand.splice(index, 1);
}
```

**3. Refactor Existing Methods**:
```typescript
// Before:
public playCard(playerId: string, card: Card | null): string | null {
  // ... validation ...
  player.score += score; // Direct mutation
  this.recordGameEvent(ActionType.PLAY_CARD, playerId, [card], score); // Easy to forget
  // ...
}

// After:
public playCard(playerId: string, card: Card | null): string | null {
  // ... validation ...
  
  // Add card to stack
  this.addCardToPeggingStack(card);
  
  // Score pegging (automatically logs event)
  if (score > 0) {
    this.addScoreToPlayer(playerId, score, ActionType.PLAY_CARD, [card]);
  }
  
  // Record the play action
  this.recordGameEvent(ActionType.PLAY_CARD, playerId, [card], score);
  // ...
}
```

#### TypeScript Enforcements

**Use `Readonly<T>` for return types**:
```typescript
public getGameState(): Readonly<GameState> {
  return this._gameState;
}
```

**Use `DeepReadonly` utility type for nested immutability**:
```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

public getGameState(): DeepReadonly<GameState> {
  return this._gameState as DeepReadonly<GameState>;
}
```

**Note**: TypeScript's `readonly` is compile-time only. For runtime enforcement, consider using a library like `immer` or `immutable.js`, or implement deep cloning.

#### Complete Setter Method Catalog

Based on current `CribbageGame` usage, create setters for:

**Player State**:
- `addScoreToPlayer(playerId, points, reason, cards?)`
- `setPlayerDealer(playerId, isDealer)`
- `setPlayerHand(playerId, cards)` (for dealing)
- `addCardToPlayerHand(playerId, card)`
- `removeCardFromPlayerHand(playerId, card)`
- `setPlayerPeggingHand(playerId, cards)`
- `addCardToPlayerPeggingHand(playerId, card)`
- `removeCardFromPlayerPeggingHand(playerId, card)`

**Game State**:
- `setPhase(phase, reason)`
- `setTurnCard(card, reason)`
- `setCrib(cards)` (replaces entire crib)
- `addCardToCrib(card)`
- `setDeck(cards)`
- `shuffleDeck()`

**Pegging State**:
- `addCardToPeggingStack(card)`
- `clearPeggingStack()`
- `addPeggingGoPlayer(playerId)`
- `clearPeggingGoPlayers()`
- `setPeggingLastCardPlayer(playerId)`
- `setPeggingTotal(total)`

**Waiting State**:
- `addWaitingForPlayer(playerId, decisionType)`
- `removeWaitingForPlayer(playerId)`
- `clearAllWaiting()`

#### Benefits

✅ **Guaranteed Event Logging**: Impossible to modify state without logging  
✅ **Type Safety**: TypeScript prevents direct mutations  
✅ **Consistency**: All state changes follow the same pattern  
✅ **Debuggability**: Every state change is traceable  
✅ **Testability**: Easier to test state transitions  

---

## 4. Redacted Game State Views for Agents

### Problem Statement

**Current Issue**: Agents receive the full `GameState`, which includes all players' hands. For an online game, this leaks information - players shouldn't see opponents' cards.

**Current Implementation**:
```typescript
// In GameLoop.ts
const discards = await agent.discard(
  this.cribbageGame.getGameState(), // Full state with all hands visible!
  player.id,
  numberOfCardsToDiscard
);
```

**Security Risk**: A malicious agent could inspect `gameState.players[].hand` to see opponents' cards.

### Solution: Redacted Game State Views

**Core Principle**: Create a "redacted" version of `GameState` where each agent only sees:
- Their own hand (full visibility)
- Opponents' hands as `'UNKNOWN'` cards
- All other game state (deck count, scores, pegging stack, etc.)

#### Type System

**Create Redacted GameState Type**:
```typescript
// Base type remains the same
export interface GameState {
  // ... existing fields ...
}

// Redacted version for agents
export interface RedactedGameState extends Omit<GameState, 'players'> {
  players: RedactedPlayer[];
}

export interface RedactedPlayer extends Omit<Player, 'hand' | 'peggingHand'> {
  hand: Card[]; // Only this player's cards are visible, others are 'UNKNOWN'
  peggingHand: Card[]; // Only this player's cards are visible, others are 'UNKNOWN'
  // Other players' hands are redacted
}

// Or more explicit:
export interface RedactedPlayer {
  id: string;
  name: string;
  hand: Card[]; // Real cards for this player, 'UNKNOWN' for others
  peggingHand: Card[]; // Real cards for this player, 'UNKNOWN' for others
  playedCards: Card[]; // All played cards are visible
  score: number; // Scores are public
  isDealer: boolean; // Dealer status is public
}
```

#### Implementation

**Create Redaction Method**:
```typescript
// In CribbageGame.ts
public getRedactedGameState(forPlayerId: string): RedactedGameState {
  const fullState = this._gameState;
  
  const redactedPlayers = fullState.players.map(player => {
    if (player.id === forPlayerId) {
      // This player sees their own cards
      return {
        ...player,
        hand: player.hand,
        peggingHand: player.peggingHand,
      };
    } else {
      // Opponents' hands are redacted
      return {
        ...player,
        hand: player.hand.map(() => 'UNKNOWN' as Card),
        peggingHand: player.peggingHand.map(() => 'UNKNOWN' as Card),
      };
    }
  });
  
  return {
    ...fullState,
    players: redactedPlayers,
  };
}
```

**Update GameAgent Interface**:
```typescript
export interface GameAgent {
  playerId: string;
  human: boolean;
  
  // Agents receive redacted state
  makeMove(game: RedactedGameState, playerId: string): Promise<Card | null>;
  discard(
    game: RedactedGameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]>;
  waitForContinue?(
    game: RedactedGameState,
    playerId: string,
    continueDescription: string
  ): Promise<void>;
}
```

**Update GameLoop**:
```typescript
// In GameLoop.ts
private async doRound(): Promise<string | null> {
  // ...
  
  // Request discards from all players with redacted state
  const decisionPromises = this.cribbageGame.getGameState().players.map(async (player) => {
    const agent = this.agents[player.id];
    if (!agent) throw new Error(`No agent for player ${player.id}`);
    
    // Get redacted state for this player
    const redactedState = this.cribbageGame.getRedactedGameState(player.id);
    
    // Agent only sees their own cards
    const discards = await agent.discard(
      redactedState,
      player.id,
      numberOfCardsToDiscard
    );
    
    return { playerId: player.id, discards };
  });
  
  const results = await Promise.all(decisionPromises);
  // ...
}
```

#### Additional Redaction Considerations

**What Should Be Visible**:
✅ Player's own hand and pegging hand  
✅ All played cards (pegging stack, playedCards array)  
✅ All scores  
✅ Deck count (but not deck contents)  
✅ Crib (only after counting phase)  
✅ Turn card  
✅ Phase, round number, etc.  

**What Should Be Hidden**:
❌ Opponents' hands  
❌ Opponents' pegging hands  
❌ Deck contents (only count visible)  
❌ Crib (until counting phase)  

**Special Cases**:
- **Dealer's crib**: Only visible to dealer during counting phase
- **Pegging hand**: Only player's own pegging hand is visible
- **Played cards**: All played cards are public (already played)

#### Server-Side Enforcement

**For WebSocket Agents**:
```typescript
// In WebSocketAgent.ts
async discard(
  game: RedactedGameState, // Already redacted by server
  playerId: string,
  numberOfCardsToDiscard: number
): Promise<Card[]> {
  // Agent can only see their own hand
  const player = game.players.find(p => p.id === playerId);
  // player.hand contains real cards for this player
  // Other players' hands are all 'UNKNOWN'
  
  // ... rest of implementation ...
}
```

**Server Validation**:
```typescript
// In server.ts or CribbageGame
public validateDiscard(playerId: string, cards: Card[]): boolean {
  const player = this._gameState.players.find(p => p.id === playerId);
  if (!player) return false;
  
  // Validate against REAL game state, not redacted
  return cards.every(card => player.hand.includes(card));
}
```

#### Benefits

✅ **Security**: Prevents information leakage  
✅ **Fair Play**: All players have equal information  
✅ **Type Safety**: Redacted state is typed differently  
✅ **Flexibility**: Can create different redaction levels if needed  

---

## 5. Centralized UI State Derivation

### Problem Statement

**Original Question**: *"I have a running game state object that contains everything needed to show what the current game state is and then i have a list of 'game events' and each game event is tied to the game state changing in a particular way... the problem is that for the nice animations and the transient UI elements like score pop ups and text next to a player's hand that says 'GO' when they say go, the game state alone only dictates the underlying ui so the recent game events need to be used in addition to enable knowing when to show pop ups."*

**Current Architecture Issues**:
- **Fragmented UI Logic**: 6+ different components (`PlayerHand`, `PlayerHandOverlay`, `PlayArea`, etc.) each process `gameState` and `recentGameEvent` independently to decide what UI to show
- **Inconsistent Behavior**: Each component implements its own logic for detecting events, leading to inconsistencies
- **Hard to Maintain**: Changes to UI logic require updates across multiple components
- **AI-Unfriendly**: LLMs can't easily help because UI logic is scattered across the codebase
- **No Single Source of Truth**: Components make different assumptions about when to show/hide transient UI elements

**Current Implementation Example** (from `PlayerHandOverlay.tsx`):
```typescript
// Each component does its own event processing
useEffect(() => {
  if (!recentGameEvent) return;
  
  // Component-specific logic for showing "GO" message
  if (recentGameEvent.actionType === ActionType.GO) {
    setShowGoMessage(true);
    setTimeout(() => setShowGoMessage(false), 2000);
  }
  
  // Component-specific logic for showing score popup
  if (recentGameEvent.scoreChange > 0) {
    setPointsScored(recentGameEvent.scoreChange);
    setTimeout(() => setPointsScored(null), 3000);
  }
}, [recentGameEvent]);
```

**The Core Problem**: 
- `GameState` describes **what is** (current state)
- `GameEvent` describes **what just happened** (transition/delta)
- UI needs **both** to show stable elements AND transient animations/popups
- But currently, each component interprets this independently

### Solution: Centralized UI State Derivation

**Core Principle**: Create a single `useUiState(gameState, gameEvent)` hook that derives all UI-relevant state from `GameState` + `GameEvent`. Components become "dumb" renderers that simply display what the centralized UI state tells them to.

#### Architecture Overview

```
Server → GameSnapshot (gameState + gameEvent)
  ↓
Queue (with timing delays)
  ↓
deriveUiState(gameState, gameEvent, previousUiState)
  ↓
Centralized UI State Store (Zustand)
  ↓
Components (dumb renderers)
```

#### UI State Structure

**Complete UI State Type**:
```typescript
export interface UiState {
  // === Stable UI (derived from GameState) ===
  phase: Phase;
  currentPlayerTurn: string | null;
  waitingForPlayers: { playerId: string; decisionType: AgentDecisionType }[];
  playerScores: Record<string, number>;
  cardPositions: {
    hands: { playerId: string; cards: Card[] }[];
    crib: Card[];
    turnCard: Card | null;
    peggingStack: Card[];
  };
  
  // === Transient UI (derived from GameEvent) ===
  animations: {
    // Card animations
    cardAnimations: {
      id: string; // unique ID for this animation
      type: 'deal' | 'discard' | 'play' | 'score';
      card: Card;
      from: { playerId: string; position: 'hand' | 'peggingHand' };
      to: { position: 'crib' | 'peggingStack' | 'hand' | 'scorePile'; playerId?: string };
      duration: number;
      startTime: number;
    }[];
    
    // Phase transitions
    phaseTransition: {
      from: Phase;
      to: Phase;
      startTime: number;
      duration: number;
    } | null;
  };
  
  // === Popups and Messages ===
  popups: {
    // Score popups
    scorePopups: {
      playerId: string;
      points: number;
      reason: string; // 'fifteen', 'pair', 'run', 'lastCard', etc.
      startTime: number;
      duration: number;
    }[];
    
    // "GO" messages
    goMessages: {
      playerId: string;
      startTime: number;
      duration: number;
    }[];
    
    // Other transient messages
    messages: {
      id: string;
      text: string;
      type: 'info' | 'warning' | 'success';
      startTime: number;
      duration: number;
    }[];
  };
  
  // === Highlights and Focus ===
  highlights: {
    // Highlighted cards (for selection, valid plays, etc.)
    highlightedCards: {
      playerId: string;
      cards: Card[];
      reason: 'selected' | 'validPlay' | 'invalidPlay' | 'scoring';
    }[];
    
    // Highlighted players
    highlightedPlayers: {
      playerId: string;
      reason: 'turn' | 'waiting' | 'winner';
    }[];
  };
  
  // === Timing and Pacing ===
  timing: {
    // Current processing delay
    currentDelay: number;
    // Whether we're in a "pause" state (e.g., showing hands during counting)
    isPaused: boolean;
    pauseReason: string | null;
  };
}
```

#### Derivation Function

**Core Derivation Logic**:
```typescript
// hooks/useUiState.ts
import { GameState, GameEvent, Phase, ActionType } from 'cribbage-core';

export function deriveUiState(
  gameState: GameState | null,
  gameEvent: GameEvent | null,
  previousUiState: UiState | null,
  playerId: string | null,
  processedSnapshotIds: Set<number> // Track processed snapshots to prevent duplicates
): UiState {
  if (!gameState) {
    return getEmptyUiState();
  }
  
  const uiState: UiState = {
    // === Stable UI (from GameState) ===
    phase: gameState.currentPhase,
    currentPlayerTurn: gameState.waitingForPlayers[0]?.playerId || null,
    waitingForPlayers: gameState.waitingForPlayers,
    playerScores: Object.fromEntries(
      gameState.players.map(p => [p.id, p.score])
    ),
    cardPositions: {
      hands: gameState.players.map(p => ({
        playerId: p.id,
        cards: p.hand,
      })),
      crib: gameState.crib,
      turnCard: gameState.turnCard,
      peggingStack: gameState.peggingStack,
    },
    
    // === Transient UI (from GameEvent + previous state) ===
    animations: deriveAnimations(gameState, gameEvent, previousUiState, processedSnapshotIds),
    popups: derivePopups(gameState, gameEvent, previousUiState, processedSnapshotIds),
    highlights: deriveHighlights(gameState, gameEvent, playerId),
    timing: deriveTiming(gameState, gameEvent),
  };
  
  return uiState;
}

function deriveAnimations(
  gameState: GameState,
  gameEvent: GameEvent | null,
  previousUiState: UiState | null,
  processedSnapshotIds: Set<number>
): UiState['animations'] {
  const cardAnimations: UiState['animations']['cardAnimations'] = [];
  const now = Date.now();
  
  if (!gameEvent || !previousUiState) {
    return { cardAnimations: [], phaseTransition: null };
  }
  
  // Keep previous animations that haven't expired
  const previousAnimations = previousUiState?.animations.cardAnimations.filter(
    anim => now < anim.startTime + anim.duration
  ) || [];
  
  // Track existing animation IDs to prevent duplicates
  const existingIds = new Set(previousAnimations.map(a => a.id));
  
  // Card played animation (only if not already processed)
  if (gameEvent.actionType === ActionType.PLAY_CARD && gameEvent.cards && !processedSnapshotIds.has(gameEvent.snapshotId)) {
    const animId = `play-${gameEvent.snapshotId}`;
    if (!existingIds.has(animId)) {
      cardAnimations.push({
        id: animId,
        type: 'play',
        card: gameEvent.cards[0],
        from: {
          playerId: gameEvent.playerId!,
          position: 'peggingHand',
        },
        to: {
          position: 'peggingStack',
        },
        duration: 500,
        startTime: now,
      });
    }
  }
  
  // Card discarded animation (only if not already processed)
  if (gameEvent.actionType === ActionType.DISCARD && gameEvent.cards && !processedSnapshotIds.has(gameEvent.snapshotId)) {
    gameEvent.cards.forEach((card, index) => {
      const animId = `discard-${gameEvent.snapshotId}-${index}`;
      if (!existingIds.has(animId)) {
        cardAnimations.push({
          id: animId,
          type: 'discard',
          card,
          from: {
            playerId: gameEvent.playerId!,
            position: 'hand',
          },
          to: {
            position: 'crib',
          },
          duration: 600,
          startTime: now + (index * 100), // Stagger animations
        });
      }
    });
  }
  
  // Deal animation (only if not already processed)
  if (gameEvent.actionType === ActionType.DEAL && gameEvent.cards && !processedSnapshotIds.has(gameEvent.snapshotId)) {
    gameEvent.cards.forEach((card, index) => {
      const animId = `deal-${gameEvent.snapshotId}-${index}`;
      if (!existingIds.has(animId)) {
        cardAnimations.push({
          id: animId,
          type: 'deal',
          card,
          from: {
            playerId: gameEvent.playerId!,
            position: 'deck',
          },
          to: {
            position: 'hand',
            playerId: gameEvent.playerId!,
          },
          duration: 400,
          startTime: now + (index * 50), // Stagger deal animations
        });
      }
    });
  }
  
  // Phase transition
  const phaseTransition = previousUiState?.phase !== gameState.currentPhase
    ? {
        from: previousUiState.phase,
        to: gameState.currentPhase,
        startTime: now,
        duration: 800,
      }
    : previousUiState?.animations.phaseTransition;
  
  return {
    cardAnimations: [...previousAnimations, ...cardAnimations],
    phaseTransition,
  };
}

function derivePopups(
  gameState: GameState,
  gameEvent: GameEvent | null,
  previousUiState: UiState | null,
  processedSnapshotIds: Set<number>
): UiState['popups'] {
  const now = Date.now();
  const scorePopups: UiState['popups']['scorePopups'] = [];
  const goMessages: UiState['popups']['goMessages'] = [];
  const messages: UiState['popups']['messages'] = [];
  
  // Keep previous popups that haven't expired
  const previousScorePopups = previousUiState?.popups.scorePopups.filter(
    p => now < p.startTime + p.duration
  ) || [];
  const previousGoMessages = previousUiState?.popups.goMessages.filter(
    m => now < m.startTime + m.duration
  ) || [];
  const previousMessages = previousUiState?.popups.messages.filter(
    m => now < m.startTime + m.duration
  ) || [];
  
  // Track existing popup IDs to prevent duplicates
  const existingScorePopupIds = new Set(previousScorePopups.map(p => `${p.playerId}-${p.startTime}`));
  const existingGoMessageIds = new Set(previousGoMessages.map(m => `${m.playerId}-${m.startTime}`));
  const existingMessageIds = new Set(previousMessages.map(m => m.id));
  
  if (!gameEvent) {
    // No new event, just return existing popups
    return {
      scorePopups: previousScorePopups,
      goMessages: previousGoMessages,
      messages: previousMessages,
    };
  }
  
  // Only process if this snapshot hasn't been processed before
  if (!processedSnapshotIds.has(gameEvent.snapshotId)) {
    // Score popup
    if (gameEvent.scoreChange > 0 && gameEvent.playerId) {
      const popupId = `${gameEvent.playerId}-${now}`;
      if (!existingScorePopupIds.has(popupId)) {
        const reason = getScoreReason(gameEvent.actionType, gameEvent, gameState);
        scorePopups.push({
          playerId: gameEvent.playerId,
          points: gameEvent.scoreChange,
          reason, // Future-proofed: can be enhanced with detailed reasons (see todo.md)
          startTime: now,
          duration: 3000,
        });
      }
    }
    
    // "GO" message
    if (gameEvent.actionType === ActionType.GO && gameEvent.playerId) {
      const messageId = `${gameEvent.playerId}-${now}`;
      if (!existingGoMessageIds.has(messageId)) {
        goMessages.push({
          playerId: gameEvent.playerId,
          startTime: now,
          duration: 2000,
        });
      }
    }
    
    // Phase transition messages
    if (gameEvent.actionType === ActionType.BEGIN_PHASE) {
      const phaseMessage = getPhaseMessage(gameState.currentPhase);
      if (phaseMessage) {
        const messageId = `phase-${gameEvent.snapshotId}`;
        if (!existingMessageIds.has(messageId)) {
          messages.push({
            id: messageId,
            text: phaseMessage,
            type: 'info',
            startTime: now,
            duration: 2000,
          });
        }
      }
    }
  }
  
  return {
    scorePopups: [...previousScorePopups, ...scorePopups],
    goMessages: [...previousGoMessages, ...goMessages],
    messages: [...previousMessages, ...messages],
  };
}

function deriveHighlights(
  gameState: GameState,
  gameEvent: GameEvent | null,
  playerId: string | null
): UiState['highlights'] {
  const highlightedCards: UiState['highlights']['highlightedCards'] = [];
  const highlightedPlayers: UiState['highlights']['highlightedPlayers'] = [];
  
  // Highlight waiting players
  gameState.waitingForPlayers.forEach(waiting => {
    highlightedPlayers.push({
      playerId: waiting.playerId,
      reason: 'waiting',
    });
  });
  
  // Highlight current turn player (if different from waiting)
  if (gameState.currentPhase === Phase.PEGGING) {
    // Determine whose turn it is based on pegging state
    const currentTurnPlayer = getCurrentTurnPlayer(gameState);
    if (currentTurnPlayer && !gameState.waitingForPlayers.find(w => w.playerId === currentTurnPlayer)) {
      highlightedPlayers.push({
        playerId: currentTurnPlayer,
        reason: 'turn',
      });
    }
  }
  
  // Highlight valid plays for current player
  if (playerId && gameState.waitingForPlayers.find(w => w.playerId === playerId && w.decisionType === AgentDecisionType.PLAY_CARD)) {
    const player = gameState.players.find(p => p.id === playerId);
    if (player) {
      const validCards = getValidPeggingCards(gameState, player);
      highlightedCards.push({
        playerId,
        cards: validCards,
        reason: 'validPlay',
      });
    }
  }
  
  return {
    highlightedCards,
    highlightedPlayers,
  };
}


function deriveTiming(
  gameState: GameState,
  gameEvent: GameEvent | null
): UiState['timing'] {
  let currentDelay = 500; // Default
  let isPaused = false;
  let pauseReason: string | null = null;
  
  if (!gameEvent) {
    return { currentDelay, isPaused, pauseReason };
  }
  
  // Determine delay based on event type
  if (gameEvent.actionType === ActionType.START_PEGGING_ROUND) {
    currentDelay = 1500;
  } else if (gameState.currentPhase === Phase.DEALING) {
    currentDelay = 300;
  } else if (gameState.currentPhase === Phase.COUNTING) {
    currentDelay = 2000;
    isPaused = true;
    pauseReason = 'showing hands for scoring';
  } else if (gameEvent.actionType === ActionType.SCORE_HAND || gameEvent.actionType === ActionType.SCORE_CRIB) {
    currentDelay = 3000;
    isPaused = true;
    pauseReason = 'showing scored hand';
  }
  
  return { currentDelay, isPaused, pauseReason };
}

// Helper functions
function getScoreReason(
  actionType: ActionType,
  gameEvent: GameEvent,
  gameState: GameState
): string {
  // Map action types to user-friendly reasons
  // TODO: Enhance with detailed reasons like "fifteen", "pair", "run of 3" (see todo.md)
  // Future enhancement: Derive from gameEvent.cards and gameState.peggingStack
  // or add scoring reason metadata to GameEvent (requires core-side changes)
  if (actionType === ActionType.SCORE_HAND) return 'hand';
  if (actionType === ActionType.SCORE_CRIB) return 'crib';
  if (actionType === ActionType.LAST_CARD) return 'lastCard';
  if (actionType === ActionType.SCORE_HEELS) return 'heels';
  return 'points';
}

function getPhaseMessage(phase: Phase): string | null {
  const messages: Record<Phase, string | null> = {
    [Phase.DEALING]: null,
    [Phase.DISCARDING]: 'Select cards to discard',
    [Phase.CUTTING]: 'Cut the deck',
    [Phase.PEGGING]: 'Play cards',
    [Phase.COUNTING]: 'Scoring hands',
    [Phase.END]: null,
  };
  return messages[phase] || null;
}

function getCurrentTurnPlayer(gameState: GameState): string | null {
  // Logic to determine whose turn it is based on game state
  // This is simplified - actual implementation would be more complex
  if (gameState.waitingForPlayers.length > 0) {
    return gameState.waitingForPlayers[0].playerId;
  }
  return null;
}

function getValidPeggingCards(gameState: GameState, player: Player): Card[] {
  // Logic to determine valid cards for pegging
  // This would use existing validation logic
  return player.peggingHand.filter(card => {
    // Simplified - actual implementation would check pegging rules
    return true;
  });
}
```

#### Integration with Existing Queue System

**Updated `useGameState.ts`**:
```typescript
// hooks/useGameState.ts
import { deriveUiState } from './useUiState';
import { useUiStateStore } from '../state/uiStateStore';

const useGameState = (playerId: string | null) => {
  // ... existing code ...
  
  const { setUiState } = useUiStateStore();
  const previousUiStateRef = useRef<UiState | null>(null);
  const processedSnapshotIdsRef = useRef<Set<number>>(new Set());
  
  const processQueue = () => {
    // ... existing queue processing ...
    
    const { gameState, gameEvent } = gameEventQueue.current.shift()!;
    
    // Derive UI state from game state + event
    const uiState = deriveUiState(
      gameState,
      gameEvent,
      previousUiStateRef.current,
      playerId,
      processedSnapshotIdsRef.current
    );
    
    // Mark this snapshot as processed to prevent duplicates
    if (gameEvent) {
      processedSnapshotIdsRef.current.add(gameEvent.snapshotId);
      // Clean up old snapshot IDs (keep last 100 to prevent memory leak)
      if (processedSnapshotIdsRef.current.size > 100) {
        const idsArray = Array.from(processedSnapshotIdsRef.current);
        const oldestIds = idsArray.slice(0, idsArray.length - 100);
        oldestIds.forEach(id => processedSnapshotIdsRef.current.delete(id));
      }
    }
    
    // Update stores
    setGameState(gameState);
    // NOTE: recentGameEvent removed in migration - components use uiState instead
    setUiState(uiState); // NEW: Set centralized UI state
    
    // Store for next iteration
    previousUiStateRef.current = uiState;
    
    // ... rest of processing ...
  };
  
  // ... rest of hook ...
};
```

#### UI State Store

**New Zustand Store**:
```typescript
// state/uiStateStore.ts
import { create } from 'zustand';
import { UiState } from '../types/uiState';

type UiStateStore = {
  uiState: UiState | null;
  setUiState: (uiState: UiState) => void;
  resetState: () => void;
};

export const useUiStateStore = create<UiStateStore>((set) => ({
  uiState: null,
  setUiState: (uiState) => set({ uiState }),
  resetState: () => set({ uiState: null }),
}));
```

#### Updated Components (Dumb Renderers)

**Before** (`PlayerHandOverlay.tsx`):
```typescript
// OLD: Component processes events itself
export const PlayerHandOverlay: React.FC<PlayerHandOverlayProps> = ({ playerId }) => {
  const { recentGameEvent, gameState } = useGameStateStore();
  const [showGoMessage, setShowGoMessage] = useState(false);
  const [pointsScored, setPointsScored] = useState<number | null>(null);
  
  useEffect(() => {
    // Component-specific logic for detecting events
    if (recentGameEvent?.actionType === ActionType.GO) {
      setShowGoMessage(true);
      setTimeout(() => setShowGoMessage(false), 2000);
    }
    // ... more logic ...
  }, [recentGameEvent]);
  
  return (
    <View>
      {showGoMessage && <Text>GO</Text>}
      {pointsScored && <Text>+{pointsScored}</Text>}
    </View>
  );
};
```

**After** (`PlayerHandOverlay.tsx`):
```typescript
// NEW: Component just renders what UI state says
export const PlayerHandOverlay: React.FC<PlayerHandOverlayProps> = ({ playerId }) => {
  const { uiState } = useUiStateStore();
  
  if (!uiState) return null;
  
  // Find popups for this player
  const goMessage = uiState.popups.goMessages.find(m => m.playerId === playerId);
  const scorePopup = uiState.popups.scorePopups.find(p => p.playerId === playerId);
  
  // Check if popup has expired
  const now = Date.now();
  const showGo = goMessage && now < goMessage.startTime + goMessage.duration;
  const showScore = scorePopup && now < scorePopup.startTime + scorePopup.duration;
  
  return (
    <View>
      {showGo && (
        <Animated.View>
          <Text>GO</Text>
        </Animated.View>
      )}
      {showScore && (
        <Animated.View>
          <Text>+{scorePopup.points}</Text>
          <Text>{scorePopup.reason}</Text>
        </Animated.View>
      )}
    </View>
  );
};
```

#### Transient State Persistence Across Updates

**The Problem**: React is great for instant updates, but animations and transient UI elements (popups, fades, etc.) need to persist across multiple game state updates. For example:

1. Player A discards → score popup appears, starts fading (3000ms duration)
2. 500ms later, Player B discards → new `GameSnapshot` arrives
3. If we just derive UI state from the new snapshot, we might lose Player A's in-progress popup

**The Solution**: Use timestamp-based state with expiration checks, and merge old + new transient state.

**Key Design Principles**:

1. **Timestamp-Based State**: Every transient UI element has a `startTime` and `duration`
2. **Expiration Checks**: Filter out expired animations/popups when deriving new state
3. **Merge Old + New**: Keep previous transient state that hasn't expired, add new transient state
4. **React Native Animation Libraries**: Use `react-native-reanimated` or `react-native-animated` which handle their own timing independently of React renders

**Implementation Details**:

```typescript
function derivePopups(
  gameState: GameState,
  gameEvent: GameEvent | null,
  previousUiState: UiState | null
): UiState['popups'] {
  const now = Date.now();
  const scorePopups: UiState['popups']['scorePopups'] = [];
  const goMessages: UiState['popups']['goMessages'] = [];
  const messages: UiState['popups']['messages'] = [];
  
  // === CRITICAL: Keep previous popups that haven't expired ===
  const previousScorePopups = previousUiState?.popups.scorePopups.filter(
    p => now < p.startTime + p.duration
  ) || [];
  const previousGoMessages = previousUiState?.popups.goMessages.filter(
    m => now < m.startTime + m.duration
  ) || [];
  const previousMessages = previousUiState?.popups.messages.filter(
    m => now < m.startTime + m.duration
  ) || [];
  
  // === Add new popups from current event ===
  if (gameEvent) {
    if (gameEvent.scoreChange > 0 && gameEvent.playerId) {
      scorePopups.push({
        playerId: gameEvent.playerId,
        points: gameEvent.scoreChange,
        reason: getScoreReason(gameEvent.actionType),
        startTime: now, // Use current time as start
        duration: 3000,
      });
    }
    
    if (gameEvent.actionType === ActionType.GO && gameEvent.playerId) {
      goMessages.push({
        playerId: gameEvent.playerId,
        startTime: now,
        duration: 2000,
      });
    }
  }
  
  // === Merge old + new ===
  return {
    scorePopups: [...previousScorePopups, ...scorePopups],
    goMessages: [...previousGoMessages, ...goMessages],
    messages: [...previousMessages, ...messages],
  };
}
```

**Component Implementation**:

Components check if animations/popups are still active based on current time:

```typescript
export const PlayerHandOverlay: React.FC<PlayerHandOverlayProps> = ({ playerId }) => {
  const { uiState } = useUiStateStore();
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // Update current time periodically for expiration checks
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100); // Update every 100ms for smooth expiration
    
    return () => clearInterval(interval);
  }, []);
  
  if (!uiState) return null;
  
  // Find active popups for this player
  const activeScorePopup = uiState.popups.scorePopups.find(
    p => p.playerId === playerId && 
         currentTime < p.startTime + p.duration
  );
  
  const activeGoMessage = uiState.popups.goMessages.find(
    m => m.playerId === playerId && 
         currentTime < m.startTime + m.duration
  );
  
  // Calculate animation progress (0 to 1)
  const scorePopupProgress = activeScorePopup
    ? Math.min(1, (currentTime - activeScorePopup.startTime) / activeScorePopup.duration)
    : 0;
  
  return (
    <View>
      {activeGoMessage && (
        <Animated.View
          style={{
            opacity: 1 - scorePopupProgress, // Fade out over duration
          }}
        >
          <Text>GO</Text>
        </Animated.View>
      )}
      {activeScorePopup && (
        <Animated.View
          style={{
            opacity: 1 - scorePopupProgress,
            transform: [{ translateY: -20 * scorePopupProgress }], // Slide up while fading
          }}
        >
          <Text>+{activeScorePopup.points}</Text>
        </Animated.View>
      )}
    </View>
  );
};
```

**Better Approach: Use react-native-reanimated**

For smoother animations that don't depend on React renders, use `react-native-reanimated`:

```typescript
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming,
  runOnJS 
} from 'react-native-reanimated';

export const ScorePopup: React.FC<{
  popup: UiState['popups']['scorePopups'][0];
  onComplete: () => void;
}> = ({ popup, onComplete }) => {
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);
  
  useEffect(() => {
    // Start animation immediately
    opacity.value = withTiming(0, { duration: popup.duration });
    translateY.value = withTiming(-20, { duration: popup.duration });
    
    // Call onComplete when animation finishes
    const timer = setTimeout(() => {
      onComplete();
    }, popup.duration);
    
    return () => clearTimeout(timer);
  }, [popup.id]); // Re-run if popup changes
  
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
  
  return (
    <Animated.View style={animatedStyle}>
      <Text>+{popup.points}</Text>
    </Animated.View>
  );
};
```

**Component That Renders All Active Popups**:

```typescript
export const PopupManager: React.FC = () => {
  const { uiState } = useUiStateStore();
  const [activePopups, setActivePopups] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    if (!uiState) return;
    
    const now = Date.now();
    const active = new Set<string>();
    
    // Track all active popups
    uiState.popups.scorePopups.forEach(popup => {
      if (now < popup.startTime + popup.duration) {
        active.add(`score-${popup.playerId}-${popup.startTime}`);
      }
    });
    
    uiState.popups.goMessages.forEach(msg => {
      if (now < msg.startTime + msg.duration) {
        active.add(`go-${msg.playerId}-${msg.startTime}`);
      }
    });
    
    setActivePopups(active);
  }, [uiState]);
  
  if (!uiState) return null;
  
  return (
    <>
      {uiState.popups.scorePopups.map(popup => {
        const id = `score-${popup.playerId}-${popup.startTime}`;
        if (!activePopups.has(id)) return null;
        
        return (
          <ScorePopup
            key={id}
            popup={popup}
            onComplete={() => {
              // Remove from active set when animation completes
              setActivePopups(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }}
          />
        );
      })}
      {/* Similar for goMessages */}
    </>
  );
};
```

**Alternative: Use Animation IDs for Deduplication**

To prevent duplicate animations if the same event is processed twice:

```typescript
function deriveAnimations(
  gameState: GameState,
  gameEvent: GameEvent | null,
  previousUiState: UiState | null
): UiState['animations'] {
  const now = Date.now();
  const cardAnimations: UiState['animations']['cardAnimations'] = [];
  
  // Keep previous animations that haven't expired
  const previousAnimations = previousUiState?.animations.cardAnimations.filter(
    anim => now < anim.startTime + anim.duration
  ) || [];
  
  // Track existing animation IDs to prevent duplicates
  const existingIds = new Set(previousAnimations.map(a => a.id));
  
  // Add new animations (only if not already present)
  if (gameEvent && gameEvent.actionType === ActionType.PLAY_CARD && gameEvent.cards) {
    const animId = `play-${gameEvent.snapshotId}`;
    if (!existingIds.has(animId)) {
      cardAnimations.push({
        id: animId,
        type: 'play',
        card: gameEvent.cards[0],
        from: { playerId: gameEvent.playerId!, position: 'peggingHand' },
        to: { position: 'peggingStack' },
        duration: 500,
        startTime: now,
      });
    }
  }
  
  return {
    cardAnimations: [...previousAnimations, ...cardAnimations],
    phaseTransition: /* ... */,
  };
}
```

**Key Takeaways**:

1. ✅ **Always merge old + new**: Never replace transient state, always merge
2. ✅ **Use timestamps**: `startTime` + `duration` allows expiration checks
3. ✅ **Filter expired**: Remove expired animations/popups when deriving new state
4. ✅ **Use animation libraries**: `react-native-reanimated` handles timing independently
5. ✅ **Unique IDs**: Use unique IDs (e.g., `snapshotId` + event type) to prevent duplicates
6. ✅ **Track processed snapshots**: Use `processedSnapshotIds` Set to prevent duplicate animations/popups
7. ✅ **Component-level checks**: Components can also check expiration for fine-grained control

This approach ensures that transient UI elements persist across multiple game state updates, allowing smooth, staggered animations even when new events arrive mid-animation.

#### Performance Considerations

**Memoization**: The derivation function is called on every `GameSnapshot` processing. For now, we're not memoizing because:
- Derivation is mostly object creation and simple checks (should be fast)
- `GameSnapshot` processing already happens sequentially with delays
- If profiling shows performance issues, we can add memoization later

**Memory Management**: `processedSnapshotIds` Set is cleaned up automatically (keeps last 100 IDs) to prevent memory leaks during long games.

**UI Flow Specification**: See `cribbage-with-friends-app/docs/UI_FLOW_SPEC.md` for detailed flow specification document.

#### Benefits

✅ **Single Source of Truth**: All UI logic in one place  
✅ **AI-Friendly**: LLMs can easily understand and modify UI behavior  
✅ **Consistent**: All components use the same logic  
✅ **Maintainable**: Changes in one place affect entire app  
✅ **Testable**: Can test UI state derivation independently  
✅ **Debuggable**: Log `uiState` to see exactly what UI should show  
✅ **Composable**: Components become simple, reusable renderers  
✅ **Deterministic**: Same `gameState` + `gameEvent` = same UI state  

#### Migration Strategy

**Component Migration Order** (recommended):
1. `PlayerHandOverlay` - Proof of concept, simplest component
2. `PlayerHand` - Uses `recentGameEvent` for counting phase logic
3. `PlayArea` - Minimal event processing
4. Other components as needed

**Implementation Phases**:

**Phase 1**: Foundation
- Create `UiState` type definition file (`types/uiState.ts`)
- Create `deriveUiState` function (`utils/uiState.ts`)
- Create `useUiStateStore` Zustand store (`state/uiStateStore.ts`)
- Add unit tests for derivation functions
- Create `UI_FLOW_SPEC.md` document (see separate file)

**Phase 2**: Integration
- Update `useGameState` to call `deriveUiState()` and set UI state
- Add `processedSnapshotIds` tracking to prevent duplicates
- Remove `recentGameEvent` usage from `useGameState` (rip the bandaid off)

**Phase 3**: Component Migration (all at once)
- Update `PlayerHandOverlay` to use `uiState`
- Update `PlayerHand` to use `uiState`
- Update `PlayArea` to use `uiState`
- Update any other components that process events
- Remove all `recentGameEvent` usage from components

**Phase 4**: Cleanup
- Remove `recentGameEvent` from `useGameStateStore`
- Remove all event processing logic from components
- Verify all components are "dumb renderers"

**Note**: We're removing old stuff in one fell swoop - no backwards compatibility during migration. This keeps the codebase clean and avoids confusing intermediate states.

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Set up infrastructure without breaking existing functionality

1. **Add `waitingForPlayers` array to `GameState`** (alongside `waitingForPlayer` for compatibility)
2. **Add `WAITING_FOR_*` action types** to `ActionType` enum
3. **Create `setWaitingForPlayer()` and `addWaitingForPlayer()` methods** in `CribbageGame`
4. **Update `recordGameEvent()`** to handle waiting events
5. **Create `getRedactedGameState()` method** (not yet used)
6. **Add basic setter methods** for most common operations (score, phase, etc.)

**Testing**: Run existing bot vs bot games to ensure nothing breaks

### Phase 2: Decision Requests Integration (Week 3)

**Goal**: Integrate waiting state into GameState/GameEvent

1. **Update `GameLoop`** to use `requestDecision()` pattern
2. **Update `CribbageGame` methods** to clear waiting state before actions
3. **Update server** to read waiting state from `GameSnapshot`
4. **Update client** to derive decision requests from `GameState`
5. **Keep old WebSocket events** as fallback during transition

**Testing**: 
- Bot vs bot games
- Human vs bot games
- Reconnection tests

### Phase 3: Parallel Decisions (Week 4)

**Goal**: Enable parallel decision requests

1. **Refactor discard phase** to use `Promise.all()`
2. **Refactor continue prompts** to be parallel where possible
3. **Update `waitingForPlayers` array** management
4. **Update UI** to handle multiple waiting players

**Testing**:
- Verify all players can discard simultaneously
- Verify pegging remains sequential
- Performance testing with multiple players

### Phase 4: Immutable GameState (Week 5-6)

**Goal**: Enforce state changes through setters

1. **Make `gameState` private** with read-only getter
2. **Create all setter methods** for state changes
3. **Refactor `CribbageGame` methods** to use setters
4. **Add TypeScript `Readonly` types**
5. **Update all call sites** to use setters

**Testing**:
- Comprehensive unit tests for all setters
- Integration tests for full game flow
- Verify all events are logged

### Phase 5: Redacted State (Week 7)

**Goal**: Implement privacy/security

1. **Create `RedactedGameState` type**
2. **Implement `getRedactedGameState()` method**
3. **Update `GameAgent` interface** to use `RedactedGameState`
4. **Update `GameLoop`** to pass redacted state to agents
5. **Add validation** to ensure agents can't access full state

**Testing**:
- Verify agents can't see opponents' hands
- Verify agents can see their own hands
- Security audit

### Phase 6: Centralized UI State (Week 8-9)

**Goal**: Create centralized UI state derivation system

1. **Create `UiState` type** with all UI-relevant state (`types/uiState.ts`)
2. **Implement `deriveUiState()` function** with all derivation logic (`utils/uiState.ts`)
3. **Create `useUiStateStore`** Zustand store (`state/uiStateStore.ts`)
4. **Add `processedSnapshotIds` tracking** to prevent duplicates
5. **Update `useGameState` hook** to call `deriveUiState()` and set UI state
6. **Remove `recentGameEvent` usage** from `useGameState` (rip the bandaid off)
7. **Create UI flow specification** markdown document (`docs/UI_FLOW_SPEC.md`)
8. **Add comprehensive unit tests** for derivation functions

**Testing**:
- Unit tests for `deriveUiState()` function with various `GameState`/`GameEvent` combinations
- Unit tests for transient state persistence (popups surviving multiple updates)
- Unit tests for animation deduplication
- Unit tests for edge cases (null states, rapid events, etc.)
- Integration test with queue system
- Visual verification of UI behavior

### Phase 7: Component Migration (Week 10-11)

**Goal**: Migrate all components to use centralized UI state (all at once)

1. **Update `PlayerHandOverlay` component** to use `uiState` (proof of concept)
2. **Update `PlayerHand` component** to use `uiState`
3. **Update `PlayArea` component** to use `uiState`
4. **Update any other components** that process events
5. **Remove all `recentGameEvent` usage** from components
6. **Remove all event processing logic** from components
7. **Remove `recentGameEvent` from `useGameStateStore`** (cleanup)

**Testing**:
- Visual regression testing
- Verify all animations/popups still work
- Verify no `recentGameEvent` references remain
- Performance testing

### Phase 8: Cleanup & Optimization (Week 12)

**Goal**: Remove legacy code and optimize

1. **Remove `waitingForPlayer`** (use only `waitingForPlayers`)
2. **Remove old WebSocket events** (`waitingForPlayer`, etc.)
3. **Remove `EmittedWaitingForPlayer`** types (or keep minimal versions)
4. **Optimize redaction** (cache redacted states if needed)
5. **Optimize UI state derivation** (memoization, etc.)
6. **Update documentation**

**Testing**: Full regression testing

---

## 7. Testing Strategy

### Unit Tests

**For Setter Methods**:
```typescript
describe('CribbageGame setters', () => {
  it('should log event when adding score', () => {
    const game = new CribbageGame(players);
    game.addScoreToPlayer('player1', 5, ActionType.SCORE_HAND);
    
    const history = game.getGameSnapshotHistory();
    expect(history[history.length - 1].gameEvent.actionType).toBe(ActionType.SCORE_HAND);
    expect(history[history.length - 1].gameEvent.scoreChange).toBe(5);
  });
  
  it('should prevent direct state mutation', () => {
    const game = new CribbageGame(players);
    const state = game.getGameState();
    
    // TypeScript should prevent this, but test runtime behavior
    expect(() => {
      (state as any).players[0].score = 999; // Should not affect internal state
    }).not.toThrow(); // But we need to verify it doesn't actually change
    
    const internalState = (game as any)._gameState;
    expect(internalState.players[0].score).not.toBe(999);
  });
});
```

**For Redaction**:
```typescript
describe('GameState redaction', () => {
  it('should hide opponents hands', () => {
    const game = new CribbageGame(players);
    game.deal(); // Deal cards
    
    const redacted = game.getRedactedGameState('player1');
    const opponent = redacted.players.find(p => p.id === 'player2');
    
    expect(opponent.hand.every(card => card === 'UNKNOWN')).toBe(true);
  });
  
  it('should show own hand', () => {
    const game = new CribbageGame(players);
    game.deal();
    
    const redacted = game.getRedactedGameState('player1');
    const self = redacted.players.find(p => p.id === 'player1');
    
    expect(self.hand.every(card => card !== 'UNKNOWN')).toBe(true);
  });
});
```

**For UI State Derivation**:
```typescript
describe('deriveUiState', () => {
  it('should create score popup for scoring events', () => {
    const gameState = createMockGameState();
    const gameEvent = createMockGameEvent({
      actionType: ActionType.PLAY_CARD,
      scoreChange: 2,
      playerId: 'player1',
      snapshotId: 1,
    });
    const processedIds = new Set<number>();
    
    const uiState = deriveUiState(gameState, gameEvent, null, 'player1', processedIds);
    
    expect(uiState.popups.scorePopups).toHaveLength(1);
    expect(uiState.popups.scorePopups[0].playerId).toBe('player1');
    expect(uiState.popups.scorePopups[0].points).toBe(2);
  });
  
  it('should persist popups across multiple updates', () => {
    const gameState = createMockGameState();
    const event1 = createMockGameEvent({
      actionType: ActionType.PLAY_CARD,
      scoreChange: 2,
      playerId: 'player1',
      snapshotId: 1,
    });
    const processedIds = new Set<number>();
    
    const uiState1 = deriveUiState(gameState, event1, null, 'player1', processedIds);
    processedIds.add(1);
    
    // Simulate new event arriving 500ms later
    const event2 = createMockGameEvent({
      actionType: ActionType.PLAY_CARD,
      scoreChange: 0,
      playerId: 'player2',
      snapshotId: 2,
    });
    
    // Mock Date.now to return time 500ms after first popup
    const originalNow = Date.now;
    Date.now = jest.fn(() => originalNow() + 500);
    
    const uiState2 = deriveUiState(gameState, event2, uiState1, 'player1', processedIds);
    
    // First popup should still be present (hasn't expired)
    expect(uiState2.popups.scorePopups).toHaveLength(1);
    expect(uiState2.popups.scorePopups[0].playerId).toBe('player1');
    
    Date.now = originalNow;
  });
  
  it('should prevent duplicate animations for same snapshot', () => {
    const gameState = createMockGameState();
    const gameEvent = createMockGameEvent({
      actionType: ActionType.PLAY_CARD,
      cards: [{ suit: 'hearts', rank: '5' }],
      playerId: 'player1',
      snapshotId: 1,
    });
    const processedIds = new Set<number>();
    
    const uiState1 = deriveUiState(gameState, gameEvent, null, 'player1', processedIds);
    processedIds.add(1);
    
    // Process same event again
    const uiState2 = deriveUiState(gameState, gameEvent, uiState1, 'player1', processedIds);
    
    // Should not create duplicate animation
    const playAnimations = uiState2.animations.cardAnimations.filter(
      a => a.id === `play-${gameEvent.snapshotId}`
    );
    expect(playAnimations).toHaveLength(1);
  });
  
  it('should handle null gameState gracefully', () => {
    const uiState = deriveUiState(null, null, null, null, new Set());
    
    expect(uiState).toBeDefined();
    expect(uiState.popups.scorePopups).toHaveLength(0);
    expect(uiState.animations.cardAnimations).toHaveLength(0);
  });
  
  it('should filter expired popups', () => {
    const gameState = createMockGameState();
    const gameEvent = createMockGameEvent({
      actionType: ActionType.PLAY_CARD,
      scoreChange: 2,
      playerId: 'player1',
      snapshotId: 1,
    });
    const processedIds = new Set<number>();
    
    const uiState1 = deriveUiState(gameState, gameEvent, null, 'player1', processedIds);
    processedIds.add(1);
    
    // Mock Date.now to return time after popup duration (3000ms)
    const originalNow = Date.now;
    Date.now = jest.fn(() => originalNow() + 3500);
    
    const uiState2 = deriveUiState(gameState, null, uiState1, 'player1', processedIds);
    
    // Popup should be filtered out (expired)
    expect(uiState2.popups.scorePopups).toHaveLength(0);
    
    Date.now = originalNow;
  });
});
```

### Integration Tests

**Full Game Flow**:
```typescript
describe('Full game with new architecture', () => {
  it('should complete a full round with parallel discards', async () => {
    const gameLoop = new GameLoop(players);
    gameLoop.addAgent('player1', new SimpleAgent());
    gameLoop.addAgent('player2', new SimpleAgent());
    
    // Start game
    const winner = await gameLoop.playGame();
    
    // Verify all events were logged
    const history = gameLoop.cribbageGame.getGameSnapshotHistory();
    expect(history.length).toBeGreaterThan(0);
    
    // Verify waiting states were recorded
    const waitingEvents = history.filter(
      e => e.gameEvent.actionType.startsWith('WAITING_FOR_')
    );
    expect(waitingEvents.length).toBeGreaterThan(0);
  });
});
```

**Reconnection Test**:
```typescript
it('should restore full state including waiting info on reconnect', () => {
  // Simulate game in progress
  const game = new CribbageGame(players);
  game.setWaitingForPlayer('player1', AgentDecisionType.DISCARD);
  
  // Simulate reconnection
  const snapshot = game.getCurrentSnapshot();
  
  // Verify waiting state is in snapshot
  expect(snapshot.gameState.waitingForPlayers).toContainEqual(
    expect.objectContaining({ playerId: 'player1', decisionType: AgentDecisionType.DISCARD })
  );
});
```

### Bot vs Bot Testing

**Recommended Approach**:
1. Create test script that runs multiple games with different agent combinations
2. Verify all games complete successfully
3. Verify all events are logged correctly
4. Verify no information leakage (for redaction)

```typescript
// scripts/test-bot-games.ts
async function runBotGames() {
  const agents = [
    new SimpleAgent(),
    new RandomAgent(),
    // Add more agents
  ];
  
  for (let i = 0; i < 10; i++) {
    const players = agents.map(a => ({ id: a.playerId, name: `Bot${i}` }));
    const gameLoop = new GameLoop(players);
    
    agents.forEach(agent => {
      gameLoop.addAgent(agent.playerId, agent);
    });
    
    const winner = await gameLoop.playGame();
    console.log(`Game ${i} completed. Winner: ${winner}`);
    
    // Verify game history
    const history = gameLoop.cribbageGame.getGameSnapshotHistory();
    console.log(`  Events logged: ${history.length}`);
  }
}
```

### Performance Testing

**Parallel vs Sequential**:
```typescript
it('should be faster with parallel discards', async () => {
  const players = Array.from({ length: 4 }, (_, i) => ({
    id: `player${i}`,
    name: `Player ${i}`,
  }));
  
  // Test sequential (old way)
  const startSequential = Date.now();
  // ... sequential discard implementation
  const sequentialTime = Date.now() - startSequential;
  
  // Test parallel (new way)
  const startParallel = Date.now();
  // ... parallel discard implementation
  const parallelTime = Date.now() - startParallel;
  
  expect(parallelTime).toBeLessThan(sequentialTime);
});
```

---

## Summary

This comprehensive overhaul addresses four major architectural improvements:

1. **Decision Requests Integration**: Makes waiting state part of canonical game state
2. **Parallel Decisions**: Improves UX by allowing simultaneous decisions where possible
3. **Immutable GameState**: Guarantees event logging and prevents state inconsistencies
4. **Redacted State**: Ensures security and fair play by hiding opponents' information

Together, these changes create a robust, maintainable, and secure game state system suitable for production use. The phased implementation approach allows for gradual migration while maintaining backwards compatibility.

**Next Steps**:
1. Review and approve this plan
2. Start with Phase 1 (Foundation)
3. Test each phase thoroughly before moving to the next
4. Update documentation as implementation progresses

