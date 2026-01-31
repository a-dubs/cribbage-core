# Local Supabase Quick Reference

## Setup & Testing Flow

```bash
# 1. Stop other Supabase instances (if running)
cd /Users/a-dubs/client-portal/client-portal-app && npx supabase stop

# 2. Start local Supabase (from repo root)
cd /Users/a-dubs/personal/cribbage
npx supabase start

# 3. Populate .env with local credentials (from cribbage-core)
cd cribbage-core
pnpm run env:local

# 4. Test migrations (from repo root)
cd /Users/a-dubs/personal/cribbage
npx supabase migration up
```

## Key Commands

- `pnpm run env:local` - Update `.env` with local Supabase credentials
- `npx supabase start` - Start local Supabase (from root)
- `npx supabase stop` - Stop local Supabase
- `npx supabase status` - Check status and get credentials
- `npx supabase migration up` - Apply pending migrations
- `npx supabase db reset` - Reset database (applies all migrations)
- `npx supabase migration list` - List migration status

## Notes

- **Only one Supabase instance can run at a time** (fixed ports)
- Script runs `supabase status` from root directory
- Script updates `.env` in `cribbage-core/` directory
- Migrations are in `supabase/migrations/` directory

## Troubleshooting

**Port conflict:** Stop other Supabase instances first
**Migration fails:** Check `supabase/migrations/` for SQL errors
**Script fails:** Ensure Supabase is running (`npx supabase start`)

See `local-supabase-testing.md` for detailed guide.
