-- Placement Tracker '27 — Supabase setup
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

-- Applications (one row per company you track; the page's JSON lives in `data`)
create table if not exists public.applications (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.applications enable row level security;
create policy "own applications" on public.applications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists applications_user_idx on public.applications(user_id);

-- Profile (branch, CGPA, …)
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket for resume PDFs; each user can only touch files under their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;
create policy "own resumes" on storage.objects
  for all using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
