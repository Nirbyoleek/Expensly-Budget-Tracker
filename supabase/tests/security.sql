-- Database security tests: row-level security, column grants and server-only tables.
--
-- Run in the Supabase SQL editor (or psql) as the postgres role. Everything happens inside a
-- transaction that is rolled back, so no data is left behind. Any failed check stops with an
-- error naming it; success ends with the row "all security checks passed".

begin;

-- two throwaway users (the sign-up trigger also gives each a profile)
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-00000000000a', 'alice-test@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-00000000000b', 'bob-test@example.invalid', 'authenticated', 'authenticated');

insert into public.transactions (user_id, date, amount_paise, merchant_name, category_id, source) values
  ('00000000-0000-4000-a000-00000000000a', '2026-10-01', -34000, 'Swiggy', 'food', 'import'),
  ('00000000-0000-4000-a000-00000000000b', '2026-10-01', -99900, 'Bob secret', 'shop', 'import');
insert into public.notifications (user_id, key, title, body) values
  ('00000000-0000-4000-a000-00000000000a', 'test:a', 'For Alice', 'hi'),
  ('00000000-0000-4000-a000-00000000000b', 'test:b', 'For Bob', 'hi');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('00000000-0000-4000-a000-00000000000b', 'https://push.example.invalid/bob', 'p256dh-key-bob', 'auth-bob');
insert into public.budgets (user_id, category_id, month, limit_paise) values
  ('00000000-0000-4000-a000-00000000000b', 'food', '2026-10-01', 500000);

-- from here on, act as Alice through the API role
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);

do $$
declare n int;
begin
  -- 1. reading: only your own rows
  select count(*) into n from public.transactions;
  assert n = 1, 'transactions: Alice can see other users'' transactions';
  select count(*) into n from public.transactions where merchant_name = 'Bob secret';
  assert n = 0, 'transactions: Bob''s row is visible to Alice';
  select count(*) into n from public.notifications;
  assert n = 1, 'notifications: Alice can see other users'' notifications';
  select count(*) into n from public.push_subscriptions;
  assert n = 0, 'push_subscriptions: Alice can see Bob''s device';
  select count(*) into n from public.budgets;
  assert n = 0, 'budgets: Alice can see Bob''s budgets';
  select count(*) into n from public.profiles;
  assert n = 1, 'profiles: Alice can see other profiles';

  -- 2. writing: can't touch other people's rows
  update public.transactions set merchant_name = 'hacked' where merchant_name = 'Bob secret';
  get diagnostics n = row_count;
  assert n = 0, 'transactions: Alice updated Bob''s transaction';
  delete from public.budgets where user_id = '00000000-0000-4000-a000-00000000000b';
  get diagnostics n = row_count;
  assert n = 0, 'budgets: Alice deleted Bob''s budget';

  begin
    insert into public.transactions (user_id, date, amount_paise, merchant_name, category_id) values ('00000000-0000-4000-a000-00000000000b', '2026-10-02', -100, 'planted', 'food');
    raise exception 'FAILED transactions: Alice inserted a row as Bob';
  exception when insufficient_privilege then null;
  end;

  -- 3. notifications are written by the server only; users may only mark them read
  begin
    insert into public.notifications (user_id, key, title, body) values ('00000000-0000-4000-a000-00000000000a', 'fake', 'Fake', 'x');
    raise exception 'FAILED notifications: users can create notifications';
  exception when insufficient_privilege then null;
  end;
  update public.notifications set read_at = now() where key = 'test:a';
  get diagnostics n = row_count;
  assert n = 1, 'notifications: Alice cannot mark her own notification read';
  begin
    update public.notifications set title = 'Changed' where key = 'test:a';
    raise exception 'FAILED notifications: users can rewrite notification text';
  exception when insufficient_privilege then null;
  end;

  -- 4. server-only tables are closed to signed-in users
  begin
    perform 1 from public.app_errors limit 1;
    raise exception 'FAILED app_errors: readable by users';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.merchant_ai_cache limit 1;
    raise exception 'FAILED merchant_ai_cache: readable by users';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.merchant_ai_cache (key, category_id) values ('poisoned shop', 'food');
    raise exception 'FAILED merchant_ai_cache: writable by users';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_usage (user_id, day, questions) values ('00000000-0000-4000-a000-00000000000a', '2026-09-01', 0);
    raise exception 'FAILED ai_usage: users can write their own AI usage';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.merchant_ai_cache_hit(array['x']);
    raise exception 'FAILED merchant_ai_cache_hit: callable by users';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 5. AI quota: enforced in the database, so the browser can't skip it
do $$
declare r jsonb;
begin
  r := public.ai_take_quota('2026-10-01', 2, 100, 1000000);
  assert (r->>'ok')::boolean, 'ai_take_quota: first request refused';
  r := public.ai_take_quota('2026-10-01', 2, 100, 1000000);
  assert (r->>'ok')::boolean, 'ai_take_quota: second request refused';
  r := public.ai_take_quota('2026-10-01', 2, 100, 1000000);
  assert not (r->>'ok')::boolean and r->>'reason' = 'daily', 'ai_take_quota: daily limit not enforced';
  begin
    update public.ai_usage set questions = 0;
    raise exception 'FAILED ai_usage: users can reset their usage to dodge the limit';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. signed-out visitors see nothing
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.transactions;
  assert n = 0, 'anon: transactions visible without signing in';
  select count(*) into n from public.notifications;
  assert n = 0, 'anon: notifications visible without signing in';
exception when insufficient_privilege then null; -- no access at all is fine too
end $$;

reset role;
select 'all security checks passed' as result;
rollback;
