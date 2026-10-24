-- First-party usage analytics: which features people use and where new users stop.
-- No third parties. Rows hold an event name and a few non-personal details (counts, kinds, page path),
-- never amounts, merchant names or anything you typed. They're deleted with your account.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]{2,40}$'),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 1024),
  at timestamptz not null default now()
);
create index if not exists events_at_idx on public.events (at desc);
create index if not exists events_user_at_idx on public.events (user_id, at desc);

alter table public.events enable row level security;
-- Signed-in people can add their own events and nothing else: no reading, changing or deleting.
create policy "add own events" on public.events for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.events from anon, authenticated;
grant insert (name, props) on public.events to authenticated;

-- The owner's numbers, worked out in the database. Only the server (service role) can call it.
create or replace function public.owner_stats(p_test_pattern text default 'e2e-%@expensly.test')
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (
    select id, created_at from auth.users where coalesce(email, '') not ilike p_test_pattern
  ),
  act as ( -- anything a person did: an event, or a transaction they added
    select user_id, at from public.events where user_id is not null
    union all
    select user_id, created_at from public.transactions where source <> 'sample'
  ),
  ua as (
    select a.user_id, a.at from act a join u on u.id = a.user_id
  ),
  tx as (
    select t.user_id, count(*) n from public.transactions t join u on u.id = t.user_id where t.source <> 'sample' group by 1
  ),
  days as (
    select user_id, count(distinct (at at time zone 'Asia/Kolkata')::date) d from ua group by 1
  ),
  fe as (
    select e.name, count(*) n, count(distinct e.user_id) people
    from public.events e left join u on u.id = e.user_id
    where e.at > now() - interval '30 days' and e.name <> 'page_view' and (e.user_id is null or u.id is not null)
    group by 1
  ),
  pv as (
    select e.props->>'path' path, count(*) n, count(distinct e.user_id) people
    from public.events e join u on u.id = e.user_id
    where e.at > now() - interval '7 days' and e.name = 'page_view'
    group by 1
  ),
  dau as (
    select g::date dt, (select count(distinct user_id) from ua where (ua.at at time zone 'Asia/Kolkata')::date = g::date) n
    from generate_series((now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') g
  )
  select jsonb_build_object(
    'users', (select count(*) from u),
    'new_7d', (select count(*) from u where created_at > now() - interval '7 days'),
    'active_1d', (select count(distinct user_id) from ua where at > now() - interval '1 day'),
    'active_7d', (select count(distinct user_id) from ua where at > now() - interval '7 days'),
    'active_30d', (select count(distinct user_id) from ua where at > now() - interval '30 days'),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'Signed up', 'n', (select count(*) from u)),
      jsonb_build_object('step', 'Added a transaction', 'n', (select count(*) from tx)),
      jsonb_build_object('step', '10 or more transactions', 'n', (select count(*) from tx where n >= 10)),
      jsonb_build_object('step', 'Set a budget', 'n', (select count(distinct b.user_id) from public.budgets b join u on u.id = b.user_id where b.limit_paise > 0)),
      jsonb_build_object('step', 'Came back on another day', 'n', (select count(*) from days where d >= 2)),
      jsonb_build_object('step', 'Active in the last 7 days', 'n', (select count(distinct user_id) from ua where at > now() - interval '7 days'))
    ),
    'features', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'n', n, 'people', people) order by n desc) from fe), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'n', n, 'people', people) order by n desc) from (select * from pv order by n desc limit 12) p), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', dt, 'n', n) order by dt) from dau), '[]'::jsonb),
    'deleted_30d', (select count(*) from public.events where name = 'account_deleted' and at > now() - interval '30 days')
  )
$$;
revoke all on function public.owner_stats(text) from public, anon, authenticated;
grant execute on function public.owner_stats(text) to service_role;
