-- The months a user has transactions in, for the month picker and Month in review.
-- security invoker: row-level security limits it to the caller's own rows.
create or replace function public.tx_months()
returns table (month date, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('month', date)::date as month, count(*) as n
  from public.transactions
  where user_id = auth.uid()
  group by 1
  order by 1 desc
$$;

revoke all on function public.tx_months() from public, anon;
grant execute on function public.tx_months() to authenticated;
