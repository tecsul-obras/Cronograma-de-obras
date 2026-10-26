-- SQL 59 (aplicado 2026-10-26)
-- 1) El formulario de taller (v20261016g) manda la medición con texto largo
--    ('Horómetro (Horas máquina)', 'Kilometraje (Odómetro - Solo livianos)',
--    'Servicios Generales - Trabajos en taller'), que viola otr_medicion_valida
--    y ot_medicion_valida. Ningún "Registro de Trabajos - OT" entraba desde el 14/10.
--    ot_registrar ahora normaliza la medición (también lo hace el cliente, equipos-v63).
-- 2) Los reintentos suben de nuevo firma/fotos con upsert: sin policy de UPDATE
--    en storage el reintento daba 400 (RLS) y la app lo mostraba como "señal débil".

create or replace function public.norm_medicion(t text)
returns text language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then null
    when t ilike 'hor%' then 'Horómetro'
    when t ilike '%od_metro%' or t ilike 'kilometr%' then 'Odómetro'
    else null
  end
$$;

create or replace function public.norm_medicion_payload(p jsonb)
returns jsonb language plpgsql immutable as $$
begin
  if p ? 'tipo_medicion' then
    p := jsonb_set(p, '{tipo_medicion}', coalesce(to_jsonb(public.norm_medicion(p->>'tipo_medicion')), 'null'::jsonb));
  end if;
  if jsonb_typeof(p->'ot_nueva') = 'object' and (p->'ot_nueva') ? 'tipo_medicion' then
    p := jsonb_set(p, '{ot_nueva,tipo_medicion}', coalesce(to_jsonb(public.norm_medicion(p->'ot_nueva'->>'tipo_medicion')), 'null'::jsonb));
  end if;
  return p;
end $$;

-- Inserta la normalización al comienzo de ot_registrar (sin reescribir el resto)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.ot_registrar(jsonb)'::regprocedure);
  if position('norm_medicion_payload' in d) > 0 then return; end if;
  n := replace(d, E'begin\n  if auth.uid() is null then',
    E'begin\n  -- SQL 59: medición normalizada (textos largos del formulario)\n  p := public.norm_medicion_payload(p);\n  v_nueva := p->''ot_nueva'';\n  if auth.uid() is null then');
  if n = d then raise exception 'No se encontró el punto de inserción en ot_registrar'; end if;
  execute n;
end $$;

drop policy if exists taller_reemplaza on storage.objects;
create policy taller_reemplaza on storage.objects for update to authenticated
  using (bucket_id = 'taller' and owner = auth.uid())
  with check (bucket_id = 'taller' and owner = auth.uid());

drop policy if exists combustible_reemplaza on storage.objects;
create policy combustible_reemplaza on storage.objects for update to authenticated
  using (bucket_id = 'combustible' and owner = auth.uid())
  with check (bucket_id = 'combustible' and owner = auth.uid());

drop policy if exists partes_reemplaza on storage.objects;
create policy partes_reemplaza on storage.objects for update to authenticated
  using (bucket_id = 'partes' and owner = auth.uid())
  with check (bucket_id = 'partes' and owner = auth.uid());
