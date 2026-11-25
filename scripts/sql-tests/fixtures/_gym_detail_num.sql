CREATE OR REPLACE FUNCTION public._gym_detail_num(p_detail jsonb, p_key text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  return nullif(p_detail ->> p_key, '')::numeric;
exception when others then
  return null;
end;
$function$
