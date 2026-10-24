-- Per-person AI limits, enforced inside the database.
-- People can read their own usage and limits but can't write them; only these functions can.

alter table public.ai_usage
  add column if not exists minute_start timestamptz,
  add column if not exists minute_count int not null default 0;

-- People can still read their usage; only the functions below can change it.
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- Optional per-person overrides, set by the app owner in the Supabase dashboard.
create table if not exists public.ai_limits (
  user_id uuid primary key references auth.users on delete cascade,
  enabled boolean not null default true,
  daily_questions int check (daily_questions >= 0),
  per_minute int check (per_minute >= 0),
  monthly_tokens bigint check (monthly_tokens >= 0),
  note text,
  updated_at timestamptz not null default now()
);
alter table public.ai_limits enable row level security;
create policy "read own ai limits" on public.ai_limits for select using (user_id = (select auth.uid()));
revoke insert, update, delete on public.ai_limits from anon, authenticated;

-- Claims one question for the signed-in person if they're within every limit.
-- Defaults come from the server; an ai_limits row overrides them.
create or replace function public.ai_take_quota(p_day date, p_daily int, p_per_minute int, p_monthly_tokens bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim public.ai_limits%rowtype;
  daily int := p_daily;
  per_min int := p_per_minute;
  monthly bigint := p_monthly_tokens;
  r public.ai_usage%rowtype;
  month_tokens bigint;
  now_ts timestamptz := now();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;

  select * into lim from public.ai_limits where user_id = uid;
  if found then
    if not lim.enabled then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
    daily := coalesce(lim.daily_questions, daily);
    per_min := coalesce(lim.per_minute, per_min);
    monthly := coalesce(lim.monthly_tokens, monthly);
  end if;

  insert into public.ai_usage (user_id, day) values (uid, p_day) on conflict (user_id, day) do nothing;
  select * into r from public.ai_usage where user_id = uid and day = p_day for update;

  if daily is not null and r.questions >= daily then
    return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', daily);
  end if;

  if per_min is not null then
    if r.minute_start is null or now_ts - r.minute_start >= interval '60 seconds' then
      r.minute_start := now_ts; r.minute_count := 0;
    end if;
    if r.minute_count >= per_min then
      return jsonb_build_object('ok', false, 'reason', 'minute', 'limit', per_min,
        'retry_in', greatest(1, ceil(extract(epoch from (r.minute_start + interval '60 seconds' - now_ts)))::int));
    end if;
  end if;

  if monthly is not null then
    select coalesce(sum(input_tokens + output_tokens), 0) into month_tokens
      from public.ai_usage where user_id = uid and day >= date_trunc('month', p_day)::date;
    if month_tokens >= monthly then
      return jsonb_build_object('ok', false, 'reason', 'monthly', 'limit', monthly);
    end if;
  end if;

  update public.ai_usage
     set questions = r.questions + 1, minute_start = r.minute_start, minute_count = r.minute_count + 1
   where user_id = uid and day = p_day;

  return jsonb_build_object('ok', true, 'left_today', case when daily is null then null else daily - r.questions - 1 end);
end $$;

-- Adds the tokens a question used, after it's answered.
create or replace function public.ai_record_tokens(p_day date, p_input int, p_output int)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set input_tokens = input_tokens + greatest(0, least(p_input, 2000000)),
         output_tokens = output_tokens + greatest(0, least(p_output, 2000000))
   where user_id = auth.uid() and day = p_day;
$$;

revoke all on function public.ai_take_quota(date, int, int, bigint) from public, anon;
revoke all on function public.ai_record_tokens(date, int, int) from public, anon;
grant execute on function public.ai_take_quota(date, int, int, bigint) to authenticated;
grant execute on function public.ai_record_tokens(date, int, int) to authenticated;
