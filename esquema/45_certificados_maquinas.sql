-- =========================================================================
-- 45_certificados_maquinas.sql · v20261016a  (Equipos: certificado formal)
-- Tecsul S.A.E.
--
-- Certificados de maquinarias guardados y numerados por obra, con el
-- formato de "Formato de Certificados.xlsx" (Estándar, Horas mínimas,
-- Volumen mínimo). Se pueden volver a correr sin problema.
--
--  · cert_maq: un certificado = cabecera + items (jsonb) + descuentos
--    (jsonb) + columnas elegidas (jsonb). El "anterior" de cada línea
--    sale del certificado previo de la misma obra (lo calcula la app).
--  · Número único por obra. Estado: borrador → emitido (emitido no se
--    edita; admin lo puede reabrir).
--  · Lee: admin_central y gerente. Escribe: solo admin_central.
--  · v_cert_maq_items: una fila por línea, para Power BI.
--
-- Requiere: obras, es_admin(), mi_rol() (ya están).
-- Para volver atrás: bloque REVERTIR al final.
-- =========================================================================

create table if not exists public.cert_maq (
  id              bigint generated always as identity primary key,
  obra_clave      text not null references public.obras(clave) on update cascade,
  numero          int  not null check (numero > 0),
  desde           date not null,
  hasta           date not null,
  plantilla       text not null default 'estandar' check (plantilla in ('estandar', 'horas_minimas', 'volumen_minimo')),
  columnas        jsonb not null default '[]'::jsonb,   -- claves de columnas visibles, en orden
  opciones        jsonb not null default '{}'::jsonb,   -- {calc_aux, desc_comb, ...}
  titulo          text not null default 'CERTIFICADO DE MAQUINARIAS',
  obra_titulo     text,                                 -- "OBRA DEPARTAMENTAL 027 - OBRAS"
  rubro           text,
  ubicacion       text,
  cliente         text,
  ruc             text,
  items           jsonb not null default '[]'::jsonb,
  descuentos      jsonb not null default '[]'::jsonb,   -- [{texto, monto}] monto > 0 resta, < 0 suma
  anexo_diario    boolean not null default true,        -- imprimir informe diario por equipo
  notas           text,
  firmas          jsonb not null default '["HECHO POR", "AUTORIZACIÓN - TALLER CENTRAL", "V° B° CLIENTE"]'::jsonb,
  total_cert      numeric not null default 0,           -- presente certificado (IVA incluido)
  total_desc      numeric not null default 0,
  total_cobrar    numeric not null default 0,
  estado          text not null default 'borrador' check (estado in ('borrador', 'emitido', 'anulado')),
  creado_por      uuid default auth.uid(),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  emitido_en      timestamptz,
  constraint cert_maq_periodo check (hasta >= desde),
  constraint cert_maq_numero_unico unique (obra_clave, numero)
);
alter table public.cert_maq add column if not exists opciones jsonb not null default '{}'::jsonb;
create index if not exists cert_maq_obra on public.cert_maq (obra_clave, numero desc);

alter table public.cert_maq enable row level security;

drop policy if exists cert_maq_lee on public.cert_maq;
create policy cert_maq_lee on public.cert_maq for select to authenticated
  using ((select public.es_admin()) or coalesce((select public.mi_rol())::text, '') = 'gerente');

drop policy if exists cert_maq_escribe on public.cert_maq;
create policy cert_maq_escribe on public.cert_maq for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- Un emitido no se cambia salvo para reabrirlo (volver a borrador) o anularlo
create or replace function public.cert_maq_proteger() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'emitido' then raise exception 'El certificado N° % está emitido: reabrilo antes de borrarlo', old.numero; end if;
    return old;
  end if;
  if old.estado = 'emitido' and new.estado = 'emitido' then
    raise exception 'El certificado N° % está emitido: reabrilo para editarlo', old.numero;
  end if;
  new.actualizado_en := now();
  if new.estado = 'emitido' and old.estado is distinct from 'emitido' then new.emitido_en := now(); end if;
  return new;
end $$;
drop trigger if exists trg_cert_maq_proteger on public.cert_maq;
create trigger trg_cert_maq_proteger before update or delete on public.cert_maq
  for each row execute function public.cert_maq_proteger();

-- Una fila por línea (Power BI / consultas)
create or replace view public.v_cert_maq_items with (security_invoker = true) as
select c.id as cert_id, c.obra_clave, o.nombre as obra_nombre, c.numero, c.desde, c.hasta, c.estado, c.cliente, c.ruc,
       (i.ord)::int as orden, i.x->>'codigo' as codigo, i.x->>'descripcion' as descripcion, i.x->>'unidad' as unidad,
       (i.x->>'trabajado')::numeric   as trabajado,
       (i.x->>'minimo')::numeric      as minimo,
       (i.x->>'a_certificar')::numeric as cantidad_actual,
       (i.x->>'precio')::numeric      as precio_unitario,
       (i.x->>'cant_anterior')::numeric as cantidad_anterior,
       (i.x->>'monto_anterior')::numeric as monto_anterior,
       round(coalesce((i.x->>'a_certificar')::numeric, 0) * coalesce((i.x->>'precio')::numeric, 0)) as monto_actual
from public.cert_maq c
join public.obras o on o.clave = c.obra_clave
cross join lateral jsonb_array_elements(c.items) with ordinality as i(x, ord)
where c.estado <> 'anulado';

grant select, insert, update, delete on public.cert_maq to authenticated;
grant select on public.v_cert_maq_items to authenticated;

select 'ok' as listo;

-- ── REVERTIR ─────────────────────────────────────────────────────────────
-- drop view if exists public.v_cert_maq_items;
-- drop table if exists public.cert_maq;
-- drop function if exists public.cert_maq_proteger();
