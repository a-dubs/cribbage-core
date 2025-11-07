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

