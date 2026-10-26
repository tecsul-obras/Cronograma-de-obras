-- ══════════════════════════════════════════════════════════════════
-- 56 · Alquileres — varios archivos por factura
--
-- Cada factura anexada puede tener varios archivos, cada uno con su tipo
-- (Factura, Certificado firmado, Remisión, Otro). Se guardan en la columna
-- nueva "archivos" (lista jsonb de {ruta, nombre, tipo, subido_en}); los
-- archivos siguen en el bucket privado "alquileres".
--
-- Las columnas viejas archivo / archivo_nombre quedan (con el primer
-- archivo) para no romper nada. Se puede correr más de una vez.
-- Sin cambios de permisos: usa las políticas de alquiler_facturas (SQL 48).
-- ══════════════════════════════════════════════════════════════════

alter table public.alquiler_facturas
  add column if not exists archivos jsonb not null default '[]'::jsonb;

-- Pasar el archivo único de las facturas ya anexadas a la lista nueva
update public.alquiler_facturas
   set archivos = jsonb_build_array(jsonb_build_object(
         'ruta', archivo, 'nombre', coalesce(archivo_nombre, 'archivo'), 'tipo', 'Factura'))
 where archivo is not null
   and (archivos is null or archivos = '[]'::jsonb);

-- Verificación
select id, nro_factura, jsonb_array_length(archivos) as n_archivos from public.alquiler_facturas order by id;
