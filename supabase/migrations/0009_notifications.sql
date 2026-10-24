-- Reminders: what to tell people, where to push it, and what they want to hear about.

alter table public.profiles
  add column if not exists notify_budget boolean not null default true,
  add column if not exists notify_bills boolean not null default true,
  add column if not exists notify_weekly boolean not null default true,
  add column if not exists onboarding_dismissed boolean not null default false;

-- One row per message. `key` makes each reminder happen once (e.g. "budget80:food:2026-10-01").
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  title text not null,
  body text not null,
  url text not null default '/home',
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  read_at timestamptz,
  unique (user_id, key)
);
create index if not exists notifications_user_recent on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "read own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "mark own notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- inserts come from the server's daily job only
revoke insert, delete on public.notifications from anon, authenticated;
revoke update on public.notifications from anon;
revoke update on public.notifications from authenticated;
grant update (read_at, shown_at) on public.notifications to authenticated;

-- Browser push endpoints, one per device.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
