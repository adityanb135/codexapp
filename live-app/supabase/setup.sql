-- Run this in Supabase SQL Editor.
-- 1) Create one table to persist the app state per user.

create table if not exists public.erp_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_json jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.erp_state enable row level security;

-- 2) Users can only read/write their own row.
drop policy if exists "select own erp state" on public.erp_state;
drop policy if exists "insert own erp state" on public.erp_state;
drop policy if exists "update own erp state" on public.erp_state;
drop policy if exists "delete own erp state" on public.erp_state;

create policy "select own erp state"
on public.erp_state for select
to authenticated
using (auth.uid() = user_id);

create policy "insert own erp state"
on public.erp_state for insert
to authenticated
with check (auth.uid() = user_id);

create policy "update own erp state"
on public.erp_state for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "delete own erp state"
on public.erp_state for delete
to authenticated
using (auth.uid() = user_id);
