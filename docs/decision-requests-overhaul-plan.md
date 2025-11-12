# Decision Requests Overhaul - Detailed Implementation Plan

## Overview

This document provides a detailed implementation plan for overhauling the decision request system using **Option A: Unified Decision Request System** with specific enhancements.

## Core Principles

1. **Single Source of Truth**: All active decision requests live in `GameSnapshot.pendingDecisionRequests`
2. **Explicit Actions**: Game actions (DEAL, CUT_DECK) are distinct decision types, not generic continues
3. **Specific Acknowledgments**: Each acknowledgment type is explicit (READY_FOR_COUNTING, READY_FOR_NEXT_ROUND)
4. **Parallel Decisions**: Multiple players can make decisions simultaneously (discard, acknowledge)
5. **Blocking Flow**: Acknowledgments block game flow until all required players respond
6. **No Backwards Compatibility**: Big bang migration - rip the bandaid off

---

## Phase 1: Type Definitions

### 1.1 New ActionTypes

```typescript
export enum ActionType {
  // Existing action types
  DEAL = 'DEAL',
  DISCARD = 'DISCARD',
  PLAY_CARD = 'PLAY_CARD',
  CUT_DECK = 'CUT_DECK',
  START_PEGGING_ROUND = 'START_PEGGING_ROUND',
  START_ROUND = 'START_ROUND',
  WIN = 'WIN',
  
  // New acknowledgment action types (specific, not generic)
  READY_FOR_COUNTING = 'READY_FOR_COUNTING',        // Player ready to proceed to counting phase
  READY_FOR_NEXT_ROUND = 'READY_FOR_NEXT_ROUND',    // Player ready to start next round
  // Future: READY_FOR_SCORING, READY_FOR_PEGGING, etc. as needed
}
```

**Rationale:**
- Specific action types make it clear what each acknowledgment is for
- Easy to extend with new acknowledgment types
- Can track which players have acknowledged what in game history

### 1.2 Enhanced AgentDecisionType

```typescript
export enum AgentDecisionType {
  // Game action decisions (require specific responses)
  PLAY_CARD = 'PLAY_CARD',      // Player must play a card
  DISCARD = 'DISCARD',           // Player must discard cards (parallel)
  DEAL = 'DEAL',                 // Dealer must deal cards (explicit action)
  CUT_DECK = 'CUT_DECK',         // Player must cut deck (explicit action with index)
  
  // Acknowledgment decisions (pacing/blocking)
  READY_FOR_COUNTING = 'READY_FOR_COUNTING',        // Acknowledge ready for counting
  READY_FOR_NEXT_ROUND = 'READY_FOR_NEXT_ROUND',    // Acknowledge ready for next round
  // Future acknowledgment types as needed
}
```

**Key Changes:**
- `CONTINUE` removed (replaced by specific acknowledgment types)
- `DEAL` is now a decision type (not treated as CONTINUE)
- `CUT_DECK` is now a decision type (not a continue)
- Specific acknowledgment types instead of generic ACKNOWLEDGE

### 1.3 DecisionRequest Interface

```typescript
/**
 * Unified interface for all decision requests
 * All active requests are stored in GameSnapshot.pendingDecisionRequests
 */
export interface DecisionRequest {
  requestId: string;                    // Unique ID for this request (UUID)
  playerId: string;                      // Player who must respond
  decisionType: AgentDecisionType;      // Type of decision required
  requestData: DecisionRequestData;      // Context-specific data for the request
  required: boolean;                    // Whether this blocks game flow (true for all)
  timestamp: Date;                       // When request was made
  expiresAt?: Date;                      // Optional expiration (for future timeout handling)
}

/**
 * Context-specific data for each decision type
 */
export type DecisionRequestData =
  | PlayCardRequestData
  | DiscardRequestData
  | DealRequestData
  | CutDeckRequestData
  | AcknowledgeRequestData;

export interface PlayCardRequestData {
  peggingHand: Card[];
  peggingStack: Card[];
  playedCards: PlayedCard[];
  peggingTotal: number;
}

export interface DiscardRequestData {
  hand: Card[];
  numberOfCardsToDiscard: number;
}

export interface DealRequestData {
  // Future: could include shuffle options, etc.
  canShuffle?: boolean;  // Whether player can shuffle before dealing
}

export interface CutDeckRequestData {
  maxIndex: number;      // Maximum valid cut index (deck.length - 1)
  deckSize: number;      // Total deck size for context
}

export interface AcknowledgeRequestData {
  message: string;       // User-friendly message (e.g., "Ready for counting")
  // No additional data needed - just acknowledgment
}
```

### 1.4 Updated GameSnapshot

```typescript
export interface GameSnapshot {
  gameState: GameState;                    // Current state of the game
  gameEvent: GameEvent;                     // Last event that occurred
  pendingDecisionRequests: DecisionRequest[];  // NEW: Active decision requests
}
```

**Key Changes:**
- `waitingForPlayers` removed from `GameState`
- `pendingDecisionRequests` added to `GameSnapshot` (third field)
- All active decision requests are in this array
- Empty array means no pending decisions

### 1.5 Updated GameState

```typescript
export interface GameState {
  id: string;
  players: Player[];
  deck: Card[];
  crib: Card[];
  turnCard: Card | null;
  currentPhase: Phase;
  peggingStack: Card[];
  peggingGoPlayers: string[];
  peggingLastCardPlayer: string | null;
  playedCards: PlayedCard[];
  peggingTotal: number;
  snapshotId: number;
  roundNumber: number;
  // waitingForPlayers: WaitingForPlayer[];  // REMOVED
}
```

### 1.6 Updated GameAgent Interface

```typescript
export interface GameAgent {
  playerId: string;
  human: boolean;
  
  // Game action decisions
  makeMove(game: GameState, playerId: string): Promise<Card | null>;
  discard(game: GameState, playerId: string, numberOfCardsToDiscard: number): Promise<Card[]>;
  deal?(game: GameState, playerId: string): Promise<void>;  // NEW: Explicit deal action
  cutDeck?(game: GameState, playerId: string, maxIndex: number): Promise<number>;  // NEW: Cut deck with index
  
  // Acknowledgment decisions (parallel, blocking)
  acknowledgeReadyForCounting?(game: GameState, playerId: string): Promise<void>;  // NEW
  acknowledgeReadyForNextRound?(game: GameState, playerId: string): Promise<void>;  // NEW
  
  // REMOVED: waitForContinue (replaced by specific acknowledgment methods)
}
```

---

## Phase 2: Core Game Logic Updates

### 2.1 CribbageGame Changes

**New Methods:**
```typescript
class CribbageGame {
  /**
   * Add a decision request to the pending requests
   * Called by GameLoop when requesting a decision
   */
  addDecisionRequest(request: DecisionRequest): void {
    // Add to pending requests (stored in GameSnapshot, not GameState)
    // This will be part of the next GameSnapshot emitted
  }
  
  /**
   * Remove a decision request (when player responds)
   */
  removeDecisionRequest(requestId: string): void {
    // Remove from pending requests
  }
  
  /**
   * Get all pending decision requests
   */
  getPendingDecisionRequests(): DecisionRequest[] {
    // Return current pending requests
  }
  
  /**
   * Check if all required players have responded to a blocking request
   * Used for acknowledgment requests that require all players
   */
  allPlayersAcknowledged(decisionType: AgentDecisionType): boolean {
    // Check if all required players have responded
  }
  
  // REMOVED: addWaitingForPlayer, removeWaitingForPlayer, clearAllWaiting
}
```

**Key Changes:**
- Remove all `waitingForPlayers` methods
- Add `DecisionRequest` management methods
- Decision requests stored separately (not in GameState)
- Emitted as part of GameSnapshot

### 2.2 GameLoop Changes

**New Decision Request Flow:**
```typescript
class GameLoop {
  /**
   * Request a decision from a player
   * Creates a DecisionRequest and adds it to pending requests
   */
  private requestDecision(
    playerId: string,
    decisionType: AgentDecisionType,
    requestData: DecisionRequestData
  ): DecisionRequest {
    const request: DecisionRequest = {
      requestId: generateUUID(),
      playerId,
      decisionType,
      requestData,
      required: true,  // All decisions block flow
      timestamp: new Date(),
    };
    
    this.cribbageGame.addDecisionRequest(request);
    // Request will be included in next GameSnapshot
    
    return request;
  }
  
  /**
   * Wait for a decision response
   * Calls appropriate agent method based on decision type
   */
  private async waitForDecision(request: DecisionRequest): Promise<any> {
    const agent = this.agents[request.playerId];
    if (!agent) throw new Error(`No agent for player ${request.playerId}`);
    
    const redactedGameState = this.cribbageGame.getRedactedGameState(request.playerId);
    
    switch (request.decisionType) {
      case AgentDecisionType.PLAY_CARD:
        const card = await agent.makeMove(redactedGameState, request.playerId);
        this.cribbageGame.removeDecisionRequest(request.requestId);
        return card;
        
      case AgentDecisionType.DISCARD:
        const data = request.requestData as DiscardRequestData;
        const discards = await agent.discard(
          redactedGameState,
          request.playerId,
          data.numberOfCardsToDiscard
        );
        this.cribbageGame.removeDecisionRequest(request.requestId);
        return discards;
        
      case AgentDecisionType.DEAL:
        if (agent.deal) {
          await agent.deal(redactedGameState, request.playerId);
        }
        this.cribbageGame.removeDecisionRequest(request.requestId);
        this.cribbageGame.deal();  // Trigger the actual deal action
        return;
        
      case AgentDecisionType.CUT_DECK:
        if (agent.cutDeck) {
          const cutData = request.requestData as CutDeckRequestData;
          const cutIndex = await agent.cutDeck(
            redactedGameState,
            request.playerId,
            cutData.maxIndex
          );
          this.cribbageGame.removeDecisionRequest(request.requestId);
          this.cribbageGame.cutDeck(request.playerId, cutIndex);
          return cutIndex;
        }
        break;
        
      case AgentDecisionType.READY_FOR_COUNTING:
        if (agent.acknowledgeReadyForCounting) {
          await agent.acknowledgeReadyForCounting(redactedGameState, request.playerId);
        }
        this.cribbageGame.removeDecisionRequest(request.requestId);
        // Check if all players have acknowledged
        if (this.cribbageGame.allPlayersAcknowledged(AgentDecisionType.READY_FOR_COUNTING)) {
          // All players ready - proceed to counting
        }
        return;
        
      case AgentDecisionType.READY_FOR_NEXT_ROUND:
        if (agent.acknowledgeReadyForNextRound) {
          await agent.acknowledgeReadyForNextRound(redactedGameState, request.playerId);
        }
        this.cribbageGame.removeDecisionRequest(request.requestId);
        // Check if all players have acknowledged
        if (this.cribbageGame.allPlayersAcknowledged(AgentDecisionType.READY_FOR_NEXT_ROUND)) {
          // All players ready - proceed to next round
        }
        return;
    }
  }
}
```

**Parallel Discarding:**
```typescript
private async doCribPhase(): Promise<void> {
  // Request discards from ALL players in parallel
  const discardRequests: DecisionRequest[] = [];
  
  for (const player of this.cribbageGame.getGameState().players) {
    const request = this.requestDecision(
      player.id,
      AgentDecisionType.DISCARD,
      {
        hand: player.hand,
        numberOfCardsToDiscard: this.cribbageGame.getGameState().players.length === 2 ? 2 : 1,
      }
    );
    discardRequests.push(request);
  }
  
  // Wait for all discards in parallel
  const discardPromises = discardRequests.map(request => this.waitForDecision(request));
  const allDiscards = await Promise.all(discardPromises);
  
  // Apply all discards
  for (let i = 0; i < this.cribbageGame.getGameState().players.length; i++) {
    const player = this.cribbageGame.getGameState().players[i];
    const discards = allDiscards[i];
    this.cribbageGame.discardToCrib(player.id, discards);
  }
  
  this.cribbageGame.completeCribPhase();
}
```

**Parallel Acknowledgments:**
```typescript
private async waitForAllPlayersReady(
  decisionType: AgentDecisionType.READY_FOR_COUNTING | AgentDecisionType.READY_FOR_NEXT_ROUND,
  message: string
): Promise<void> {
  // Request acknowledgments from ALL players in parallel
  const acknowledgeRequests: DecisionRequest[] = [];
  
  for (const player of this.cribbageGame.getGameState().players) {
    const request = this.requestDecision(
      player.id,
      decisionType,
      { message }
    );
    acknowledgeRequests.push(request);
  }
  
  // Wait for all acknowledgments in parallel
  // Each player can acknowledge independently
  const acknowledgePromises = acknowledgeRequests.map(request => 
    this.waitForDecision(request)
  );
  
  // Wait for all to complete (blocking)
  await Promise.all(acknowledgePromises);
  
  // All players have acknowledged - proceed
}
```

**Updated Round Flow:**
```typescript
private async doRound(): Promise<string | null> {
  this.cribbageGame.startRound();
  
  // DEAL: Explicit decision request (not continue)
  const dealer = this.cribbageGame.getPlayer(this.cribbageGame.getDealerId());
  const dealRequest = this.requestDecision(
    dealer.id,
    AgentDecisionType.DEAL,
    { canShuffle: true }  // Future: allow shuffling
  );
  await this.waitForDecision(dealRequest);
  // deal() is called inside waitForDecision after agent responds
  
  // DISCARD: Parallel (all players at once)
  await this.doCribPhase();
  
  // CUT_DECK: Explicit decision request (not continue)
  const behindDealer = this.getBehindDealer();
  const cutRequest = this.requestDecision(
    behindDealer.id,
    AgentDecisionType.CUT_DECK,
    {
      maxIndex: this.cribbageGame.getGameState().deck.length - 1,
      deckSize: this.cribbageGame.getGameState().deck.length,
    }
  );
  await this.waitForDecision(cutRequest);
  // cutDeck() is called inside waitForDecision with returned index
  
  // PEGGING: Sequential (one player at a time)
  const peggingWinner = await this.doPegging();
  if (peggingWinner) return peggingWinner;
  
  // READY_FOR_COUNTING: Parallel acknowledgment (all players)
  await this.waitForAllPlayersReady(
    AgentDecisionType.READY_FOR_COUNTING,
    'Ready for counting'
  );
  
  // COUNTING: Score hands
  await this.doCounting();
  
  // READY_FOR_NEXT_ROUND: Parallel acknowledgment (all players)
  await this.waitForAllPlayersReady(
    AgentDecisionType.READY_FOR_NEXT_ROUND,
    'Ready for next round'
  );
  
  return null;
}
```

---

## Phase 3: Server Updates

### 3.1 WebSocket Event Handling

**New Events:**
```typescript
// Client → Server
socket.on('decisionResponse', (response: DecisionResponse) => {
  // Handle decision response
  // Route to appropriate handler based on decisionType
});

// Server → Client
// GameSnapshot already includes pendingDecisionRequests
// No separate events needed!
```

**DecisionResponse Types:**
```typescript
export type DecisionResponse =
  | PlayCardResponse
  | DiscardResponse
  | DealResponse
  | CutDeckResponse
  | AcknowledgeResponse;

export interface PlayCardResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.PLAY_CARD;
  selectedCard: Card | null;
}

export interface DiscardResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.DISCARD;
  selectedCards: Card[];
}

export interface DealResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.DEAL;
  // No data needed - just acknowledgment
}

export interface CutDeckResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.CUT_DECK;
  cutIndex: number;
}

export interface AcknowledgeResponse {
  requestId: string;
  playerId: string;
  decisionType: AgentDecisionType.READY_FOR_COUNTING | AgentDecisionType.READY_FOR_NEXT_ROUND;
  // No data needed - just acknowledgment
}
```

**WebSocketAgent Updates:**
```typescript
class WebSocketAgent {
  // NEW: Unified decision response handler
  private async waitForDecisionResponse<T>(
    request: DecisionRequest,
    responseHandler: (response: DecisionResponse) => T | Error
  ): Promise<T> {
    return this.makeWebsocketRequest<T>(
      'decisionResponse',
      currentSocket => {
        // Send request to client (via GameSnapshot.pendingDecisionRequests)
        // Client will respond with decisionResponse
      },
      (response: DecisionResponse) => {
        if (response.requestId !== request.requestId) {
          return new Error(`Response requestId mismatch`);
        }
        if (response.playerId !== this.playerId) {
          return new Error(`Response from wrong player`);
        }
        return responseHandler(response);
      }
    );
  }
  
  // Updated methods
  async makeMove(game: GameState, playerId: string): Promise<Card | null> {
    // Find pending PLAY_CARD request
    const request = this.findPendingRequest(AgentDecisionType.PLAY_CARD);
    if (!request) throw new Error('No pending PLAY_CARD request');
    
    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.PLAY_CARD) {
        return new Error('Invalid response type');
      }
      return (response as PlayCardResponse).selectedCard;
    });
  }
  
  async discard(game: GameState, playerId: string, numberOfCardsToDiscard: number): Promise<Card[]> {
    const request = this.findPendingRequest(AgentDecisionType.DISCARD);
    if (!request) throw new Error('No pending DISCARD request');
    
    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.DISCARD) {
        return new Error('Invalid response type');
      }
      return (response as DiscardResponse).selectedCards;
    });
  }
  
  async deal(game: GameState, playerId: string): Promise<void> {
    const request = this.findPendingRequest(AgentDecisionType.DEAL);
    if (!request) throw new Error('No pending DEAL request');
    
    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.DEAL) {
        return new Error('Invalid response type');
      }
      return;
    });
  }
  
  async cutDeck(game: GameState, playerId: string, maxIndex: number): Promise<number> {
    const request = this.findPendingRequest(AgentDecisionType.CUT_DECK);
    if (!request) throw new Error('No pending CUT_DECK request');
    
    return this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.CUT_DECK) {
        return new Error('Invalid response type');
      }
      return (response as CutDeckResponse).cutIndex;
    });
  }
  
  async acknowledgeReadyForCounting(game: GameState, playerId: string): Promise<void> {
    const request = this.findPendingRequest(AgentDecisionType.READY_FOR_COUNTING);
    if (!request) throw new Error('No pending READY_FOR_COUNTING request');
    
    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.READY_FOR_COUNTING) {
        return new Error('Invalid response type');
      }
      return;
    });
  }
  
  async acknowledgeReadyForNextRound(game: GameState, playerId: string): Promise<void> {
    const request = this.findPendingRequest(AgentDecisionType.READY_FOR_NEXT_ROUND);
    if (!request) throw new Error('No pending READY_FOR_NEXT_ROUND request');
    
    await this.waitForDecisionResponse(request, (response) => {
      if (response.decisionType !== AgentDecisionType.READY_FOR_NEXT_ROUND) {
        return new Error('Invalid response type');
      }
      return;
    });
  }
  
  // REMOVED: waitForContinue
}
```

---

## Phase 4: App Updates

### 4.1 State Management

**Updated Store:**
```typescript
type GlobalGameState = {
  gameState: Readonly<GameState> | null;
  recentGameEvent: GameEvent | null;
  // REMOVED: requestedDecisionType, requestedDecisionData, numberOfCardsToSelect
  // REMOVED: waitingOnPlayerInfo
  
  // NEW: Derive from GameSnapshot.pendingDecisionRequests
  myPendingRequests: DecisionRequest[];  // Requests for this player
  otherPendingRequests: DecisionRequest[];  // Requests for other players (for UI)
};
```

**Derivation Logic:**
```typescript
// In useGameState.ts processQueue()
function processGameSnapshot(snapshot: GameSnapshot, playerId: string) {
  // Derive my pending requests
  const myPendingRequests = snapshot.pendingDecisionRequests.filter(
    req => req.playerId === playerId
  );
  
  // Derive other players' requests (for UI indicators)
  const otherPendingRequests = snapshot.pendingDecisionRequests.filter(
    req => req.playerId !== playerId
  );
  
  // Update store
  setMyPendingRequests(myPendingRequests);
  setOtherPendingRequests(otherPendingRequests);
}
```

### 4.2 UI Components

**PlayerActionButtons:**
```typescript
export const PlayerActionButtons: React.FC = () => {
  const { myPendingRequests } = useGameStateStore();
  
  // Find the most relevant request for this player
  const currentRequest = myPendingRequests[0];  // Or prioritize by type
  
  if (!currentRequest) return null;
  
  switch (currentRequest.decisionType) {
    case AgentDecisionType.PLAY_CARD:
      return <PlayCardButton request={currentRequest} />;
      
    case AgentDecisionType.DISCARD:
      return <DiscardButton request={currentRequest} />;
      
    case AgentDecisionType.DEAL:
      return <DealButton request={currentRequest} />;
      
    case AgentDecisionType.CUT_DECK:
      return <CutDeckButton request={currentRequest} />;
      
    case AgentDecisionType.READY_FOR_COUNTING:
      return <ReadyForCountingButton request={currentRequest} />;
      
    case AgentDecisionType.READY_FOR_NEXT_ROUND:
      return <ReadyForNextRoundButton request={currentRequest} />;
  }
};
```

**New Components:**
- `<DealButton>` - Explicit "Deal" button (not continue)
- `<CutDeckButton>` - Deck cutting interface with index selection
- `<ReadyForCountingButton>` - Acknowledgment button
- `<ReadyForNextRoundButton>` - Acknowledgment button

**Decision Response Handler:**
```typescript
function sendDecisionResponse(response: DecisionResponse) {
  socket.emit('decisionResponse', response);
}

// Example: Deal button
function handleDeal(request: DecisionRequest) {
  sendDecisionResponse({
    requestId: request.requestId,
    playerId: request.playerId,
    decisionType: AgentDecisionType.DEAL,
  });
}

// Example: Cut deck
function handleCutDeck(request: DecisionRequest, cutIndex: number) {
  sendDecisionResponse({
    requestId: request.requestId,
    playerId: request.playerId,
    decisionType: AgentDecisionType.CUT_DECK,
    cutIndex,
  });
}
```

### 4.3 Remove Deprecated Code

**Remove:**
- `deriveDecisionRequestForPlayer()` - replaced by direct access to `pendingDecisionRequests`
- `deriveWaitingInfo()` - replaced by `otherPendingRequests`
- All continue request handling
- All `waitingForPlayers` derivation
- Auto-continue settings (no longer needed - explicit buttons)

---

## Phase 5: Testing & Cleanup

### 5.1 Test Updates

**Update Tests:**
- Remove all `waitingForPlayers` tests
- Add `pendingDecisionRequests` tests
- Test parallel discarding
- Test parallel acknowledgments
- Test DEAL decision flow
- Test CUT_DECK decision flow

### 5.2 Documentation Updates

**Update:**
- Remove all references to `waitingForPlayers`
- Remove all references to continue requests
- Document new `DecisionRequest` system
- Document parallel decision handling
- Document specific acknowledgment types

### 5.3 Migration Checklist

- [ ] Phase 1: Type definitions
- [ ] Phase 2: Core game logic (CribbageGame, GameLoop)
- [ ] Phase 3: Server (WebSocketAgent, server.ts)
- [ ] Phase 4: App (state, components, handlers)
- [ ] Phase 5: Tests, documentation, cleanup
- [ ] Remove all deprecated code
- [ ] Verify parallel discarding works
- [ ] Verify parallel acknowledgments work
- [ ] Verify DEAL flow works
- [ ] Verify CUT_DECK flow works

---

## Key Design Decisions

### DEAL as Decision Type
**Decision:** DEAL is a decision type (like PLAY_CARD, DISCARD), not an acknowledgment.

**Rationale:**
- It's a specific game action (dealing cards)
- Future: May include shuffle options
- Should be explicit button, not generic continue
- Similar to CUT_DECK in nature

### Parallel Discarding
**Decision:** All players discard simultaneously, not sequentially.

**Rationale:**
- Faster gameplay
- More intuitive (no waiting for others)
- All players have same information (their own hand)
- No dependencies between discards

### Specific Acknowledgment Types
**Decision:** Use specific types (READY_FOR_COUNTING, READY_FOR_NEXT_ROUND) instead of generic ACKNOWLEDGE.

**Rationale:**
- Explicit about what's being acknowledged
- Easy to track in game history
- Can have different UI/behavior per type
- Extensible for future acknowledgment types

### Blocking Acknowledgments
**Decision:** Acknowledgments block game flow until all players respond.

**Rationale:**
- That's their purpose (pacing)
- Ensures all players are ready before proceeding
- Prevents race conditions
- Better UX (everyone sees same state)

### Big Bang Migration
**Decision:** No backwards compatibility, rip the bandaid off.

**Rationale:**
- Cleaner implementation
- No technical debt from supporting old system
- Faster development
- Clear break from old patterns

---

## Future Enhancements

1. **Shuffle Before Deal**: Add shuffle option to DEAL request
2. **Timeout Handling**: Add `expiresAt` to DecisionRequest for timeouts
3. **Request Priority**: Handle multiple pending requests per player
4. **Request History**: Track completed requests in game history
5. **More Acknowledgment Types**: Add as needed (READY_FOR_PEGGING, etc.)

---

## Summary

This overhaul:
- ✅ Removes `waitingForPlayers` from GameState
- ✅ Adds `pendingDecisionRequests` to GameSnapshot
- ✅ Makes DEAL and CUT_DECK explicit decision types
- ✅ Uses specific acknowledgment types (not generic)
- ✅ Enables parallel discarding
- ✅ Enables parallel acknowledgments
- ✅ Provides unified interface for all decisions
- ✅ Single source of truth in GameSnapshot
- ✅ No backwards compatibility (big bang)

The result is a cleaner, more maintainable, and more intuitive decision request system.

