-- Add AFFILIATE to integration type enum.
-- Affiliate rewards use a shared URL (no unique per-user code).
ALTER TYPE public.reward_integration_type ADD VALUE IF NOT EXISTS 'AFFILIATE';
