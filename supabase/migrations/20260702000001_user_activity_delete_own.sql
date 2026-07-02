-- Let users remove their own activity-feed rows (swipe-to-delete on the in-app
-- "Recent" tab). Until now the only client-facing policies were select-own and
-- update-own (mark read); deletes were service-role only, so a client
-- `delete()` silently matched zero rows under RLS and the item reappeared on the
-- next fetch. This adds the missing own-rows delete policy.
--
-- Scope is identical to the existing policies: a user may only ever touch rows
-- where user_id = auth.uid(). Rows already cascade-delete with the user.

drop policy if exists "user_activity_delete_own" on public.user_activity;
create policy "user_activity_delete_own"
  on public.user_activity for delete
  using (user_id = auth.uid());
