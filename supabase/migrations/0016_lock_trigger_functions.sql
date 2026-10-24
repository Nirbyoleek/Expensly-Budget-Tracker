-- Trigger functions run on their own; nobody needs to call them through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.limit_own_categories() from public, anon, authenticated;
revoke execute on function public.uncat_needs_review() from public, anon, authenticated;
