# GameEvent, GameState, and GameSnapshot Types

This document provides a comprehensive overview of the `GameEvent`, `GameState`, and `GameSnapshot` types used throughout the cribbage-core library and the cribbage-with-friends app.

## Overview

These three types work together to represent the complete state of a Cribbage game and track its progression:

- **GameState**: The complete current state of the game at any point in time
- **GameEvent**: A record of a single action/event that occurred in the game
- **GameSnapshot**: A combination of both, representing a complete snapshot of the game state paired with the event that caused it

## GameEvent

### Purpose
`GameEvent` represents a single action or event that occurred during the game. It captures what happened, who did it, when it happened, and what changed as a result.

### Structure

```typescript
export interface GameEvent {
  gameId: string;                    // Unique identifier for the game (uuid)
  snapshotId: number;                // Ties this game event to a unique snapshot/version of the game state
  phase: Phase;                      // Current phase of the game
  actionType: ActionType;            // Last action type taken in the game (includes WAITING_FOR_* types)
  playerId: string | null;           // ID of the player who took the last action (or player being waited on for WAITING_FOR_* events)
  cards: Card[] | null;              // Card(s) involved in the last action, if any
  scoreChange: number;                // Points gained from the last action, if any
  timestamp: Date;                   // Time of the last action
}
```

**Note:** The `actionType` field can now include waiting action types (`WAITING_FOR_DEAL`, `WAITING_FOR_DISCARD`, `WAITING_FOR_PLAY_CARD`, `WAITING_FOR_CONTINUE`) which indicate when the game is waiting for a player decision. These events are recorded when decision requests are made and help track the game's waiting state in the event history.

### Key Characteristics

- **Immutable**: Each `GameEvent` represents a single point in time and never changes
- **Action-focused**: Describes what happened rather than the full game state
- **Linked to snapshot**: The `snapshotId` ties the event to a specific version of the game state
- **Historical record**: Used for replay, debugging, and game history

### Usage in cribbage-core

#### CribbageGame.ts
- Created in `recordGameEvent()` method whenever a game action occurs
- Each event increments the `snapshotId` to create a unique version identifier
- Events are paired with the current `GameState` to create `GameSnapshot` objects
- New `recordWaitingEvent()` method records `WAITING_FOR_*` events and adds players to `waitingForPlayers` array

```80:103:cribbage-core/src/core/CribbageGame.ts
  private recordGameEvent(
    actionType: ActionType,
    playerId: string | null,
    cards: Card[] | null,
    scoreChange: number
  ) {
    this.gameState.snapshotId += 1;
    const gameEvent: GameEvent = {
      gameId: this.gameState.id,
      phase: this.gameState.currentPhase,
      actionType,
      playerId,
      cards,
      scoreChange,
      timestamp: new Date(),
      snapshotId: this.gameState.snapshotId,
    };
    const newGameSnapshot = {
      gameEvent,
      gameState: this.gameState,
    } as GameSnapshot;
    this.gameSnapshotHistory.push(newGameSnapshot);
    this.emit('gameSnapshot', newGameSnapshot);
  }
```

**Waiting State Management:**
- `addWaitingForPlayer()` - Adds a player to the `waitingForPlayers` array
- `removeWaitingForPlayer()` - Removes a player from the waiting list when they respond
- `recordWaitingEvent()` - Records a `WAITING_FOR_*` event and adds to waiting list
- `clearAllWaiting()` - Clears all waiting players (used during phase transitions)

#### server.ts
- Persisted to JSON file (`gameEvents.json`) for historical record keeping
- Emitted to clients via WebSocket as part of `GameSnapshot`
- Tracked per round in `currentRoundGameEvents` array
- The `GameSnapshot` includes `waitingForPlayers` array, making decision requests part of the canonical state

```352:361:cribbage-core/src/server.ts
  gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
    io.emit('gameSnapshot', newSnapshot);
    mostRecentGameSnapshot = newSnapshot;
    sendGameEventToDB(newSnapshot.gameEvent);
    currentRoundGameEvents.push(newSnapshot.gameEvent);
    if (newSnapshot.gameEvent.actionType === ActionType.START_ROUND) {
      currentRoundGameEvents = [];
    }
    io.emit('currentRoundGameEvents', currentRoundGameEvents);
  });
```

**Note:** The `GameSnapshot` sent to clients includes the `waitingForPlayers` array in `gameState`, allowing clients to derive decision requests directly from the game state rather than relying on separate WebSocket events.

#### utils.ts
- Utility functions analyze `GameEvent` arrays to find specific events
- `getMostRecentGameEventForPlayer()` - finds the last event for a specific player
- `isScoreableEvent()` - determines if an event resulted in scoring
- `getMostRecentScoreableEventForPlayer()` - finds scoring events for a player

### Usage in cribbage-with-friends-app

#### gameState.ts (Zustand Store)
- Stored as `recentGameEvent` to track the most recent action
- Stored as `currentRoundGameEvents` array for round-specific event history
- Used to update UI and trigger animations based on game actions

```19:29:cribbage-with-friends-app/state/gameState.ts
type GlobalGameState = {
  gameState: GameState | null;
  recentGameEvent: GameEvent | null;
  waitingOnPlayerInfo: EmittedWaitingForPlayer | null;
  connectedPlayers: PlayerIdAndName[];
  winner: string | null;
  requestedDecisionType: AgentDecisionType | null;
  requestedDecisionData: EmittedDecisionRequest | EmittedContinueRequest | null;
  numberOfCardsToSelect: number | null;
  playAgainVotes: string[];
  currentRoundGameEvents: GameEvent[];
```

#### useGameState.ts Hook
- Received via WebSocket `gameSnapshot` events
- Extracted from `GameSnapshot` and stored in state
- Used to determine UI delays and animations based on `actionType`

```48:66:cribbage-with-friends-app/hooks/useGameState.ts
    const { gameState, gameEvent } = gameEventQueue.current.shift()!;
    setQueueLength(gameEventQueue.current.length);
    console.log(
      '[useGameState] Processing game state and event:',
      JSON.stringify(gameState, null, 2),
      JSON.stringify(gameEvent, null, 2),
    );
    let delay = 500; // Default delay: 1 second
    if (gameEvent.actionType === ActionType.START_PEGGING_ROUND) {
      delay = 1500; // Custom delay for specific action type
    } else if (gameState.currentPhase === Phase.DEALING) {
      delay = 300; // small delay during dealing phase
    } else if (gameState.currentPhase === Phase.COUNTING) {
      delay = 2000; // long delay during counting phase so the player can see the cards
    }

    // Process the event immediately, then delay before processing the next one
    setGameState(gameState);
    setRecentGameEvent(gameEvent);
```

## GameState

### Purpose
`GameState` represents the complete, current state of the game at any point in time. It contains all the information needed to render the game, make decisions, and continue gameplay.

### Structure

```typescript
export interface GameState {
  id: string;                        // Unique identifier for the game
  players: Player[];                 // List of players in the game
  deck: Card[];                      // Remaining cards in the deck
  crib: Card[];                      // Cards in the crib
  turnCard: Card | null;             // The turn card revealed during the pegging phase
  currentPhase: Phase;               // Current phase of the game
  peggingStack: Card[];              // Stack of cards played during the pegging phase
  peggingGoPlayers: string[];        // List of players who have said "Go" during this pegging stack
  peggingLastCardPlayer: string | null; // Player who played the last card during pegging
  playedCards: PlayedCard[];        // List of all cards played during the pegging phase
  peggingTotal: number;              // Total value of the cards played in the current pegging stack
  snapshotId: number;                // Version identifier for this state
  roundNumber: number;               // Current round number
  waitingForPlayers: WaitingForPlayer[]; // List of players we're currently waiting on for decisions (supports parallel decisions)
}

export interface WaitingForPlayer {
  playerId: string;                  // ID of the player we're waiting on
  decisionType: AgentDecisionType;   // Type of decision being requested (PLAY_CARD, DISCARD, CONTINUE, DEAL)
  requestTimestamp: Date;            // When the request was made
}
```

**Key Changes:**
- Added `waitingForPlayers` array to track decision requests in the canonical game state
- Supports parallel decisions (e.g., multiple players discarding simultaneously)
- Each entry includes the player ID, decision type, and timestamp
- This replaces the previous separate `EmittedWaitingForPlayer` events, integrating waiting state into the core game state

### Key Characteristics

- **Complete state**: Contains all information needed to represent the game
- **Mutable**: Updated as the game progresses
- **Versioned**: `snapshotId` increments with each change
- **Player-specific data**: Each player's hand, score, and status are included
- **Decision requests integrated**: `waitingForPlayers` array tracks who the game is waiting on for decisions
- **Supports parallel decisions**: Multiple players can be in the waiting list simultaneously (e.g., parallel discarding)

### Usage in cribbage-core

#### CribbageGame.ts
- Maintained as `private gameState: GameState`
- Updated through game methods (deal, discard, play card, etc.)
- Used by agents to make decisions via `GameAgent` interface methods
- Returned via `getGameState()` public method

```20:52:cribbage-core/src/core/CribbageGame.ts
export class CribbageGame extends EventEmitter {
  private gameState: GameState
  // private gameEventRecords: GameEvent[]; // Log of all game actions
  private gameSnapshotHistory: GameSnapshot[]; // Log of all game state and events

  constructor(playersInfo: PlayerIdAndName[], startingScore = 0) {
    super();
    const deck = this.generateDeck();
    const players = playersInfo.map((info, index) => ({
      id: info.id,
      name: info.name,
      hand: [],
      peggingHand: [],
      playedCards: [],
      score: startingScore,
      isDealer: index === 0,
    })) as Player[];
    const id = `game-${Date.now()}-${playersInfo.map(p => p.id).join('-')}`;
    this.gameState = {
      id: id,
      players,
      deck,
      currentPhase: Phase.DEALING,
      crib: [],
      turnCard: null,
      peggingStack: [],
      peggingGoPlayers: [],
      peggingLastCardPlayer: null,
      playedCards: [],
      peggingTotal: 0,
      roundNumber: 0,
      snapshotId: 0,
    };

    // this.gameEventRecords = [];
    this.gameSnapshotHistory = [];
  }
```

#### GameAgent Interface
- Agents receive `GameState` to make decisions
- `makeMove(game: GameState, playerId: string)` - decides which card to play
- `discard(game: GameState, playerId: string, numberOfCardsToDiscard: number)` - decides which cards to discard

#### utils.ts
- Validation functions use `GameState` to check if moves are valid
- `isValidDiscard()` - checks if discard is valid
- `isValidPeggingPlay()` - checks if a pegging play is valid
- `playerHasValidPlay()` - checks if player has any valid plays

### Usage in cribbage-with-friends-app

#### gameState.ts (Zustand Store)
- Primary state object stored as `gameState: GameState | null`
- Used to derive UI state and card positions
- Updated whenever a new `GameSnapshot` is received

```74:86:cribbage-with-friends-app/state/gameState.ts
  setGameState: (gameState) => {
    set({ gameState });
    // const { updateCardStateFromGameState } = useCardStateStore.getState();
    // if (gameState) {
    //   // update the card state store with the new game state
    //   updateCardStateFromGameState(gameState);
    // }
    // call setPlayerScoresFromGameState with the new game state
    // const { setPlayerScoresFromGameState } = useGameStateStore.getState();
    // if (gameState) {
    //   setPlayerScoresFromGameState(gameState);
    // }
  },
```

#### useCardStateStore
- `updateCardStateFromGameState()` extracts card positions from `GameState`
- Maps game state to UI-specific card states (hands, crib, play pile, etc.)

#### useGameState.ts Hook
- Receives `GameState` as part of `GameSnapshot` via WebSocket
- Processes it through a queue with delays for animations
- Updates both `gameState` and `cardState` stores

```65:68:cribbage-with-friends-app/hooks/useGameState.ts
    // Process the event immediately, then delay before processing the next one
    setGameState(gameState);
    setRecentGameEvent(gameEvent);
    updateCardStateFromGameState(gameState);
    setPlayerScoresFromGameState(gameState);
```

## GameSnapshot

### Purpose
`GameSnapshot` combines a `GameState` and `GameEvent` together, representing a complete snapshot of the game at a specific moment in time along with the event that caused that state.

### Structure

```typescript
export interface GameSnapshot {
  gameState: GameState;  // Current state of the game (includes waitingForPlayers array)
  gameEvent: GameEvent;   // Last event that occurred in the game
}
```

**Note:** Previously named `GameStateAndEvent`, this type was renamed to `GameSnapshot` for clarity. The `gameState` field includes the `waitingForPlayers` array, making decision requests part of the canonical game state rather than separate events.

### Key Characteristics

- **Atomic unit**: Represents both the state and the event that created it
- **Versioned**: Both `gameState.snapshotId` and `gameEvent.snapshotId` match
- **Complete picture**: Provides everything needed to understand what happened and what the game looks like now
- **Transport mechanism**: Primary way game updates are sent from server to clients
- **Includes waiting state**: The `gameState.waitingForPlayers` array is included, making decision requests part of the canonical state

### Usage in cribbage-core

#### CribbageGame.ts
- Created in `recordGameEvent()` whenever an action occurs
- Stored in `gameSnapshotHistory` array for complete game history
- Emitted via EventEmitter as `'gameSnapshot'` event
- Includes `waitingForPlayers` array in `gameState` for decision request tracking

```97:102:cribbage-core/src/core/CribbageGame.ts
    const newGameSnapshot = {
      gameEvent,
      gameState: this.gameState,
    } as GameSnapshot;
    this.gameSnapshotHistory.push(newGameSnapshot);
    this.emit('gameSnapshot', newGameSnapshot);
  }
```

**History Access:**
- Use `getGameSnapshotHistory()` to retrieve the complete game history
- Each snapshot includes both the game state and the event that created it
- The history includes `WAITING_FOR_*` events, providing a complete record of when decisions were requested

#### GameLoop.ts
- Listens for `gameSnapshot` events from `CribbageGame`
- Re-emits them to the server layer
- Uses `requestDecision()` helper to record waiting events in `GameState` and `GameEvent` history
- Integrates decision requests into the canonical game state via `recordWaitingEvent()`

```36:38:cribbage-core/src/gameplay/GameLoop.ts
    this.cribbageGame.on('gameSnapshot', (newGameSnapshot: GameSnapshot) => {
      this.emit('gameSnapshot', newGameSnapshot);
    });
```

**Decision Request Integration:**
- `requestDecision()` - Helper method that calls `recordWaitingEvent()` to add waiting state to `GameState.waitingForPlayers` and record a `WAITING_FOR_*` event
- Used throughout `GameLoop` when requesting decisions from agents (deal, discard, play card, continue)
- Ensures decision requests are part of the canonical game state and event history

#### server.ts
- Receives `GameSnapshot` from `GameLoop`
- Broadcasts to all connected clients via WebSocket
- Stores the most recent snapshot for new client connections
- Extracts `gameEvent` for persistence
- The `GameSnapshot` includes `waitingForPlayers` array, making decision requests part of the canonical state

```352:361:cribbage-core/src/server.ts
  gameLoop.on('gameSnapshot', (newSnapshot: GameSnapshot) => {
    io.emit('gameSnapshot', newSnapshot);
    mostRecentGameSnapshot = newSnapshot;
    sendGameEventToDB(newSnapshot.gameEvent);
    currentRoundGameEvents.push(newSnapshot.gameEvent);
    if (newSnapshot.gameEvent.actionType === ActionType.START_ROUND) {
      currentRoundGameEvents = [];
    }
    io.emit('currentRoundGameEvents', currentRoundGameEvents);
  });
```

```380:392:cribbage-core/src/server.ts
function sendMostRecentGameData(socket: Socket): void {
  console.log('Sending most recent game data to client');
  
  // Send GameSnapshot (contains waiting state in GameState.waitingForPlayers)
  if (mostRecentGameSnapshot) {
    socket.emit('gameSnapshot', mostRecentGameSnapshot);
  } else {
    console.log('no mostRecentGameSnapshot to send...');
  }
  
  socket.emit('currentRoundGameEvents', currentRoundGameEvents);
  socket.emit('playAgainVotes', Array.from(playAgainVotes));
}
```

**Note:** The `GameSnapshot` sent to clients includes the `waitingForPlayers` array in `gameState`, allowing clients to derive decision requests directly from the game state. The separate `waitingForPlayer` WebSocket event is deprecated but still supported for backwards compatibility.

### Usage in cribbage-with-friends-app

#### useGameState.ts Hook
- Received via WebSocket `'gameSnapshot'` event
- Queued in `gameEventQueue` for sequential processing
- Split into `gameState` and `gameEvent` for separate handling

```124:128:cribbage-with-friends-app/hooks/useGameState.ts
    socket.on('gameSnapshot', (newGameSnapshot: GameSnapshot) => {
      gameEventQueue.current.push(newGameSnapshot);
      setQueueLength(gameEventQueue.current.length);
      if (!isProcessing && !manualGameEventProcessing) processQueue(); // Start processing if not already
    });
```

```48:48:cribbage-with-friends-app/hooks/useGameState.ts
    const { gameState, gameEvent } = gameEventQueue.current.shift()!;
```

## How They Differ

### GameEvent vs GameState

| Aspect | GameEvent | GameState |
|--------|-----------|-----------|
| **Purpose** | Records what happened | Represents current state |
| **Scope** | Single action/change | Complete game state |
| **Size** | Small, focused | Large, comprehensive |
| **Mutability** | Immutable (historical record) | Mutable (updated during gameplay) |
| **Contains** | Action details (who, what, when, score change) | All cards, players, scores, phase, waiting state, etc. |
| **Use Case** | History, replay, debugging | Decision making, rendering |
| **Decision Requests** | Includes `WAITING_FOR_*` action types | Includes `waitingForPlayers` array |

### GameSnapshot vs Individual Types

| Aspect | GameSnapshot | GameEvent + GameState separately |
|--------|--------------|----------------------------------|
| **Transport** | Single atomic unit | Two separate pieces |
| **Synchronization** | Guaranteed to match (same snapshotId) | Must be manually synchronized |
| **Network** | One WebSocket message | Two separate messages |
| **Use Case** | Real-time game updates | Historical analysis, separate concerns |

### Key Differences Summary

1. **Granularity**: `GameEvent` is fine-grained (one action), `GameState` is coarse-grained (everything), `GameSnapshot` combines both
2. **Temporal**: `GameEvent` is historical, `GameState` is current, `GameSnapshot` links them
3. **Usage**: `GameEvent` for logging/replay, `GameState` for gameplay logic, `GameSnapshot` for transport
4. **Versioning**: All three share the same `snapshotId` to maintain consistency

## Data Flow

### Server-Side Flow

```
CribbageGame.recordGameEvent()
  ↓
Creates GameEvent
  ↓
Creates GameSnapshot { gameState, gameEvent }
  ↓
Emits 'gameSnapshot' event
  ↓
GameLoop receives and re-emits
  ↓
server.ts receives
  ↓
  ├─→ Broadcasts to all clients via WebSocket
  ├─→ Stores in mostRecentGameSnapshot
  └─→ Persists gameEvent to JSON file
```

### Client-Side Flow

```
WebSocket receives 'gameSnapshot'
  ↓
Queued in gameEventQueue
  ↓
Processed sequentially with delays
  ↓
Split into gameState and gameEvent
  ↓
  ├─→ gameState → useGameStateStore
  ├─→ gameEvent → useGameStateStore (recentGameEvent)
  └─→ gameState → useCardStateStore (for UI updates)
```

## Best Practices

1. **Always use GameSnapshot for transport**: When sending updates from server to client, use `GameSnapshot` to ensure state and event stay synchronized
2. **Store GameEvent separately for history**: For replay and debugging, maintain arrays of `GameEvent` objects
3. **Use GameState for decisions**: Agents and game logic should work with `GameState` to make decisions
4. **Match snapshotIds**: Always ensure `gameState.snapshotId === gameEvent.snapshotId` in a `GameSnapshot`
5. **Process sequentially**: Clients should process `GameSnapshot` objects in order to maintain correct game state
6. **Derive decision requests from GameState**: Use `gameState.waitingForPlayers` array to determine who needs to make decisions, rather than relying on separate WebSocket events
7. **Check waiting state**: Before requesting a decision, check if the player is already in `waitingForPlayers` to avoid duplicates
8. **Clear waiting state**: Remove players from `waitingForPlayers` when they respond or when phases change

## Recent Changes

### Type Renaming (from commit fb5f1a2)
- `GameStateAndEvent` → `GameSnapshot` (renamed for clarity)
- `gameStateSnapshotId` → `snapshotId` in `GameEvent` interface
- Event name: `'gameStateAndEvent'` → `'gameSnapshot'`
- Method: `getGameStateAndEventHistory()` → `getGameSnapshotHistory()`

### Decision Request Integration
- Added `WaitingForPlayer` interface
- Added `waitingForPlayers: WaitingForPlayer[]` to `GameState`
- Added `WAITING_FOR_*` action types to `ActionType` enum
- Added methods: `addWaitingForPlayer()`, `removeWaitingForPlayer()`, `recordWaitingEvent()`, `clearAllWaiting()`
- Decision requests are now part of the canonical game state and event history

### Card Type Updates
- `Card` type includes `'UNKNOWN'` value for redacted cards (opponents' cards that shouldn't be revealed)

