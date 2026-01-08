# Cribbage Core Scripts

## Local Supabase Setup

### Prerequisites

1. Install Supabase CLI (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. Start local Supabase:
   ```bash
   npx supabase start
   ```

### Populate .env with Local Credentials

Run the script to automatically populate your `.env` file with local Supabase credentials:

```bash
pnpm run env:local
```

This script:
- Reads credentials from `npx supabase status`
- Updates `.env` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
- Preserves other environment variables in your `.env` file

### Testing Migrations Locally

Once your `.env` is configured with local Supabase credentials:

**Note:** Supabase commands should be run from the repository root (where `supabase/` folder is located), not from `cribbage-core/`.

1. **Navigate to root directory:**
   ```bash
   cd /Users/a-dubs/personal/cribbage
   ```

2. **Start local Supabase (if not already running):**
   ```bash
   npx supabase start
   ```

3. **Apply migrations:**
   ```bash
   npx supabase migration up
   ```

4. **Test a specific migration:**
   ```bash
   npx supabase migration up --version <migration_version>
   ```

5. **Reset database (applies all migrations from scratch):**
   ```bash
   npx supabase db reset
   ```

6. **Check migration status:**
   ```bash
   npx supabase migration list
   ```

### Migration Files

Migration files are located in the root `supabase/migrations/` directory:
- `0001_supabase_backend.sql` - Initial schema
- `0002_enforce_single_active_lobby.sql` - Single lobby enforcement triggers

### Troubleshooting

**Error: "Failed to get Supabase status"**
- Make sure local Supabase is running: `npx supabase start`
- Check Supabase status: `npx supabase status`

**Error: "Could not find [key] in supabase status"**
- Ensure you're using a recent version of Supabase CLI
- Try restarting local Supabase: `npx supabase stop && npx supabase start`

**Migration fails**
- Check Supabase logs: `npx supabase logs`
- Verify migration SQL syntax is correct
- Reset database if needed: `npx supabase db reset`
