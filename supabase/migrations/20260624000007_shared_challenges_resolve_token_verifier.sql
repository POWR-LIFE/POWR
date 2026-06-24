-- Validates the cron's x-resolve-token against the Vault secret without ever
-- exposing the secret to the edge runtime. resolve-shared-challenges calls this
-- with the service role.
--
-- Operator step (out of band, NOT committed): mint a token and store it in Vault:
--   select vault.create_secret('<token>', 'shared_resolve_token');
-- The cron job (next migration) reads the same secret to send the header.
create or replace function public.verify_resolve_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'shared_resolve_token' and decrypted_secret = p_token
  );
$$;

revoke execute on function public.verify_resolve_token(text) from public, anon, authenticated;
grant execute on function public.verify_resolve_token(text) to service_role;
