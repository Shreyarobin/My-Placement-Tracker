-- Placement Tracker '27 — email sync status (run once, after supabase-inbox.sql)
-- Supabase → SQL Editor → New query → paste → Run.

-- One row per user: when the Gmail check last ran and what it found.
-- The tracker reads this to show "Last checked …" and to confirm a manual refresh worked.
create table if not exists public.sync_state (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last_run   timestamptz,
  last_result text,
  updated_at timestamptz not null default now()
);
alter table public.sync_state enable row level security;
drop policy if exists "own sync state" on public.sync_state;
create policy "own sync state" on public.sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
