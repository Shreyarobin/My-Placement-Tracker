-- Placement Tracker '27 — email inbox (run once, after supabase-setup.sql)
-- Supabase → SQL Editor → New query → paste → Run.

-- Parsed placement emails waiting for your approval. `id` is the Gmail message id,
-- so the same email can never be queued twice.
create table if not exists public.inbox (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.inbox enable row level security;
create policy "own inbox" on public.inbox
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists inbox_user_idx on public.inbox(user_id, created_at desc);
