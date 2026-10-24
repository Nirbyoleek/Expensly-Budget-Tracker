-- Shared, anonymous lookup of merchant name -> category, filled by the AI at import time.
-- Holds business names only (never people, amounts or user ids), so every user benefits
-- and each merchant is only ever looked up once. Read and written by the server (service role) only.
create table if not exists public.merchant_ai_cache (
  key text primary key check (char_length(key) between 3 and 80),
  category_id text not null references public.categories(id),
  subcategory_id text,
  confidence real not null default 0.8 check (confidence between 0 and 1),
  model text,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.merchant_ai_cache enable row level security;
-- no policies: anon and signed-in users can't read or write it directly
revoke all on public.merchant_ai_cache from anon, authenticated;

create or replace function public.merchant_ai_cache_hit(p_keys text[])
returns void language sql security invoker set search_path = public as $$
  update public.merchant_ai_cache set hits = hits + 1 where key = any(p_keys);
$$;
revoke all on function public.merchant_ai_cache_hit(text[]) from public, anon, authenticated;
grant execute on function public.merchant_ai_cache_hit(text[]) to service_role;
