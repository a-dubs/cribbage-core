awesome thank you for the feedback. i need to get working on the ui state markdown flow / design spec. can you give me a skeleton? let me give you what my game state and game event (now called game snapshot) types are and also what the relevant dependent types like game phase are so you can start chalking up a solid initial draft / outline for me. fill out the full structure and then leave stuff blank where you are unsure. oh also the other thing i forgot to mention is that i currently have a separate notion of like decision requests and stuff but i want to bake that into the GameState/GameEvent system so that waiting for player decisions is part of the canonical game state rather than being tracked separately.

----

see cribbage-core/docs/GameEvent_GameState_GameSnapshot.md for context around my current game state and game event types and how they are used in the code for context.

---

## The Problem: Decision Requests as Second-Class Citizens

Right now, my game has a fundamental architectural issue where decision requests (who we're waiting on, what decision they need to make) are completely separate from the GameState and GameEvent system. This creates several problems:

### Current Architecture Issues

1. **Separate WebSocket Events**: Decision requests are sent via separate events (`waitingForPlayer`, `requestMakeMove`, `discardRequest`, `continueRequest`) rather than being part of `GameSnapshot`

2. **Separate State Storage**: 
   - Server stores `mostRecentWaitingForPlayer` separately from `mostRecentGameSnapshot`
   - Client stores `waitingOnPlayerInfo`, `requestedDecisionType`, and `requestedDecisionData` separately from `gameState` and `recentGameEvent`

3. **Not Part of Game History**: Decision requests aren't recorded in the game event history, so you can't replay or debug "who was waiting for what decision" at any point in time

4. **Reconnection Problems**: When a client reconnects, they get `mostRecentWaitingForPlayer` sent separately via `sendMostRecentGameData()`, but this isn't part of the canonical game state

5. **Non-Deterministic UI**: The UI can't be fully derived from `GameState` + `GameEvent` alone - it also needs the separate decision request state, which breaks the goal of having a deterministic UI flow

### What I Want

I want to integrate decision requests/waiting state directly into the `GameState` and/or `GameEvent` system so that:

- **"Who we're waiting on"** is part of the canonical game state
- **"What decision they need to make"** is part of the game state
- Decision requests become first-class events in the game history
- The UI can be deterministically derived from `GameState` + `GameEvent` without needing separate decision request state
- When a client reconnects, they can reconstruct the full game state (including who we're waiting on) from the `GameSnapshot` alone

### Questions

1. **Should waiting state go in `GameState` or `GameEvent`?** 
   - Option A: Add `waitingForPlayer: { playerId: string, decisionType: AgentDecisionType } | null` to `GameState`
   - Option B: Create new `ActionType` values like `WAITING_FOR_DISCARD`, `WAITING_FOR_PLAY_CARD`, etc. and include them in `GameEvent`
   - Option C: Both - `GameState` tracks current waiting state, `GameEvent` records when waiting state changes

2. **How should decision request data be structured?**
   - Currently we have `EmittedMakeMoveRequest`, `EmittedDiscardRequest`, `EmittedContinueRequest` with different fields
   - Should these be part of `GameState.waitingForPlayer`? Or should `GameState` just track "who" and "what type", and the detailed request data be derived from `GameState`?

3. **What about the request/response cycle?**
   - Currently: Server emits request → Client responds → Server processes response
   - If waiting state is in `GameState`, how do we handle the transition from "waiting" to "received response" to "action taken"?
   - Should there be events like `DECISION_REQUESTED`, `DECISION_RECEIVED`, `DECISION_PROCESSED`?

4. **Migration strategy?**
   - How do I migrate from the current separate system to an integrated one without breaking existing clients?
   - Should I add fields to `GameState`/`GameEvent` while keeping the old events for backwards compatibility?

Can you help me think through the best way to architect this integration? I want to make sure waiting state is properly captured in the game state/event system so I can build a deterministic UI flow spec.

---

## Comprehensive Answer: Integrating Decision Requests into GameState/GameEvent System

Based on my analysis of your codebase, here's a complete architectural plan to integrate decision requests into your canonical game state system.

### Recommended Approach: Option C (Both GameState and GameEvent)

**Core Principle**: `GameState` represents the current state (including who we're waiting on), while `GameEvent` records state transitions (including when waiting starts/stops).

### 1. Type System Changes

#### Add to `GameState`:

```typescript
export interface GameState {
  // ... existing fields ...
  waitingForPlayer: {
    playerId: string;
    decisionType: AgentDecisionType;
    requestTimestamp: Date; // When the request was made
  } | null;
}
```

**Why**: This makes "who we're waiting on" part of the canonical state. Any client receiving a `GameSnapshot` immediately knows the waiting state without separate events.

#### Add to `ActionType` enum:

```typescript
export enum ActionType {
  // ... existing actions ...
  
  // Decision request lifecycle events
  WAITING_FOR_DEAL = 'WAITING_FOR_DEAL',
  WAITING_FOR_DISCARD = 'WAITING_FOR_DISCARD',
  WAITING_FOR_PLAY_CARD = 'WAITING_FOR_PLAY_CARD',
  WAITING_FOR_CONTINUE = 'WAITING_FOR_CONTINUE',
  
  // Note: When a decision is made, the existing action types (DEAL, DISCARD, PLAY_CARD)
  // already serve as the "decision received" event, so no new types needed there
}
```

**Why**: This records when waiting state changes in the game history, enabling replay and debugging.

#### Optional: Add to `GameEvent` for richer context:

```typescript
export interface GameEvent {
  // ... existing fields ...
  
  // Only populated when actionType is a WAITING_FOR_* action
  waitingFor?: {
    playerId: string;
    decisionType: AgentDecisionType;
  } | null;
}
```

**Why**: Makes it explicit in the event what waiting state was set, even though it's also in the GameState.

### 2. Decision Request Data Structure

**Key Insight**: The detailed request data (`EmittedMakeMoveRequest`, `EmittedDiscardRequest`, etc.) can be **derived from `GameState`** rather than stored.

- For `PLAY_CARD`: `peggingHand`, `peggingStack`, `playedCards`, `peggingTotal` are all in `GameState`
- For `DISCARD`: `hand` is in `GameState.players[].hand`, `numberOfCardsToDiscard` is deterministic based on phase
- For `CONTINUE`: Only needs `description`, which can be derived from phase/context

**Recommendation**: Don't store detailed request data in `GameState`. Instead:
- `GameState.waitingForPlayer` only tracks `playerId` and `decisionType`
- Clients derive the detailed request UI from `GameState` + `decisionType`
- This keeps `GameState` lean and ensures request data is always consistent with actual state

### 3. Request/Response Cycle Handling

**Flow**:
1. **Start Waiting**: `GameLoop` sets `GameState.waitingForPlayer` and records `WAITING_FOR_*` event
2. **Emit Request**: `WebSocketAgent` emits specific request (`requestMakeMove`, etc.) to client (for UI purposes)
3. **Receive Response**: Client responds via WebSocket
4. **Process Decision**: `GameLoop` processes response, clears `waitingForPlayer`, records action event (`DEAL`, `DISCARD`, `PLAY_CARD`)

**Implementation Pattern**:

```typescript
// In GameLoop.ts
private async requestDecision(
  playerId: string,
  decisionType: AgentDecisionType
): Promise<void> {
  // Update GameState
  this.cribbageGame.getGameState().waitingForPlayer = {
    playerId,
    decisionType,
    requestTimestamp: new Date(),
  };
  
  // Record event
  this.cribbageGame.recordGameEvent(
    this.getWaitingActionType(decisionType),
    playerId,
    null,
    0
  );
  
  // Emit to all clients (so they know who we're waiting on)
  this.emit('gameSnapshot', this.cribbageGame.getCurrentSnapshot());
  
  // Emit specific request to the player (for UI)
  this.emit('waitingForPlayer', { playerId, waitingFor: decisionType });
}

private getWaitingActionType(decisionType: AgentDecisionType): ActionType {
  switch (decisionType) {
    case AgentDecisionType.DEAL:
      return ActionType.WAITING_FOR_DEAL;
    case AgentDecisionType.DISCARD:
      return ActionType.WAITING_FOR_DISCARD;
    case AgentDecisionType.PLAY_CARD:
      return ActionType.WAITING_FOR_PLAY_CARD;
    case AgentDecisionType.CONTINUE:
      return ActionType.WAITING_FOR_CONTINUE;
  }
}
```

**When Decision is Made**:

```typescript
// In CribbageGame methods (deal, discardToCrib, playCard, etc.)
// Clear waiting state BEFORE recording the action event
this.gameState.waitingForPlayer = null;
this.recordGameEvent(ActionType.DEAL, playerId, cards, scoreChange);
```

### 4. Migration Strategy

**Phase 1: Additive Changes (Backwards Compatible)**

1. Add `waitingForPlayer` field to `GameState` (defaults to `null` for existing code)
2. Add new `WAITING_FOR_*` action types to `ActionType` enum
3. Keep existing `waitingForPlayer` WebSocket event for now (dual-write)
4. Update `CribbageGame.recordGameEvent()` to set `waitingForPlayer` when appropriate
5. Update `GameLoop` to use new pattern but still emit old events

**Phase 2: Update Clients**

1. Update client to read `waitingForPlayer` from `GameState` instead of separate event
2. Derive request UI from `GameState` + `decisionType` instead of `requestedDecisionData`
3. Keep listening to old events as fallback during transition

**Phase 3: Remove Legacy**

1. Remove `mostRecentWaitingForPlayer` from server
2. Remove `waitingOnPlayerInfo`, `requestedDecisionType`, `requestedDecisionData` from client state
3. Remove old WebSocket events (`waitingForPlayer`, `requestMakeMove`, `discardRequest`, `continueRequest`)
4. Remove `EmittedWaitingForPlayer`, `EmittedMakeMoveRequest`, etc. types (or keep minimal versions for WebSocket only)

### 5. Implementation Details

#### Update `CribbageGame.ts`:

```typescript
// Add helper method
public setWaitingForPlayer(
  playerId: string | null,
  decisionType: AgentDecisionType | null
): void {
  if (playerId && decisionType) {
    this.gameState.waitingForPlayer = {
      playerId,
      decisionType,
      requestTimestamp: new Date(),
    };
  } else {
    this.gameState.waitingForPlayer = null;
  }
}

// Update recordGameEvent to handle waiting events
private recordGameEvent(
  actionType: ActionType,
  playerId: string | null,
  cards: Card[] | null,
  scoreChange: number
) {
  // Clear waiting state when an action is taken (not when waiting starts)
  if (!actionType.startsWith('WAITING_FOR_')) {
    this.gameState.waitingForPlayer = null;
  }
  
  // ... rest of existing code ...
}
```

#### Update `GameLoop.ts`:

```typescript
// Replace all emit('waitingForPlayer') calls with:
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
  // GameSnapshot is automatically emitted by recordGameEvent
}

// Update doRound, doPegging to use requestDecision
private async doRound(): Promise<string | null> {
  this.cribbageGame.startRound();
  
  const dealer = this.cribbageGame.getPlayer(this.cribbageGame.getDealerId());
  await this.requestDecision(dealer.id, AgentDecisionType.DEAL);
  await this.sendContinue(dealer.id, 'Deal the cards');
  this.cribbageGame.deal(); // This clears waitingForPlayer
  
  // ... rest of method ...
}
```

#### Update `server.ts`:

```typescript
// Remove mostRecentWaitingForPlayer
// Remove gameLoop.on('waitingForPlayer') handler
// sendMostRecentGameData() no longer needs to send waitingForPlayer separately

function sendMostRecentGameData(socket: Socket): void {
  if (mostRecentGameSnapshot) {
    socket.emit('gameSnapshot', mostRecentGameSnapshot);
    // waitingForPlayer is now IN the GameSnapshot, no separate event needed!
  }
  // ... rest ...
}
```

#### Update Client (`useGameState.ts`):

```typescript
// Remove waitingForPlayer socket listener
// Remove requestedDecisionType, requestedDecisionData from state
// Derive from GameState instead:

const deriveDecisionRequest = (
  gameState: GameState | null,
  playerId: string | null
): EmittedDecisionRequest | null => {
  if (!gameState?.waitingForPlayer || !playerId) return null;
  
  const { playerId: waitingPlayerId, decisionType } = gameState.waitingForPlayer;
  if (waitingPlayerId !== playerId) return null; // Not waiting for this player
  
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return null;
  
  switch (decisionType) {
    case AgentDecisionType.PLAY_CARD:
      return {
        requestType: AgentDecisionType.PLAY_CARD,
        playerId,
        peggingHand: player.peggingHand,
        peggingStack: gameState.peggingStack,
        playedCards: gameState.playedCards,
        peggingTotal: gameState.peggingTotal,
      };
    case AgentDecisionType.DISCARD:
      const numberOfCardsToDiscard = gameState.players.length === 2 ? 2 : 1;
      return {
        requestType: AgentDecisionType.DISCARD,
        playerId,
        hand: player.hand,
        numberOfCardsToDiscard,
      };
    case AgentDecisionType.CONTINUE:
      // Description can be derived from phase/context
      const description = getContinueDescription(gameState);
      return {
        requestType: AgentDecisionType.CONTINUE,
        playerId,
        description,
      };
    default:
      return null;
  }
};
```

### 6. Benefits of This Approach

✅ **Deterministic UI**: UI can be fully derived from `GameState` + `GameEvent`  
✅ **Reconnection Safe**: Reconnecting clients get full state including waiting info  
✅ **Debuggable**: Waiting state changes are in game history  
✅ **Type Safe**: Waiting state is typed and validated  
✅ **Backwards Compatible**: Can migrate gradually  
✅ **Lean State**: Doesn't duplicate data that can be derived  

### 7. Edge Cases to Handle

- **Multiple simultaneous requests**: Not possible in your game flow (one decision at a time)
- **Request timeout**: Could add `requestTimeout` to `waitingForPlayer` if needed
- **Invalid responses**: Already handled by validation in `WebSocketAgent`
- **Bot players**: Bots don't need WebSocket requests, but `GameState.waitingForPlayer` still tracks them

### 8. Testing Strategy

1. **Unit Tests**: Test `setWaitingForPlayer()` and `recordGameEvent()` with waiting actions
2. **Integration Tests**: Test full decision cycle (request → response → action)
3. **Reconnection Tests**: Verify reconnecting client gets correct waiting state
4. **UI Tests**: Verify UI correctly derives request UI from `GameState`

This architecture makes waiting state a first-class citizen in your game state system while maintaining backwards compatibility and enabling deterministic UI derivation.

