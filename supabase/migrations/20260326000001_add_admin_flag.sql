-- Add is_admin column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Update RLS to allow admins to see everything (optional, but useful for admin panel)
CREATE POLICY "Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (
  (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true
);

-- Update partners RLS for admins
CREATE POLICY "Admins can manage partners"
ON public.partners
FOR ALL
USING (
  (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true
);

-- Update rewards RLS for admins
CREATE POLICY "Admins can manage rewards"
ON public.rewards
FOR ALL
USING (
  (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true
);

-- Update waitlist RLS for admins
CREATE POLICY "Admins can manage waitlist"
ON public.waitlist
FOR ALL
USING (
  (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true
);
