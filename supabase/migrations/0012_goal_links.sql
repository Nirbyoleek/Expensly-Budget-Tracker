-- Goals that fill themselves from your SIPs/investments or payments to one payee.
alter table public.goals
  add column if not exists link_kind text check (link_kind in ('invest', 'payee')),
  add column if not exists link_value text check (link_value is null or char_length(link_value) between 2 and 60),
  add column if not exists link_from date;
