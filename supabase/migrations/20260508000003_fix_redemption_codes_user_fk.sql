-- redemption_codes.assigned_user_id had no ON DELETE action (RESTRICT by
-- default), which blocks deleting a user who has any assigned codes.
-- Change to SET NULL so deleting a user leaves orphaned codes available for
-- reassignment rather than preventing the delete.
ALTER TABLE public.redemption_codes
  DROP CONSTRAINT IF EXISTS redemption_codes_assigned_user_id_fkey;

ALTER TABLE public.redemption_codes
  ADD CONSTRAINT redemption_codes_assigned_user_id_fkey
    FOREIGN KEY (assigned_user_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;
