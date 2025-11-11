### Cribbage Core: Decision Requests Separation + Cut Deck Agent Action (No-Compat Rewrite)

This document proposes and specifies a lean redesign that removes all “waiting” concerns from `GameState` and introduces first-class decision requests owned by the `GameLoop`. It also adds a new agent action for cutting the deck. This plan intentionally removes backwards compatibility to simplify the implementation and usage in both the core and the app.


### Objectives

- Keep `GameState` pure and deterministic. No embedded “waiting”/ephemera.
- Make decision requests first-class, owned and coordinated by `GameLoop`.
- Transport decision requests alongside snapshots to all clients.
- Support parallel decisions (e.g., simultaneous DISCARD or CONTINUE prompts).
- Add a new agent action: “cut deck,” returning an index up to a provided maximum.
- Remove previous “waiting” hacks (`waitingForPlayers`, WAITING_FOR_* events).


### Summary of What Changes

- Remove `waitingForPlayers: WaitingForPlayer[]` from `GameState` and delete related code paths in `CribbageGame` and `GameLoop`.
- Eliminate WAITING_FOR_* `ActionType`s and their event emissions.
- Introduce transport frame sent to clients that contains:
  - `snapshot: GameSnapshot` (unchanged pair `{ gameState, gameEvent }`)
  - `decisionRequests: DecisionRequest[]` (new; full-replace list)
- Add a new “cut deck” agent action with signature `cutDeck(game, playerId, maxIndex): Promise<number>`.
- Move all request creation/clearing and response handling to `GameLoop`.
- `CribbageGame` stays pure: apply events, compute next state. Optionally exposes a pure derivation helper to suggest which decisions are required (see below).


### Type Changes (cribbage-core/src/types/index.ts)

- Remove from `GameState`:
  - `waitingForPlayers: WaitingForPlayer[]`
- Remove types:
  - `WaitingForPlayer`
- Remove WAITING_* entries from `ActionType`:
  - `WAITING_FOR_DEAL`, `WAITING_FOR_DISCARD`, `WAITING_FOR_PLAY_CARD`, `WAITING_FOR_CONTINUE`
  - Keep domain actions like `DEAL`, `DISCARD`, `PLAY_CARD`, `CUT`, `TURN_CARD`, etc.
- Extend `AgentDecisionType` with a cut action:
  - Add `CUT_DECK = 'CUT_DECK'`
- Add transport-only decision request types (ephemeral):

```ts
// Transport frame broadcast to clients
export interface ServerFrame {
  snapshot: GameSnapshot;
  decisionRequests: DecisionRequest[]; // full-replace on each broadcast
}

export type DecisionType =
  | 'DEAL'        // optional, if using explicit deal decision
  | 'DISCARD'
  | 'PLAY_CARD'
  | 'CONTINUE'
  | 'CUT_DECK';   // new

export interface DecisionRequest {
  requestId: string;       // unique id for idempotency
  playerId: string;
  type: DecisionType;
  payload?: unknown;       // decision-specific data (e.g., legal moves, max index, counts)
  minSelections?: number;
  maxSelections?: number;
}

export interface DecisionResponse {
  requestId: string;
  playerId: string;
  type: DecisionType;
  payload?: unknown; // e.g., selected cards or selected index
}
```

- Extend `GameAgent` interface with “cut deck”:

```ts
export interface GameAgent {
  playerId: string;
  human: boolean;

  makeMove(game: GameState, playerId: string): Promise<Card | null>;

  discard(
    game: GameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]>;

  // Optional continue gate
  waitForContinue?(
    game: GameState,
    playerId: string,
    continueDescription: string
  ): Promise<void>;

  // New: cut deck returns selected index in range [0, maxIndex]
  cutDeck?(
    game: GameState,
    playerId: string,
    maxIndex: number
  ): Promise<number>;
}
```


### Engine Boundaries

- `CribbageGame` (pure domain engine):
  - Applies domain actions/events (deal, discard, cut, turn card, play card, score, etc.) and updates `GameState`.
  - No decision/waiting state and no WAITING_* events.
  - Optional pure derivation helper (non-transport, non-stateful) that returns a list of “required decisions” for the current state to guide `GameLoop` orchestration:

```ts
// Optional helper; does not include requestIds or transport details
export interface RequiredDecisionSpec {
  playerId: string;
  type: DecisionType;
  // domain hints for payload, counts, etc.
  payload?: unknown;
  minSelections?: number;
  maxSelections?: number;
}

// Suggested: pure derivation (no side effects)
deriveRequiredDecisions(state: Readonly<GameState>): RequiredDecisionSpec[];
```

- `GameLoop` (orchestrator):
  - Sole owner of `decisionRequests` state.
  - After each applied event (which yields a new `GameSnapshot`), compute the set of required decisions (either hard-coded by flow or via the optional derivation helper).
  - Reconcile with its current outstanding requests:
    - Add requests with generated `requestId`s for new needs
    - Remove requests that are satisfied or invalidated
  - Broadcast a `ServerFrame` on every change with a full-replace `decisionRequests` array.
  - Accept and validate `DecisionResponse`s:
    - Must match outstanding `requestId` and `playerId`
    - Apply resulting domain action(s) via `CribbageGame` (e.g., `playCard`, `discardToCrib`, `cutDeck`), then update requests and broadcast a new frame.

- `server.ts` (transport only):
  - For each player, send redacted `snapshot` as today.
  - Also include the full `decisionRequests` array (not redacted; each request is already scoped to a specific `playerId` and does not leak hidden cards).
  - Route incoming `DecisionResponse`s to `GameLoop`.


### Game Flow Updates (high-level)

- Round start:
  - `CribbageGame.startRound()` → `ActionType.START_ROUND` event.
  - `GameLoop` issues a DEAL or CONTINUE request to the dealer if you want explicit “deal” confirmation; otherwise proceed to `deal()` directly.

- Discard phase:
  - For each player, add a `DecisionRequest` `{ type: 'DISCARD', minSelections: 2, maxSelections: 2 }` (2-player, adjust for >2).
  - On response, call `cribbageGame.discardToCrib(playerId, selectedCards)`.
  - When all discards received, `cribbageGame.completeCribPhase()`.

- Cutting phase (new agent action):
  - Identify player behind dealer.
  - Create a `DecisionRequest`:
    - `type: 'CUT_DECK'`
    - `payload: { maxIndex: deck.length - 1 }`
  - For agents:
    - Call `agent.cutDeck(game, playerId, maxIndex)`; response returns a number `cutIndex` in `[0, maxIndex]`.
    - Then `cribbageGame.cutDeck(playerId, cutIndex)` (emits `ActionType.CUT` and `ActionType.TURN_CARD`, possibly `SCORE_HEELS`).

- Pegging phase:
  - Maintain one outstanding `PLAY_CARD` request at a time for the current player (or allow “Go” via null selection).
  - On response, `cribbageGame.playCard(playerId, selectedCardOrNull)`; advance turn/round as needed.

- Counting phase:
  - Optionally gate each step with `CONTINUE` requests, or proceed automatically and only gate the “Ready for next round” with per-player `CONTINUE` requests.

- Ready for next round:
  - Keep `GameState` frozen; update only `decisionRequests` until all players respond.
  - Once all `CONTINUE` responses arrive, start next round.


### Breaking Removals

- Remove from `CribbageGame`:
  - `addWaitingForPlayer`, `recordWaitingEvent`, `removeWaitingForPlayer`, `clearAllWaiting`.
  - Any logic populating `waitingForPlayers`.
  - Emission of WAITING_* events.

- Remove from `ActionType`:
  - All WAITING_* entries.

- Remove from `GameLoop`:
  - Any helper that records WAITING_* events or mutates `waitingForPlayers` in `GameState`.


### Minimal Interfaces for Decision Handling (GameLoop)

```ts
class GameLoop {
  // internal outstanding requests
  private decisionRequests: DecisionRequest[] = [];

  // Called after every state change to emit to server/app
  private broadcastFrame(snapshot: GameSnapshot): void {
    const frame: ServerFrame = { snapshot, decisionRequests: this.decisionRequests };
    this.emit('serverFrame', frame);
  }

  // Validate + apply responses
  public submitDecisionResponse(response: DecisionResponse): void {
    // 1) find matching request
    // 2) validate playerId, type
    // 3) apply via CribbageGame (e.g., playCard/discard/cutDeck)
    // 4) remove satisfied request(s), possibly add next request(s)
    // 5) emit new frame
  }
}
```


### Agent API Changes

- Add `cutDeck(game, playerId, maxIndex): Promise<number>` to `GameAgent`.
- WebSocketAgent must implement `cutDeck` and reply with a valid index.
- AI Agents:
  - Heuristic/exhaustive/random: implement `cutDeck`; a minimal implementation could pick a midpoint or random index in `[0, maxIndex]`.


### Transport and App Integration

- Replace `gameSnapshot`-only broadcasts with a `serverFrame` broadcast:
  - Keep redacted `snapshot` per player (as today).
  - Include the same `decisionRequests` array for all players.
- App consumes `decisionRequests` directly:
  - For “Ready for next round” and similar gates, no `GameState` changes are needed. The app only updates prompts based on `decisionRequests`.


### Implementation Steps (ordered)

1) Types
   - Remove `waitingForPlayers` from `GameState` and related types.
   - Remove WAITING_* from `ActionType`.
   - Add `DecisionType`, `DecisionRequest`, `DecisionResponse`, and `ServerFrame`.
   - Add `cutDeck` to `GameAgent`.

2) CribbageGame
   - Delete waiting-related methods and references.
   - Leave domain operations intact (`deal`, `discardToCrib`, `cutDeck`, `playCard`, `score*`, etc.).
   - Optionally add pure `deriveRequiredDecisions(state)` helper.

3) GameLoop
   - Introduce `decisionRequests: DecisionRequest[]` as internal state.
   - On each phase/step, create/clear the appropriate `DecisionRequest`s.
   - Implement `submitDecisionResponse` to validate and apply to `CribbageGame`.
   - Replace any prior WAITING_* recording with request creation only.
   - Add `serverFrame` emission with `{ snapshot, decisionRequests }` after any change.
   - Update flow to use `CUT_DECK` decision instead of random cut:
     - Create request with `{ payload: { maxIndex: deck.length - 1 } }`
     - On response, call `cribbageGame.cutDeck(playerId, cutIndex)`

4) server.ts
   - Listen for `serverFrame` events from `GameLoop`.
   - For each player, send redacted `snapshot` plus the full `decisionRequests` array.
   - Add a socket handler to receive `DecisionResponse`s and forward to `GameLoop.submitDecisionResponse`.

5) Agents
   - Update AI and WebSocket agents to support `cutDeck`.
   - Ensure `discard`, `makeMove`, `waitForContinue` still behave with the new decision request plumbing.

6) App
   - Switch from reading `GameState.waitingForPlayers` to consuming `decisionRequests` off `serverFrame`.
   - Derive all current prompts from `decisionRequests` only.

7) Delete dead code
   - Remove all references to WAITING_* and `waitingForPlayers` throughout the codebase.


### Testing & Acceptance

- Unit
  - Types compile with removed WAITING_* and missing `waitingForPlayers`.
  - `GameLoop` correctly issues `DISCARD`, `CUT_DECK`, `PLAY_CARD`, `CONTINUE` requests.
  - `submitDecisionResponse` validates and applies domain actions; rejects invalid `requestId`, wrong `playerId`, or out-of-range `cutIndex`.

- Integration
  - Bot vs Bot:
    - Discards: both players receive requests and respond; crib phase completes.
    - Cut deck: behind-dealer receives `CUT_DECK`, index applied deterministically.
    - Pegging plays until completion, with correct turn-taking and “Go” handling.
    - Counting, then `CONTINUE` prompts for “Ready for next round” where only `decisionRequests` change.
  - WebSocket:
    - Clients receive `serverFrame` with stable `snapshot` while `decisionRequests` change.
    - Responses flow back and are applied correctly.

- Determinism
  - Only domain events mutate `GameState`. Decision request churn does not.


### Notes & Rationale

- Separating decision requests removes cross-cutting concerns and eliminates state hacks in `CribbageGame`.
- A simple, full-replace `decisionRequests` list keeps the MVP minimal and robust. We can add revisions, diffs, timeouts later if needed.
- The new `CUT_DECK` action aligns with domain semantics and gives symmetric agent control like `discard` and `makeMove`.


### Migration Guidance (Core & App)

- This is a breaking change. Update both core and app in lockstep:
  - Core: remove waiting fields and WAITING_*; add `serverFrame` and `CUT_DECK` flow.
  - App: consume `decisionRequests` instead of `waitingForPlayers`.


### Done Criteria

- `GameState` contains no waiting/decision fields.
- `ActionType` contains no WAITING_*.
- `GameLoop` produces/broadcasts `decisionRequests` and handles responses.
- Agents implement `cutDeck` and existing actions continue to work.
- The app renders prompts solely based on `decisionRequests`, and “Ready for next round” does not change the `GameState`, only the decision list.


### App-Side Changes (cribbage-with-friends-app)

This section specifies the concrete app updates to pair with the core changes. The goal is to consume `ServerFrame` with `{ snapshot, decisionRequests }`, centralize current prompts from `decisionRequests`, and add UI handling for the new `CUT_DECK` decision.


#### Transport and Event Handling

- Replace `'gameSnapshot'` listener with a single `'serverFrame'` listener.
  - The server will emit a per-player redacted `ServerFrame`:
    - `frame.snapshot: GameSnapshot` (redacted per player, same as today’s redacted snapshot)
    - `frame.decisionRequests: DecisionRequest[]` (full-replace list)

- Files:
  - `hooks/useGameState.ts`
    - Change the inbound payload type from `GameSnapshot` to `ServerFrame` in the queue.
    - Store `frame.snapshot` in the same place we previously stored `GameSnapshot`.
    - When only `decisionRequests` change and `snapshot.gameEvent.snapshotId` is the same as last processed, skip reprocessing UI state; only update decision-related store state.
    - Remove deprecated listeners: `requestMakeMove`, `discardRequest`, `continueRequest`, `waitingForPlayer`.
  - `hooks/useWebSocket.ts`
    - No structural change beyond naming: ensure the socket is set; rely on `useGameState` to bind `'serverFrame'` listener.


#### Decision Requests Derivation

- Replace derivation from `GameState.waitingForPlayers` with direct consumption of `DecisionRequest[]`:
  - `utils/decisionRequests.ts`
    - Remove all references to `gameState.waitingForPlayers`.
    - New helpers:
      - `getDecisionRequestForPlayer(decisionRequests, playerId)` → returns the first/current `DecisionRequest` targeting that player (or null).
      - `getAllWaitingInfo(decisionRequests)` → returns `waitingPlayerIds` and `waitingDecisionTypes` map derived from the array.
    - For `PLAY_CARD`, `DISCARD`, `CONTINUE`, and `CUT_DECK`, read any needed values from the request `payload` (e.g., `{ numberOfCardsToDiscard }`, `{ maxIndex }`).

- Store a copy of the latest `decisionRequests` for the UI to reference:
  - Option A (preferred): add `decisionRequests: DecisionRequest[]` to `state/gameState.ts` and set it whenever a new frame arrives.
  - Option B: plumb `decisionRequests` through `useGameState` local state only; but Option A simplifies other components that may need the list.


#### UI State and Stores

- `state/gameState.ts`:
  - Add `decisionRequests: DecisionRequest[]` to the store.
  - Replace `requestedDecisionData` union type based on old `Emitted*` structures with a simpler union based on `DecisionRequest` and a per-type derived data shape, or keep generic `DecisionRequest | null` plus `numberOfCardsToSelect` as today.
  - Add an action `setDecisionRequests(decisionRequests: DecisionRequest[])`.
  - Update actions that emit responses over the socket:
    - Replace `makeMoveResponse`, `discardResponse`, `continueResponse` with a single `decisionResponse` emitter:
      - Emit `{ requestId, playerId, type, payload }` (type-safe wrapper for `DecisionResponse`).
    - Add a helper for `CUT_DECK`:
      - `cutDeck(index: number)` → finds the current `CUT_DECK` request for this player and emits a `DecisionResponse` with that `requestId` and `payload: { index }` (or a flat number if the core uses `payload?: number`).

- `hooks/useGameState.ts`:
  - Queue type becomes `ServerFrame` instead of `GameSnapshot`.
  - In `processQueue`:
    - Extract `{ gameState, gameEvent } = frame.snapshot` and process as before for UI and card state.
    - Call `setDecisionRequests(frame.decisionRequests)`.
    - Determine the current player's request via `getDecisionRequestForPlayer` and set:
      - `requestedDecisionType`
      - `requestedDecisionData` (can be a transformed object for UI needs)
      - `numberOfCardsToSelect` (e.g., 1 for play, N for discard, 0 for continue, special handling for `CUT_DECK` if you want a selection bound)
    - Derive waiting info from `frame.decisionRequests` via `getAllWaitingInfo` for display-only indicators.
  - Remove deprecated event handlers block entirely.


#### Components

- Most components read state via Zustand and do not need large changes if we preserve store keys. Minor adjustments:
  - `PlayerHand` and play/confirm buttons continue to use `requestedDecisionType` and `numberOfCardsToSelect` to decide what to render.
  - Add conditional handling for `CUT_DECK`:
    - Provide a simple UI to pick an index in `[0, maxIndex]`. This can be a slider, buttons, or a minimal numeric input for now.
    - On submit, call `cutDeck(index)` action in the store to emit the `DecisionResponse`.
  - If you show who is “waiting,” switch from `waitingOnPlayerInfo` to a lightweight indicator based on `decisionRequests` via `getAllWaitingInfo`. You can keep `waitingOnPlayerInfo` populated for compatibility if desired, but it’s no longer needed.


#### Types

- Stop importing `Emitted*` request/response types from `cribbage-core`; they will be removed.
- Import the new types:
  - `ServerFrame`, `DecisionRequest`, `DecisionResponse`, `DecisionType` (if exported)
  - `GameSnapshot`, `GameState` remain for `frame.snapshot`.


#### Socket Emits (Client → Server)

- Replace:
  - `socket.emit('makeMoveResponse', { playerId, selectedCard })`
  - `socket.emit('discardResponse', { playerId, selectedCards })`
  - `socket.emit('continueResponse', { playerId })`

- With a single:
  - `socket.emit('decisionResponse', DecisionResponse)`
    - Example payloads:
      - PLAY_CARD: `{ requestId, playerId, type: 'PLAY_CARD', payload: { card } }` or `payload: card`
      - DISCARD: `{ requestId, playerId, type: 'DISCARD', payload: { cards } }`
      - CONTINUE: `{ requestId, playerId, type: 'CONTINUE' }`
      - CUT_DECK: `{ requestId, playerId, type: 'CUT_DECK', payload: { index } }`

Note: The exact `payload` shape can be minimal (a primitive) or wrapped in an object; align with the finalized core type.


#### Minimal App Task List

1) Types and Imports
   - Update imports from `cribbage-core` to new `ServerFrame` and decision types; remove `Emitted*` types.

2) WebSocket Handling
   - In `useGameState`, replace `'gameSnapshot'` handler with `'serverFrame'` handler; push `ServerFrame` onto the queue.
   - Remove deprecated decision-related listeners.

3) State Store
   - Add `decisionRequests` and `setDecisionRequests` to `state/gameState.ts`.
   - Replace individual response emits with one `decisionResponse` emitter.
   - Add `cutDeck(index: number)` action.

4) Decision Helpers
   - Replace `utils/decisionRequests.ts` to read from `DecisionRequest[]` instead of `GameState.waitingForPlayers`.

5) UI
   - Ensure components render based on `requestedDecisionType` as before.
   - Add a simple control for `CUT_DECK` to pick an index `[0..maxIndex]`.

6) Behavior
   - When only `decisionRequests` change and snapshot hasn’t advanced, skip expensive reprocessing; update only decision/UI prompt state.

7) Cleanup
   - Remove all references to `waitingForPlayers` in the app codebase and docs.
   - Update `docs/app-side-overhaul-changes.md` to reflect the new transport (`ServerFrame`) and decision handling.


#### Acceptance for App

- App reacts to `serverFrame` updates; UI prompts appear/disappear based on `decisionRequests` without requiring `GameState` changes.
- PLAY_CARD, DISCARD, CONTINUE, and CUT_DECK are all operable via the new unified `decisionResponse` emitter.
- “Ready for next round” updates only `decisionRequests`; the snapshot remains unchanged, and the UI updates promptly.

