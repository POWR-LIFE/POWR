-- athlete_applications had two FKs to profiles with NO ACTION (default RESTRICT),
-- blocking deletion of any user who submitted or reviewed an application.
ALTER TABLE public.athlete_applications
  DROP CONSTRAINT athlete_applications_profile_id_fkey,
  DROP CONSTRAINT athlete_applications_reviewed_by_fkey;

ALTER TABLE public.athlete_applications
  ADD CONSTRAINT athlete_applications_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT athlete_applications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
