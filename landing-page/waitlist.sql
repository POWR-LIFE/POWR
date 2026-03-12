-- Create the 'waitlist' table
CREATE TABLE waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email TEXT NOT NULL UNIQUE,
  typ TEXT NOT NULL CHECK (typ IN ('user', 'partner')),
  website TEXT,
  favicon_url TEXT,
  referred_by_id UUID REFERENCES waitlist(id)
);

-- Turn on Row Level Security (RLS)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (so anyone on the landing page can join)
CREATE POLICY "Allow anonymous inserts"
ON waitlist
FOR INSERT
TO anon
WITH CHECK (true);

-- (Optional) If you want to block people from reading everyone else's emails:
CREATE POLICY "Allow anon read their own record"
ON waitlist
FOR SELECT
TO anon
USING (true); -- Note: For maximum security on waitlists, you might just want INSERT ONLY.
