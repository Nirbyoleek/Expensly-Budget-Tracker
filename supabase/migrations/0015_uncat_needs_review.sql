-- An uncategorised transaction always waits in "To review" until it's given a real category,
-- whichever way it arrived (import, SMS, quick add, edit, re-categorise).
create or replace function public.uncat_needs_review()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.category_id = 'uncat' then
    new.reviewed := false;
  end if;
  return new;
end $$;
revoke all on function public.uncat_needs_review() from public, anon, authenticated;

drop trigger if exists uncat_needs_review on public.transactions;
create trigger uncat_needs_review before insert or update of category_id, reviewed on public.transactions
  for each row execute function public.uncat_needs_review();

update public.transactions set reviewed = false where category_id = 'uncat' and reviewed;
