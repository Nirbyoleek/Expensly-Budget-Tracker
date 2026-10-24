-- How many Ask Expensly questions each person asked per day, to cap API spend.
create table public.ai_usage (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  questions int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

create policy "own ai usage" on public.ai_usage
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
