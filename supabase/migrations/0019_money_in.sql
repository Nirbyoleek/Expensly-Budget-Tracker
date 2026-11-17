-- Money you got from somewhere other than your salary (freelance, a gift, selling something…)
-- can count towards this month's budget, so "safe to spend" grows with it.
alter table public.transactions
  add column if not exists adds_to_budget boolean not null default false;

-- Only money coming in can add to the budget.
alter table public.transactions drop constraint if exists transactions_adds_to_budget_in;
alter table public.transactions add constraint transactions_adds_to_budget_in check (not adds_to_budget or amount_paise > 0);
