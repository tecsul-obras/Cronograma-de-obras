-- =========================================================================
-- 80_compras_taller_historico.sql · v20261103a — HISTÓRICO DE MONDAY (staging)
--  Correr DESPUÉS del 79. Separado de las pantallas a propósito.
--
--  Las 16.938 filas de los 9 tableros de Monday (Pedidos Taller, Compras Taller,
--  Compras Taller UCC, Pedidos de Compra UCC, Caja Chica, Consolidado, Traslados,
--  Proveedores…) NO se importan como pedidos. Se cargan tal cual a una tabla de
--  evidencia (tc_hist_fuente) y desde ahí se concilian a mano:
--    · una fila = (sha256 del archivo, hoja, fila): cargar dos veces el mismo
--      archivo no duplica; si cambia el contenido de una fila ya cargada queda
--      «conflicto» para revisar (no se pisa);
--    · un pedido puede tener varias fuentes (tc_hist_vinculo): se conservan
--      todas, no se suman cantidades ni gastos;
--    · el canal (Caja chica / UCC / …) queda como texto de procedencia; no
--      crea bandejas ni rutas, y no se infiere caja chica por el nombre del Excel;
--    · «Trasladar / Enviado / Recibido» se guardan como texto: sin cantidad,
--      fecha y receptor no se inventan recepciones.
--  Promover una fila a pedido real (con legacy_fuente) es un paso posterior,
--  a definir con la gente de taller y compras. Solo el administrador (super).
--  Los datos NO van en el repositorio (es la carpeta pública de la app).
-- =========================================================================

create table if not exists public.tc_hist_fuente (
  id bigserial primary key,
  archivo text not null,
  archivo_sha256 text not null,
  hoja text not null default '',
  fila int not null,
  source_id text,                         -- id del paquete de análisis (no es el id de Monday)
  campos jsonb not null,
  campos_sha256 text not null,
  estado text not null default 'nuevo' check (estado in ('nuevo', 'conflicto', 'revisado', 'descartado', 'vinculado')),
  conflicto jsonb,                        -- versión distinta del mismo origen, para revisar
  nota text,
  cargado_por uuid, cargado_en timestamptz not null default now(),
  unique (archivo_sha256, hoja, fila)
);
create index if not exists tc_hist_fuente_archivo_ix on public.tc_hist_fuente (archivo);

create table if not exists public.tc_hist_vinculo (
  id bigserial primary key,
  fuente_id bigint not null references public.tc_hist_fuente(id) on delete cascade,
  pedido_id uuid references public.tc_pedido(id) on delete set null,
  grupo text,                             -- agrupa filas que son el mismo pedido histórico
  decision text not null check (decision in ('mismo_pedido', 'principal', 'secundaria', 'descartar')),
  nota text,
  decidido_por uuid, decidido_en timestamptz not null default now()
);
create unique index if not exists tc_hist_vinculo_uq on public.tc_hist_vinculo (fuente_id, coalesce(pedido_id::text, ''), coalesce(grupo, ''));

alter table public.tc_hist_fuente enable row level security;
alter table public.tc_hist_vinculo enable row level security;
revoke all on public.tc_hist_fuente, public.tc_hist_vinculo from anon, authenticated;

-- Carga un lote: p = [{archivo, archivo_sha256, hoja, fila, source_id, campos}, …] (hasta 2.000 por llamada)
create or replace function public.tc_hist_cargar(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); r jsonb; v_sha text; ex tc_hist_fuente%rowtype;
  nuevos int := 0; iguales int := 0; conflictos int := 0;
begin
  perform public._tc_exigir(yo, 'super');
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 2000 then raise exception 'Mandá un arreglo de hasta 2.000 filas.' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p) loop
    if coalesce(r ->> 'archivo_sha256', '') !~ '^[0-9a-f]{64}$' or (r ->> 'fila') is null or jsonb_typeof(r -> 'campos') <> 'object' then
      raise exception 'Fila inválida: %', left(r::text, 200) using errcode = '22023'; end if;
    v_sha := encode(extensions.digest(convert_to((r -> 'campos')::text, 'UTF8'), 'sha256'), 'hex');
    select * into ex from tc_hist_fuente where archivo_sha256 = r ->> 'archivo_sha256' and hoja = coalesce(r ->> 'hoja', '') and fila = (r ->> 'fila')::int;
    if not found then
      insert into tc_hist_fuente (archivo, archivo_sha256, hoja, fila, source_id, campos, campos_sha256, cargado_por)
      values (r ->> 'archivo', r ->> 'archivo_sha256', coalesce(r ->> 'hoja', ''), (r ->> 'fila')::int, r ->> 'source_id', r -> 'campos', v_sha, (yo ->> 'uid')::uuid);
      nuevos := nuevos + 1;
    elsif ex.campos_sha256 = v_sha then iguales := iguales + 1;
    else
      update tc_hist_fuente set estado = 'conflicto', conflicto = jsonb_build_object('campos', r -> 'campos', 'en', now()) where id = ex.id;
      conflictos := conflictos + 1;
    end if;
  end loop;
  return jsonb_build_object('nuevos', nuevos, 'ya_estaban', iguales, 'conflictos', conflictos);
end $$;

-- Diagnóstico: cuántas filas por archivo y estado
create or replace function public.tc_hist_resumen()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._tc_exigir(public.tc_yo(), 'super');
  return coalesce((select jsonb_agg(x order by x.archivo) from (
    select archivo, count(*) filas, count(*) filter (where estado = 'nuevo') nuevas, count(*) filter (where estado = 'conflicto') conflictos,
           count(*) filter (where estado = 'vinculado') vinculadas, count(*) filter (where estado = 'descartado') descartadas
      from tc_hist_fuente group by archivo) x), '[]');
end $$;

revoke all on function public.tc_hist_cargar(jsonb), public.tc_hist_resumen() from public, anon;
grant execute on function public.tc_hist_cargar(jsonb), public.tc_hist_resumen() to authenticated;

select 'SQL 80 ok' as resultado;
