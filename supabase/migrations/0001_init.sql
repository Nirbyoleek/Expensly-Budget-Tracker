-- Expensly · initial schema
-- Run once in Supabase → SQL Editor (or `supabase db push`).
-- Every amount is stored in paise (bigint). Negative = money out.

create extension if not exists pgcrypto;

-- ───────────────────────── profiles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  month_start_day int not null default 1 check (month_start_day between 1 and 28),
  ingest_token_hash text unique,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name) values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── categories ─────────────────────────
-- System categories have user_id null and are readable by everyone.
create table public.categories (
  id text primary key,
  user_id uuid references auth.users on delete cascade,
  name text not null,
  color text not null,
  kind text not null check (kind in ('spend', 'income', 'transfer')),
  default_budget_paise bigint not null default 0,
  sort int not null default 0
);

insert into public.categories (id, name, color, kind, default_budget_paise, sort) values
  ('food',   'Food & dining',  '#F2683C', 'spend',     900000, 1),
  ('groc',   'Groceries',      '#2FB673', 'spend',     700000, 2),
  ('trans',  'Transport',      '#3B8BF6', 'spend',     350000, 3),
  ('shop',   'Shopping',       '#C25BE0', 'spend',     500000, 4),
  ('bills',  'Bills & rent',   '#7C89A8', 'spend',    1450000, 5),
  ('subs',   'Subscriptions',  '#E8A00B', 'spend',     280000, 6),
  ('gym',    'Gym & health',   '#12B5B0', 'spend',     450000, 7),
  ('fun',    'Going out',      '#E8508A', 'spend',     300000, 8),
  ('income', 'Income',         '#3DDC97', 'income',         0, 90),
  ('xfer',   'Transfer',       '#8A93A8', 'transfer',       0, 91);

-- ───────────────────────── accounts ─────────────────────────
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('bank', 'card', 'investment', 'cash', 'loan')),
  balance_paise bigint not null default 0,
  last4 text check (last4 ~ '^[0-9]{4}$'),
  is_sample boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ───────────────────────── imports ─────────────────────────
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  file_name text,
  file_kind text check (file_kind in ('csv', 'pdf', 'text', 'sms')),
  row_count int not null default 0,
  added_count int not null default 0,
  skipped_count int not null default 0,
  created_at timestamptz not null default now()
);

-- ───────────────────────── transactions ─────────────────────────
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid references public.accounts on delete set null,
  date date not null,
  amount_paise bigint not null check (amount_paise <> 0),
  merchant_raw text,
  merchant_name text not null check (char_length(merchant_name) between 1 and 80),
  category_id text not null references public.categories,
  source text not null default 'manual' check (source in ('manual', 'sms', 'shortcut', 'import', 'sample')),
  reviewed boolean not null default false,
  dedupe_hash text,
  import_id uuid references public.imports on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_hash)          -- nulls never collide, so manual entries are never blocked
);

create index transactions_user_date on public.transactions (user_id, date desc);
create index transactions_user_cat_date on public.transactions (user_id, category_id, date);
create index transactions_unreviewed on public.transactions (user_id) where reviewed = false;

-- ───────────────────────── merchant rules ─────────────────────────
create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pattern text not null,                 -- lower-case merchant name
  category_id text not null references public.categories,
  rename_to text,
  created_at timestamptz not null default now(),
  unique (user_id, pattern)
);

-- ───────────────────────── budgets ─────────────────────────
-- One row per category per month. The latest row on or before a month applies (carry-forward).
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  category_id text not null references public.categories,
  month date not null check (extract(day from month) = 1),
  limit_paise bigint not null check (limit_paise >= 0),
  unique (user_id, category_id, month)
);

-- ───────────────────────── goals ─────────────────────────
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  target_paise bigint not null check (target_paise > 0),
  saved_paise bigint not null default 0 check (saved_paise >= 0),
  target_date date,
  color text not null default '#7D8EFF',
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references public.goals on delete cascade,
  amount_paise bigint not null,
  date date not null default current_date
);

-- ───────────────────────── net worth snapshots ─────────────────────────
create table public.net_worth_snapshots (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null check (extract(day from month) = 1),
  assets_paise bigint not null,
  liabilities_paise bigint not null,
  primary key (user_id, month)
);

-- ───────────────────────── row-level security ─────────────────────────
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.imports enable row level security;
alter table public.transactions enable row level security;
alter table public.merchant_rules enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.net_worth_snapshots enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "read system and own categories" on public.categories
  for select using (user_id is null or user_id = auth.uid());
create policy "write own categories" on public.categories
  for insert with check (user_id = auth.uid());
create policy "update own categories" on public.categories
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own categories" on public.categories
  for delete using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['accounts','imports','transactions','merchant_rules','budgets','goals','goal_contributions','net_worth_snapshots'] loop
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
