CREATE OR REPLACE FUNCTION public._gym_visit_radius_m(p_partner_id uuid, p_region_id text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_idx int := coalesce(((regexp_match(coalesce(p_region_id, ''), '-(\d+)$'))[1])::int, 0);
  v_radius numeric;
begin
  select coalesce(
           (p.locations -> v_idx ->> 'radius')::numeric,
           (p.locations -> 0    ->> 'radius')::numeric
         )
    into v_radius
    from partners p
   where p.id = p_partner_id;

  return coalesce(v_radius, 100);
exception when others then
  return 100;
end;
$function$
