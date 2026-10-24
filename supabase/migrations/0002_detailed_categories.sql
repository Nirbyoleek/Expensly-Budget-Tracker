-- Expensly · detailed categories (additive: nothing is dropped or deleted)

-- Subcategories are defined in lib/taxonomy.ts; each transaction can carry one.
alter table public.transactions add column if not exists subcategory_id text;
alter table public.merchant_rules add column if not exists subcategory_id text;

-- New top-level categories, and clearer names for a few existing ones.
insert into public.categories (id, name, color, kind, default_budget_paise, sort) values
  ('food', 'Food & dining', '#F2683C', 'spend', 900000, 1),
  ('groc', 'Groceries', '#2FB673', 'spend', 700000, 2),
  ('trans', 'Transport', '#3B8BF6', 'spend', 350000, 3),
  ('shop', 'Shopping', '#C25BE0', 'spend', 500000, 4),
  ('bills', 'Bills & utilities', '#7C89A8', 'spend', 1450000, 5),
  ('subs', 'Subscriptions', '#E8A00B', 'spend', 280000, 6),
  ('gym', 'Health & fitness', '#12B5B0', 'spend', 450000, 7),
  ('fun', 'Entertainment', '#E8508A', 'spend', 300000, 8),
  ('travel', 'Travel', '#0EA5E9', 'spend', 0, 9),
  ('home', 'Home & services', '#A3A635', 'spend', 0, 10),
  ('care', 'Personal care', '#F472B6', 'spend', 0, 11),
  ('edu', 'Education', '#6366F1', 'spend', 0, 12),
  ('family', 'Family & gifts', '#FB7185', 'spend', 0, 13),
  ('people', 'Sent to people', '#94A3B8', 'spend', 0, 14),
  ('fees', 'Fees & interest', '#EF4444', 'spend', 0, 15),
  ('govt', 'Taxes & government', '#64748B', 'spend', 0, 16),
  ('cash', 'Cash withdrawals', '#78716C', 'spend', 0, 17),
  ('donate', 'Donations', '#22C55E', 'spend', 0, 18),
  ('invest', 'Investments', '#7D8EFF', 'transfer', 0, 80),
  ('income', 'Income', '#3DDC97', 'income', 0, 90),
  ('xfer', 'Card payments & transfers', '#8A93A8', 'transfer', 0, 91)
on conflict (id) do update set name = excluded.name, color = excluded.color, sort = excluded.sort
  where public.categories.user_id is null;
