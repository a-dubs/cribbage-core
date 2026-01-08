# Local Supabase Testing Guide

This guide explains how to test Supabase migrations locally before deploying to production.

## Quick Start

1. **Stop other Supabase instances** (if running):
   ```bash
   # Stop client-portal-app instance (or any other)
   cd /Users/a-dubs/client-portal/client-portal-app
   npx supabase stop
   ```

2. **Start local Supabase** (from repository root):
   ```bash
   cd /Users/a-dubs/personal/cribbage
   npx supabase start
   ```

3. **Populate .env with local credentials** (from cribbage-core):
   ```bash
   cd cribbage-core
   pnpm run env:local
   ```

4. **Test migrations** (from repository root):
   ```bash
   cd /Users/a-dubs/personal/cribbage
   npx supabase migration up
   ```

## Detailed Steps

### Prerequisites

- Docker Desktop running
- Supabase CLI installed (`npm install -g supabase` or use `npx supabase`)
- No port conflicts (see Troubleshooting below)

### Step 1: Start Local Supabase

From the repository root where `supabase/` folder is located:

```bash
cd /Users/a-dubs/personal/cribbage
npx supabase start
```

This starts local Supabase containers and applies existing migrations. Wait for the "Started" message.

**Note:** First run will download Docker images (~500MB) and may take a few minutes.

### Step 2: Update .env with Local Credentials

From the `cribbage-core` directory:

```bash
cd cribbage-core
pnpm run env:local
```

This script:
- Reads credentials from `npx supabase status`
- Updates `.env` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
- Preserves other environment variables

**Output example:**
```
🔄 Fetching local Supabase credentials...

✅ Updated .env with local Supabase credentials:
   API URL:     http://127.0.0.1:54321
   Anon Key:    eyJhbGciOiJIUzI1NiIsIn...
   Service Key: eyJhbGciOiJIUzI1NiIsIn...
   DB URL:      postgresql://postgres:postgres@127.0.0.1:54322/postgres

✨ Done! Your .env is now configured for local development.
```

### Step 3: Test Migrations

From the repository root:

```bash
cd /Users/a-dubs/personal/cribbage
npx supabase migration up
```

This applies all pending migrations. To test a specific migration:

```bash
npx supabase migration up --version 0002_enforce_single_active_lobby
```

### Step 4: Verify Migration

Check that triggers were created:

```bash
npx supabase db reset  # Resets and reapplies all migrations
npx supabase migration list  # Shows migration status
```

## Testing Single Lobby Enforcement

After applying `0002_enforce_single_active_lobby.sql`, you can test the constraint:

1. **Test constraint violation:**
   ```sql
   -- In Supabase Studio SQL Editor (http://127.0.0.1:54323)
   -- First, create a lobby and add a player
   INSERT INTO lobbies (host_id, max_players, status) 
   VALUES ('<player-id-1>', 2, 'waiting');
   
   INSERT INTO lobby_players (lobby_id, player_id)
   VALUES ('<lobby-id-1>', '<player-id-1>');
   
   -- Try to add same player to another active lobby (should fail)
   INSERT INTO lobbies (host_id, max_players, status) 
   VALUES ('<player-id-2>', 2, 'waiting');
   
   INSERT INTO lobby_players (lobby_id, player_id)
   VALUES ('<lobby-id-2>', '<player-id-1>');  -- ❌ Should fail with "Player is already in an active lobby"
   ```

2. **Test rematch constraint:**
   ```sql
   -- Finish a lobby
   UPDATE lobbies SET status = 'finished' WHERE id = '<lobby-id-1>';
   
   -- Player joins another lobby
   INSERT INTO lobby_players (lobby_id, player_id)
   VALUES ('<lobby-id-2>', '<player-id-1>');
   
   -- Try to restart finished lobby (should fail)
   UPDATE lobbies SET status = 'waiting' WHERE id = '<lobby-id-1>';
   -- ❌ Should fail with "Cannot restart/resume: One or more players are already in another active lobby"
   ```

## Useful Commands

```bash
# Check Supabase status
npx supabase status

# View logs
npx supabase logs

# Stop local Supabase
npx supabase stop

# Reset database (applies all migrations from scratch)
npx supabase db reset

# List migrations
npx supabase migration list

# Open Supabase Studio (web UI)
open http://127.0.0.1:54323
```

## Running Multiple Supabase Instances

Supabase CLI uses fixed ports, so you can only run one instance at a time. To switch between projects:

1. **Stop current instance:**
   ```bash
   cd /path/to/current/project
   npx supabase stop
   ```

2. **Start another instance:**
   ```bash
   cd /path/to/other/project
   npx supabase start
   ```

**Note:** Each project's data is stored in separate Docker volumes, so stopping one doesn't affect the other's data.

## Troubleshooting

### Port Already Allocated

**Error:** `Bind for 0.0.0.0:54322 failed: port is already allocated`

**Solution:** Stop other Supabase instances:
```bash
# Stop specific project (from that project's directory)
cd /path/to/other/project
npx supabase stop

# Or find and stop by container name
docker ps | grep supabase
docker stop <container-id>
```

### Script Can't Find Supabase Status

**Error:** `Failed to get Supabase status`

**Solution:**
1. Ensure Supabase is running: `npx supabase start`
2. Verify you're in the correct directory (script runs `supabase status` from root)
3. Check Docker is running: `docker ps`

### Migration Fails

**Error:** `relation "public.lobby_invitations" does not exist`

**Solution:** This indicates a migration ordering issue. The migration references a table before it's created. Options:
1. Fix the migration file ordering (move table creation before policy creation)
2. Apply migrations manually in correct order
3. View detailed logs: `npx supabase logs --debug`
4. Reset database: `npx supabase db reset` (if migrations are idempotent)

**General migration troubleshooting:**
- Check migration SQL syntax
- Verify migration file is in `supabase/migrations/` directory
- Ensure tables are created before policies/functions reference them

## Files

- **Migration files:** `supabase/migrations/*.sql`
- **Script:** `cribbage-core/scripts/update-local-env.ts`
- **Documentation:** `cribbage-core/scripts/README.md`

## Next Steps

After testing locally:
1. Verify all constraints work as expected
2. Test edge cases (finished lobbies, rematches, etc.)
3. Deploy to staging/production Supabase instance
4. Monitor for constraint violations in production logs
