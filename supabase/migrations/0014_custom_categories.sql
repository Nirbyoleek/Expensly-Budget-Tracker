-- Your own categories: a group (need / want / avoidable) so they count in the needs-vs-wants split,
-- and a cap so nobody fills the table.
alter table public.categories
  add column if not exists grp text check (grp in ('needs', 'wants', 'avoidable'));

alter table public.categories drop constraint if exists categories_name_len;
alter table public.categories add constraint categories_name_len check (char_length(name) between 1 and 40);

create or replace function public.limit_own_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and (select count(*) from public.categories where user_id = new.user_id) >= 30 then
    raise exception 'You can have up to 30 of your own categories.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.limit_own_categories() from public, anon, authenticated;

drop trigger if exists limit_own_categories on public.categories;
create trigger limit_own_categories before insert on public.categories
  for each row execute function public.limit_own_categories();
