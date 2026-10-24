-- The AI's daily money brief, made at most once a day per person (unless they refresh it).
create table public.ai_briefs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.ai_briefs enable row level security;
create policy "own ai briefs" on public.ai_briefs
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
