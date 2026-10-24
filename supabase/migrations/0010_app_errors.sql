-- Errors from the server, the browser, the AI and the daily job, so the owner hears about them.
-- Only the server (service role) reads or writes this.
create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null check (source in ('server', 'client', 'ai', 'cron')),
  path text,
  message text not null,
  digest text,
  user_id uuid references auth.users on delete set null
);
create index if not exists app_errors_at on public.app_errors (at desc);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
