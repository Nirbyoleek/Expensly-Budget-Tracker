-- A home for spends Expensly can't identify yet, so they stop inflating Shopping.
insert into public.categories (id, name, color, kind, default_budget_paise, sort)
values ('uncat', 'Uncategorised', '#9CA3AF', 'spend', 0, 19)
on conflict (id) do nothing;
