-- Each person's own AI key (Gemini, OpenAI, Groq, Claude, OpenRouter), encrypted by the server
-- with AES-256-GCM before it's stored. The plain key never goes back to the browser.
create table public.ai_connections (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  provider text not null check (provider in ('gemini', 'openai', 'groq', 'anthropic', 'openrouter')),
  key_ciphertext text not null,
  key_hint text not null,
  model text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_connections enable row level security;

create policy "own ai connection" on public.ai_connections
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
