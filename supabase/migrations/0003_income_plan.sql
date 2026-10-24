-- Your expected monthly income. A row applies from its month until a later row replaces it,
-- so a raise in March doesn't rewrite January.
create table public.income_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null check (extract(day from month) = 1),
  salary_paise bigint not null default 0 check (salary_paise >= 0),
  other_paise bigint not null default 0 check (other_paise >= 0),
  payday smallint check (payday between 1 and 31),
  savings_goal_pct smallint not null default 20 check (savings_goal_pct between 0 and 90),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

alter table public.income_plans enable row level security;

create policy "own income plans" on public.income_plans
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
