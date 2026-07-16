-- Partner-portal tickets carry the brand they belong to; app tickets leave it NULL.
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS brand_name text;
