-- 114 · Plantas: regla en centímetros y gasoil de la caldera de la PA-01 medido como altura de gasoil (13/11/2026)
-- Cambio de forma de medición: el gasoil de la caldera se mide en cm de gasoil (stock), ya no el vacío desde arriba.
-- Las lecturas ya cargadas no cambian: guardan sus litros.
-- Se puede correr dos veces.

alter table public.planta_tanques add column if not exists unidad_regla text not null default 'm';
alter table public.planta_tanques drop constraint if exists planta_tanques_unidad_regla_chk;
alter table public.planta_tanques add constraint planta_tanques_unidad_regla_chk check (unidad_regla in ('m', 'cm'));

-- Caldera PA-01: prisma de sección cuadrada 0,69 × 0,69 m acostado, largo 2,30 m → 15,87 L por cm, 1.095 L lleno.
-- Tabla altura de gasoil (m) → litros, cada 1 cm de 0 a 69 cm.
update public.planta_tanques t
   set modo_lectura = 'stock',
       unidad_regla = 'cm',
       forma = 'tabla',
       altura_m = 0.69,
       tabla = (select jsonb_agg(jsonb_build_array(round(h / 100.0, 2), round(h / 100.0 * 0.69 * 2.30 * 1000, 1)) order by h)
                  from generate_series(0, 69) h),
       notas = 'Prisma de sección cuadrada 0,69 × 0,69 m, acostado, largo 2,30 m (1.095 L, 15,87 L/cm). Se mide la altura de gasoil en cm (desde el 13/11/2026; antes, vacío desde arriba).',
       actualizado_en = now()
 where t.planta_id = 'PA-01' and t.insumo = 'gasoil';

select id, nombre, modo_lectura, unidad_regla, altura_m, jsonb_array_length(tabla) puntos, tabla -> 30 a_30cm, tabla -> -1 lleno
  from public.planta_tanques where planta_id = 'PA-01' order by orden;
