# PR #15 Unresolved Comments - Fix Summary

This document summarizes the 7 fixes applied to address unresolved PR review comments. Each fix is documented with the problem, solution, and rationale.

## Fix #1: Roll back auth user when profile insert fails

**Priority:** High (P2)  
**Location:** `src/services/supabaseService.ts:198-237`  
**Commit:** `943c045`

### Problem
In `signUpWithEmail`, the auth user is created before inserting the profile. If the profile insert fails (e.g., username conflict, database error), the code throws without deleting the newly created auth user. This leaves an orphaned account with no profile and blocks the user from retrying signup with the same email.

### Solution
Wrapped the profile insert in a try-catch block and added cleanup logic to delete the auth user if profile creation fails. Also added cleanup for the display name validation check.

### Code Changes
```typescript
// Before: No cleanup on failure
const { error: profileError, data: profileInsert } = await svc.from('profiles').insert({...});
if (profileError || !profileInsert) {
  throw new Error(profileError?.message ?? 'Failed to create profile');
}

// After: Cleanup on failure
let profileInsert: SupabaseProfile;
try {
  const { error: profileError, data: insertedProfile } = await svc.from('profiles').insert({...});
  if (profileError || !insertedProfile) {
    await svc.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(profileError?.message ?? 'Failed to create profile');
  }
  profileInsert = insertedProfile as SupabaseProfile;
} catch (error) {
  await svc.auth.admin.deleteUser(userId).catch(() => {});
  throw error;
}
```

### Why This Works
- Ensures atomicity: if profile creation fails, auth user is cleaned up
- Allows users to retry signup with the same email after fixing validation issues
- Uses `.catch(() => {})` for cleanup to prevent cleanup failures from masking original errors

### Potential Issues
- If auth user deletion fails, we silently ignore it (best-effort cleanup)
- Race condition: if two signups happen simultaneously with same email, both might create auth users before either fails

---

## Fix #2: Handle friendship insert errors

**Priority:** High (Medium)  
**Location:** `src/services/supabaseService.ts:975-979`  
**Commit:** `b22c8ec`

### Problem
After marking a friend request as accepted, the friendship row is inserted without checking the returned error. If the insert fails (e.g., unique constraint, DB error), the error is silently ignored. The function completes successfully with the friend request marked as 'accepted' even though no friendship was created, leaving the database in an inconsistent state.

### Solution
Added error checking for the friendship insert operation.

### Code Changes
```typescript
// Before: No error handling
await client.from('friendships').insert({
  user_id: userId,
  friend_id: friendId,
});

// After: Error handling added
const { error: friendshipError } = await client.from('friendships').insert({
  user_id: userId,
  friend_id: friendId,
});
if (friendshipError) {
  throw new Error(friendshipError.message);
}
```

### Why This Works
- Surfaces database errors immediately
- Prevents inconsistent state where request is accepted but no friendship exists
- Allows caller to handle the error appropriately

### Potential Issues
- If friendship insert fails after request is marked accepted, the request remains in 'accepted' state with no friendship (but at least the error is surfaced)

---

## Fix #3: Filter disconnected players before starting game

**Priority:** High (Medium)  
**Location:** `src/server.ts:970-1000`  
**Commit:** `17df43d`

### Problem
When starting a lobby game via `startLobbyGameForHost`, players are fetched from Supabase (`lobby.players`) and added to `playersInfo`, but agents are only populated for players who exist in `connectedPlayers` (active WebSocket connections). If a player is in the Supabase lobby but has disconnected their WebSocket, their agent won't be added to the `agents` map. The `GameLoop` is then created with all players in `playersInfo`, but when `waitForDecision` is called for the disconnected player, it throws "No agent for player X" because no agent was registered.

### Solution
Filter out disconnected players before creating the GameLoop, ensuring only players with active agents are included.

### Code Changes
```typescript
// Before: Used all playersInfo, even if some don't have agents
const gameLoop = new GameLoop(playersInfo);
agents.forEach((agent, id) => gameLoop.addAgent(id, agent));

// After: Filter to only players with agents
const validPlayersInfo = playersInfo.filter(p => agents.has(p.id));
if (validPlayersInfo.length !== playersInfo.length) {
  const disconnectedPlayers = playersInfo.filter(p => !agents.has(p.id));
  logger.warn(`[startLobbyGameForHost] Filtering out ${disconnectedPlayers.length} disconnected players: ${disconnectedPlayers.map(p => p.name).join(', ')}`);
}
if (validPlayersInfo.length < 2) {
  throw new Error('Not enough connected players to start game');
}
const gameLoop = new GameLoop(validPlayersInfo);
agents.forEach((agent, id) => gameLoop.addAgent(id, agent));
```

### Why This Works
- Ensures all players in GameLoop have corresponding agents
- Prevents crashes when waiting for decisions from disconnected players
- Validates minimum player count before starting game
- Logs warning for visibility when players are filtered out

### Potential Issues
- If host disconnects right before starting, game might start with fewer players than expected
- No notification to disconnected players that they were excluded

---

## Fix #4: Update invitation status only after successful join

**Priority:** Medium (P2)  
**Location:** `src/services/supabaseService.ts:766-808`  
**Commit:** `89f29bd`

### Problem
`respondToLobbyInvitation` updates the invitation status to `accepted` before calling `joinLobby`. If `joinLobby` fails (lobby full/locked or invite code mismatch), the invitation remains accepted even though the user never joined, which prevents re-accepting and leaves the system in an inconsistent state.

### Solution
Reordered operations: attempt to join lobby first, then update invitation status only after successful join.

### Code Changes
```typescript
// Before: Update status first, then join
const { error: updateError } = await client.from('lobby_invitations').update({ status: 'accepted' })...;
const lobby = await joinLobby({...});

// After: Join first, then update status
if (!params.accept) {
  // For declines, update immediately
  const { error: updateError } = await client.from('lobby_invitations').update({ status: 'declined' })...;
  return { invitation: {...invitation, status: 'declined'} };
}

// For accepts, try to join first
let lobby: LobbyPayload;
try {
  lobby = await joinLobby({...});
} catch (error) {
  // If join fails, don't update invitation status
  throw error;
}

// Only update status after successful join
const { error: updateError } = await client.from('lobby_invitations').update({ status: 'accepted' })...;
```

### Why This Works
- Ensures invitation status matches actual join state
- If join fails, invitation remains in 'pending' state, allowing retry
- Maintains atomicity: status only changes if join succeeds

### Potential Issues
- If status update fails after successful join, user has joined but invitation shows as pending (minor inconsistency, but user is in lobby)

---

## Fix #5: Prevent race condition in game event persistence

**Priority:** Medium  
**Location:** `src/server.ts:299-321`  
**Commit:** `05beb6c`

### Problem
The `persistRoundHistory` function reads events from `currentRoundGameEventsByLobbyId`, awaits an async database write, then clears the map to `[]`. Since persistence is triggered with `void` (fire-and-forget) on `READY_FOR_NEXT_ROUND` or `WIN` events, a race condition can occur: if a `START_ROUND` event fires during the database await, the snapshot listener will set `currentRoundGameEventsByLobbyId` to `[START_ROUND event]`, but then the persistence callback completes and clears it to `[]`, losing the `START_ROUND` event.

### Solution
Use atomic snapshot-and-clear pattern: capture events and clear the map immediately before the async database operation.

### Code Changes
```typescript
// Before: Clear after async operation
const roundEvents = currentRoundGameEventsByLobbyId.get(lobbyId) ?? [];
// ... prepare events ...
await persistGameEvents({...});
currentRoundGameEventsByLobbyId.set(lobbyId, []); // Cleared after await

// After: Clear before async operation
const roundEvents = currentRoundGameEventsByLobbyId.get(lobbyId) ?? [];
if (roundEvents.length === 0) return;
// Clear immediately before async operation to prevent race conditions
currentRoundGameEventsByLobbyId.set(lobbyId, []);
// ... prepare events ...
await persistGameEvents({...});
```

### Why This Works
- If START_ROUND fires during persistence, it's added to the (now-empty) map and won't be cleared
- Events are captured atomically before any async operations
- Prevents lost events during concurrent operations

### Potential Issues
- If persistence fails, events are already cleared and won't be retried (but failures are logged)
- Multiple concurrent persistence calls could still race (but this is unlikely given the event flow)

---

## Fix #6: Correct status codes for username validation errors

**Priority:** Medium  
**Location:** `src/httpApi.ts:160-163`  
**Commit:** `839f9f0`

### Problem
The error status code logic checks for `'USERNAME_REQUIRED'` but `validateAndNormalizeUsername` in `supabaseService.ts` actually throws errors like `'Username is required'`, `'Username must be between 3 and 20 characters'`, and `'Username can only contain lowercase letters, numbers, underscores, and hyphens'`. Since none of these match the checked strings, all username validation errors incorrectly return status `409` (Conflict) instead of `400` (Bad Request).

### Solution
Updated the status code logic to check for actual error message patterns from `validateAndNormalizeUsername`.

### Code Changes
```typescript
// Before: Checked for non-existent error codes
const status = ['USERNAME_REQUIRED', 'DISPLAY_NAME_REQUIRED', 'NO_FIELDS'].includes(message) ? 400 : 409;

// After: Check for actual error message patterns
const isValidationError = 
  message.includes('Username') || 
  message.includes('must be between') ||
  message.includes('can only contain') ||
  message === 'DISPLAY_NAME_REQUIRED' ||
  message === 'NO_FIELDS';
const status = isValidationError ? 400 : 409;
```

### Why This Works
- Matches actual error messages from validation function
- Returns appropriate HTTP status codes (400 for validation errors, 409 for conflicts)
- Uses pattern matching to catch all username validation errors

### Potential Issues
- Pattern matching could match unintended error messages if they contain "Username" (but unlikely)
- If validation error messages change, this code needs to be updated

---

## Fix #7: Verify friend request update matches row

**Priority:** Low (P2)  
**Location:** `src/services/supabaseService.ts:954-975`  
**Commit:** `8b48b2d`

### Problem
The update only checks for an error, not whether a row actually matched `requestId` + `recipientId`. If a user supplies a requestId that belongs to a different recipient, the update is a no-op but the code still looks up the sender by ID and creates a friendship, effectively allowing forged friendships when a requestId is guessed or leaked.

### Solution
Use `.select()` to return updated rows and verify that at least one row was matched before proceeding.

### Code Changes
```typescript
// Before: No verification of matched rows
const { error } = await client
  .from('friend_requests')
  .update({ status })
  .eq('id', params.requestId)
  .eq('recipient_id', params.recipientId);
if (error) {
  throw new Error(error.message);
}
const sender = await client.from('friend_requests').select('sender_id').eq('id', params.requestId).single();

// After: Verify update matched a row
const { data: updated, error } = await client
  .from('friend_requests')
  .update({ status })
  .eq('id', params.requestId)
  .eq('recipient_id', params.recipientId)
  .select('sender_id');
if (error) {
  throw new Error(error.message);
}
if (!updated || updated.length === 0) {
  throw new Error('Friend request not found or not authorized');
}
const senderId = updated[0].sender_id;
```

### Why This Works
- Verifies that the update actually matched a row for the correct recipient
- Prevents forged friendships by ensuring requestId belongs to the recipient
- Eliminates unnecessary second query by getting sender_id from update result

### Potential Issues
- If multiple rows somehow match (shouldn't happen with proper constraints), only first sender_id is used
- Error message is generic ("not found or not authorized") but sufficient for security

---

## Summary

All 7 fixes address real bugs that could cause:
- Data inconsistency (orphaned auth users, accepted requests without friendships)
- Security issues (forged friendships, unauthorized access)
- Runtime crashes (disconnected players, missing agents)
- Poor user experience (wrong status codes, lost events)

Each fix follows defensive programming principles:
- Validate inputs and state before operations
- Clean up resources on failure
- Verify operations succeeded before proceeding
- Use atomic operations where possible

## Testing Recommendations

1. **Fix #1**: Test signup with duplicate username, verify auth user is cleaned up
2. **Fix #2**: Test friend request acceptance with database constraint violation
3. **Fix #3**: Test starting game with disconnected player in lobby
4. **Fix #4**: Test accepting invitation when lobby is full/locked
5. **Fix #5**: Test rapid round transitions to verify no events are lost
6. **Fix #6**: Test profile update with invalid username, verify 400 status
7. **Fix #7**: Test accepting friend request with wrong requestId, verify error
