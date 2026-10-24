-- Not applied automatically: optional speed-up. Paste into the Supabase SQL editor to apply.
-- Same rules, faster: (select auth.uid()) is worked out once per query instead of once per row.
alter policy "own profile" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "read system and own categories" on public.categories using (user_id is null or user_id = (select auth.uid()));
alter policy "write own categories" on public.categories with check (user_id = (select auth.uid()));
alter policy "update own categories" on public.categories using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "delete own categories" on public.categories using (user_id = (select auth.uid()));
do $$
declare t text;
begin
  foreach t in array array['accounts','imports','transactions','merchant_rules','budgets','goals','goal_contributions','net_worth_snapshots'] loop
    execute format('alter policy "own rows" on public.%I using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
alter policy "read own notifications" on public.notifications using (user_id = (select auth.uid()));
alter policy "mark own notifications" on public.notifications using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own push subscriptions" on public.push_subscriptions using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Indexes for lookups by category and account (moving a category's transactions, deleting an account).
create index if not exists transactions_user_category_idx on public.transactions (user_id, category_id);
create index if not exists transactions_account_idx on public.transactions (account_id) where account_id is not null;
create index if not exists transactions_import_idx on public.transactions (import_id) where import_id is not null;
create index if not exists categories_user_idx on public.categories (user_id) where user_id is not null;
