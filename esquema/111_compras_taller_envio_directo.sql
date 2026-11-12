-- =========================================================================
-- 111_compras_taller_envio_directo.sql · v20261112d — COMPRAS › TALLER / UCC: ENTREGAS
--
--  Pedido de José (12/11/2026):
--   1. Sin el paso «Preparado en bodega»: cuando el pedido está en entrega, bodega
--      registra el ENVÍO directo (lo enviado no puede superar lo que hay en central:
--      lo pedido si sale de stock, lo recibido del proveedor si fue compra).
--   2. El envío lleva TIPO y NÚMERO DE DOCUMENTO (Nota de remisión, Remito, Vale de
--      salida, Factura u Otro): tc_movimiento.doc_tipo / doc_numero (obligatorios en
--      el envío, opcionales en las demás recepciones).
--   3. Enviar lo que hay: «atender desde stock» ya no exige stock ≥ lo pedido (alcanza
--      con > 0). Y «Cerrar con lo entregado» (bodega, o compras si fue compra), con
--      motivo, cuando se mandó menos de lo pedido (urgencia, cantidad exagerada…):
--      sin nada en tránsito y con algo ya recibido en obra. Se puede deshacer.
--
--  Los «preparado» viejos quedan en el historial (no se borran ni cuentan).
--  Necesita el SQL 110 corrido antes. Todo en una transacción; se puede correr dos veces.
--  Después de este, si alguna vez se corre el 79 o el 110, volver a correr este.
-- =========================================================================
begin;

alter table public.tc_movimiento add column if not exists doc_tipo text;
alter table public.tc_movimiento add column if not exists doc_numero text;
alter table public.tc_pedido add column if not exists cierre_en timestamptz;
alter table public.tc_pedido add column if not exists cierre_por uuid;
alter table public.tc_pedido add column if not exists cierre_nombre text;
alter table public.tc_pedido add column if not exists cierre_motivo text;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tc_pedido' and column_name = 'canal') then
    raise exception 'Falta correr el SQL 110 (Compras estratégicas UCC) antes de este.';
  end if;
end $$;

drop function if exists public._tc_fila(public.v_tc_pedido);
drop view if exists public.v_tc_pedido;   -- sin cascade: si otra cosa la usa, avisa y no toca nada
create or replace view public.v_tc_pedido with (security_invoker = true) as
select p.*,
  case p.canal when 'ucc' then 'UCC-' else 'TAL-' end || lpad(p.numero::text, 6, '0') as codigo,
  coalesce(m.c, 0) as q_central, coalesce(m.d, 0) as q_directa, coalesce(m.pr, 0) as q_prepara,
  coalesce(m.e, 0) as q_envio, coalesce(m.r, 0) as q_recepcion, coalesce(m.s, 0) as q_servicio,
  m.ult_recepcion,
  a.id as aut_id, a.estado as aut_estado, a.total as aut_total, a.moneda as aut_moneda,
  a.oferta ->> 'proveedor_nombre' as aut_proveedor,
  (c.pedido_id is not null) as comprado, c.doc_tipo, c.doc_numero, c.fecha_compra, c.uso_caja_chica,
  c.total as compra_total, c.moneda as compra_moneda, c.oferta ->> 'proveedor_nombre' as compra_proveedor,
  coalesce(q.n, 0) as n_cotizaciones,
  coalesce(f.n, 0) as n_fotos,
  case
    when p.estado = 'anulado' then 'anulado'
    when p.estado = 'rechazado' then 'rechazado'
    when p.estado in ('pendiente', 'revision') then case when p.canal = 'ucc' then 'aclaracion' else 'bodega' end
    when p.estado = 'compra' and c.pedido_id is null then
      case a.estado when 'pendiente' then 'autorizacion' when 'autorizada' then 'compra' else 'cotizacion' end
    when p.cierre_en is not null then 'cerrado'   -- cerrado con lo entregado (SQL 111)
    when coalesce(m.r, 0) + coalesce(m.d, 0) + coalesce(m.s, 0) >= p.cantidad then 'cerrado'
    else 'entrega'
  end as fase
from public.tc_pedido p
left join lateral (
  select sum(cantidad) filter (where tipo = 'central') c, sum(cantidad) filter (where tipo = 'directa') d,
         sum(cantidad) filter (where tipo = 'prepara') pr, sum(cantidad) filter (where tipo = 'envio') e,
         sum(cantidad) filter (where tipo = 'recepcion') r, sum(cantidad) filter (where tipo = 'servicio') s,
         max(fecha) filter (where tipo in ('recepcion', 'directa', 'servicio')) ult_recepcion
    from public.tc_movimiento mv where mv.pedido_id = p.id and mv.anulado_en is null) m on true
left join public.tc_autorizacion a on a.pedido_id = p.id and a.estado in ('pendiente', 'autorizada')
left join public.tc_compra c on c.pedido_id = p.id
left join lateral (select count(*) n from public.tc_cotizacion x where x.pedido_id = p.id and not x.anulada) q on true
left join lateral (select count(*) n from public.tc_adjunto x where x.pedido_id = p.id and x.tipo = 'foto' and x.quitado_en is null) f on true;

create or replace function public._tc_fila(v public.v_tc_pedido)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', v.id, 'codigo', v.codigo, 'numero', v.numero, 'obra_clave', v.obra_clave, 'obra_nombre', v.obra_nombre,
    'equipo_id', v.equipo_id, 'equipo_texto', v.equipo_texto, 'ot_numero', v.ot_numero, 'tipo', v.tipo,
    'descripcion', v.descripcion, 'codigo_repuesto', v.codigo_repuesto, 'marca_modelo', v.marca_modelo,
    'cantidad', v.cantidad, 'unidad', v.unidad, 'prioridad', v.prioridad, 'fecha_requerida', v.fecha_requerida,
    'notas', v.notas, 'solicitante_id', v.solicitante_id, 'solicitante_nombre', v.solicitante_nombre, 'creado_en', v.creado_en,
    'estado', v.estado, 'fase', v.fase, 'ruta', v.ruta, 'version', v.version, 'actualizado_en', v.actualizado_en,
    'bodega_nombre', v.bodega_nombre, 'bodega_en', v.bodega_en, 'bodega_stock', v.bodega_stock, 'bodega_nota', v.bodega_nota,
    'q', jsonb_build_object('c', v.q_central, 'd', v.q_directa, 'p', v.q_prepara, 'e', v.q_envio, 'r', v.q_recepcion, 's', v.q_servicio),
    'ult_recepcion', v.ult_recepcion,
    'aut_id', v.aut_id, 'aut_estado', v.aut_estado, 'aut_total', v.aut_total, 'aut_moneda', v.aut_moneda, 'aut_proveedor', v.aut_proveedor,
    'comprado', v.comprado, 'doc_tipo', v.doc_tipo, 'doc_numero', v.doc_numero, 'fecha_compra', v.fecha_compra,
    'uso_caja_chica', v.uso_caja_chica, 'compra_total', v.compra_total, 'compra_moneda', v.compra_moneda, 'compra_proveedor', v.compra_proveedor,
    'n_cotizaciones', v.n_cotizaciones, 'n_fotos', v.n_fotos, 'legacy_canal', v.legacy_canal, 'canal', v.canal)
    || jsonb_build_object('cierre_en', v.cierre_en, 'cierre_nombre', v.cierre_nombre, 'cierre_motivo', v.cierre_motivo)
$$;



create or replace function public.tc_detalle(p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare yo jsonb := public.tc_yo(); v v_tc_pedido%rowtype;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into v from v_tc_pedido where id = p_pedido;
  if not found then raise exception 'El pedido no existe.' using errcode = 'P0002'; end if;
  if not public._tc_ve(yo, v.obra_clave) then raise exception 'No tenés acceso a este pedido.' using errcode = '42501'; end if;
  return public._tc_fila(v) || jsonb_build_object(
    'equipo_desc', (select descripcion from equipos where id = v.equipo_id),
    'cotizaciones', coalesce((select jsonb_agg(to_jsonb(c) order by c.creado_en) from tc_cotizacion c where c.pedido_id = v.id), '[]'),
    'autorizaciones', coalesce((select jsonb_agg(to_jsonb(a) order by a.solicitado_en) from tc_autorizacion a where a.pedido_id = v.id), '[]'),
    'compra', (select to_jsonb(c) from tc_compra c where c.pedido_id = v.id),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) order by m.fecha, m.registrado_en) from tc_movimiento m where m.pedido_id = v.id), '[]'),
    'adjuntos', coalesce((select jsonb_agg(to_jsonb(a) order by a.subido_en) from tc_adjunto a where a.pedido_id = v.id and a.quitado_en is null), '[]'),
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) order by e.en, e.id) from tc_evento e where e.pedido_id = v.id), '[]'),
    'legacy_fuente', v.legacy_fuente);
end $$;



create or replace function public._tc_validar_saldos(p_pedido uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v record; base numeric;
begin
  select * into v from public.v_tc_pedido where id = p_pedido;
  base := case when v.estado = 'stock' then v.cantidad else v.q_central end;
  if v.estado = 'stock' and (v.q_central > 0 or v.q_directa > 0 or v.q_servicio > 0) then
    raise exception 'Un pedido atendido desde stock no tiene recepciones de proveedor.' using errcode = '22023'; end if;
  if v.q_central + v.q_directa > v.cantidad then
    raise exception 'Lo recibido del proveedor (% en central + % directo) supera lo pedido (%).', v.q_central, v.q_directa, v.cantidad using errcode = '22023'; end if;
  -- SQL 111: sin paso «preparado»; se envía directo lo que hay en central
  if v.q_envio > base then
    raise exception 'Lo enviado (%) supera lo disponible en central para este pedido (%).', v.q_envio, base using errcode = '22023'; end if;
  if v.q_recepcion > v.q_envio then
    raise exception 'Lo recibido en obra (%) supera lo enviado desde central (%).', v.q_recepcion, v.q_envio using errcode = '22023'; end if;
  if v.q_servicio > v.cantidad then
    raise exception 'La conformidad (%) supera lo pedido (%).', v.q_servicio, v.cantidad using errcode = '22023'; end if;
end $$;


create or replace function public.tc_accion(p_pedido uuid, p_accion text, p_version int, p_op uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  yo jsonb := public.tc_yo();
  v_uid uuid := (yo ->> 'uid')::uuid;
  prev jsonb; ped tc_pedido%rowtype; v record; res jsonb;
  v_txt text; v_mot text; v_q numeric; v_n numeric; v_id uuid; v_tipo text; v_fecha date;
  cot tc_cotizacion%rowtype; aut tc_autorizacion%rowtype; com tc_compra%rowtype; mov tc_movimiento%rowtype;
  v_obra obras%rowtype; v_det text; v_doc_t text; v_doc_n text;
begin
  if yo is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_op is null then raise exception 'Falta la clave de la operación.' using errcode = '22023'; end if;
  p := coalesce(p, '{}'::jsonb);
  select resultado into prev from tc_operacion where op = p_op and user_id = v_uid;
  if found then return prev || '{"repetida": true}'; end if;

  select * into ped from tc_pedido where id = p_pedido for update;
  if not found then raise exception 'El pedido no existe.' using errcode = 'P0002'; end if;
  if not public._tc_ve(yo, ped.obra_clave) then raise exception 'No tenés acceso a los pedidos de %.', ped.obra_nombre using errcode = '42501'; end if;
  if p_version is distinct from ped.version then
    raise exception 'El pedido %-% cambió mientras lo tenías abierto. Se actualiza para que veas lo último.', case ped.canal when 'ucc' then 'UCC' else 'TAL' end, lpad(ped.numero::text, 6, '0') using errcode = '40001';
  end if;
  select * into v from v_tc_pedido where id = p_pedido;
  v_mot := public._tc_txt(p, 'motivo');

  case p_accion
  -- ── solicitante ──────────────────────────────────────────────
  when 'editar' then
    if ped.canal = 'ucc' then
      if not (ped.estado = 'revision' or (ped.estado = 'compra' and v.n_cotizaciones = 0 and v.aut_id is null and not v.comprado)) then
        raise exception 'Compras ya empezó a cotizar: el pedido no se puede editar. Pedí a compras que lo devuelva para aclaración.' using errcode = '22023'; end if;
    elsif ped.estado not in ('pendiente', 'revision') then raise exception 'Bodega ya decidió: el pedido no se puede editar.' using errcode = '22023'; end if;
    if ped.solicitante_id <> v_uid and not coalesce((yo ->> 'super')::boolean, false) then
      raise exception 'Solo quien cargó el pedido lo puede editar.' using errcode = '42501'; end if;
    if public._tc_txt(p, 'obra_clave') is not null and public._tc_txt(p, 'obra_clave') <> ped.obra_clave then
      select * into v_obra from obras where clave = public._tc_txt(p, 'obra_clave') and activa;
      if not found or not public._tc_sol(yo, v_obra.clave) then raise exception 'No podés pasar el pedido a esa obra.' using errcode = '42501'; end if;
      ped.obra_clave := v_obra.clave; ped.obra_nombre := v_obra.nombre;
    end if;
    v_q := coalesce(public._tc_num(p, 'cantidad'), ped.cantidad);
    if v_q <= 0 then raise exception 'La cantidad tiene que ser mayor a cero.' using errcode = '22023'; end if;
    if public._tc_txt(p, 'equipo_id') is not null and not exists (select 1 from equipos where id = public._tc_txt(p, 'equipo_id')) then
      raise exception 'El equipo no está en la flota.' using errcode = '22023'; end if;
    update tc_pedido set obra_clave = ped.obra_clave, obra_nombre = ped.obra_nombre,
      descripcion = coalesce(public._tc_txt(p, 'descripcion'), descripcion),
      codigo_repuesto = case when p ? 'codigo_repuesto' then public._tc_txt(p, 'codigo_repuesto') else codigo_repuesto end,
      marca_modelo = case when p ? 'marca_modelo' then public._tc_txt(p, 'marca_modelo') else marca_modelo end,
      equipo_id = case when p ? 'equipo_id' then public._tc_txt(p, 'equipo_id') else equipo_id end,
      equipo_texto = case when p ? 'equipo_texto' then public._tc_txt(p, 'equipo_texto') else equipo_texto end,
      ot_numero = case when p ? 'ot_numero' then public._tc_num(p, 'ot_numero')::bigint else ot_numero end,
      tipo = coalesce(public._tc_txt(p, 'tipo'), tipo), cantidad = v_q,
      unidad = coalesce(public._tc_txt(p, 'unidad'), unidad), prioridad = coalesce(public._tc_txt(p, 'prioridad'), prioridad),
      fecha_requerida = case when p ? 'fecha_requerida' then public._tc_txt(p, 'fecha_requerida')::date else fecha_requerida end,
      notas = case when p ? 'notas' then public._tc_txt(p, 'notas') else notas end,
      estado = case when ped.canal = 'ucc' then 'compra' else 'pendiente' end
     where id = ped.id;
    perform public._tc_evento(ped.id, yo, case when ped.estado = 'revision' then 'Solicitud corregida · vuelve a ' || case when ped.canal = 'ucc' then 'compras' else 'bodega' end else 'Solicitud editada' end, v_mot);

  when 'anular' then
    if ped.canal = 'ucc' then
      if not (ped.estado = 'revision' or (ped.estado = 'compra' and v.n_cotizaciones = 0 and v.aut_id is null and not v.comprado)) then
        raise exception 'Compras ya empezó a cotizar: el pedido no se puede anular. Pedí a compras que lo rechace.' using errcode = '22023'; end if;
    elsif ped.estado not in ('pendiente', 'revision') then raise exception 'Solo se anula antes de la decisión de bodega.' using errcode = '22023'; end if;
    if ped.solicitante_id <> v_uid and not coalesce((yo ->> 'super')::boolean, false) then
      raise exception 'Solo quien cargó el pedido lo puede anular.' using errcode = '42501'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_pedido set estado = 'anulado' where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Pedido anulado por el solicitante', v_mot);

  -- ── bodega central ───────────────────────────────────────────
  when 'bodega_revision', 'bodega_rechazar', 'bodega_stock', 'bodega_compra' then
    perform public._tc_exigir(yo, 'bodega');
    if ped.canal = 'ucc' then raise exception 'Los pedidos estratégicos (UCC) no pasan por bodega central.' using errcode = '22023'; end if;
    if ped.estado not in ('pendiente', 'revision') then raise exception 'Bodega ya decidió este pedido.' using errcode = '22023'; end if;
    v_n := public._tc_num(p, 'stock');
    if v_n is not null and v_n < 0 then raise exception 'El stock no puede ser negativo.' using errcode = '22023'; end if;
    if p_accion in ('bodega_revision', 'bodega_rechazar') and v_mot is null then
      raise exception 'Indicá el motivo (lo ve el solicitante).' using errcode = '22023'; end if;
    if p_accion = 'bodega_stock' then
      if ped.tipo = 'servicio' then raise exception 'Un servicio no sale de stock.' using errcode = '22023'; end if;
      -- SQL 111: alcanza con que haya algo; se envía lo que hay y se cierra con lo entregado
      if v_n is null or v_n <= 0 then
        raise exception 'Indicá cuánto stock hay (mayor a cero). Si no hay nada, derivá a compras.' using errcode = '22023'; end if;
    end if;
    update tc_pedido set estado = case p_accion when 'bodega_revision' then 'revision' when 'bodega_rechazar' then 'rechazado'
                                          when 'bodega_stock' then 'stock' else 'compra' end,
      bodega_por = v_uid, bodega_nombre = yo ->> 'nombre', bodega_en = now(), bodega_stock = v_n, bodega_nota = v_mot,
      ruta = case when p_accion = 'bodega_stock' then 'central' else ruta end
     where id = ped.id;
    perform public._tc_evento(ped.id, yo, case p_accion when 'bodega_revision' then 'Bodega pidió aclaración'
        when 'bodega_rechazar' then 'Bodega rechazó el pedido' when 'bodega_stock' then 'Bodega: hay stock, se atiende desde central'
        else 'Bodega: sin stock suficiente, se deriva a compras' end
        || case when p_accion = 'bodega_stock' and v_n < ped.cantidad then ' (stock parcial: se envía lo que hay)' else '' end,
      concat_ws(' · ', case when v_n is not null then 'stock verificado ' || public._tc_fmt(v_n) || ' ' || ped.unidad end, v_mot));

  when 'bodega_volver' then
    perform public._tc_exigir(yo, 'bodega');
    if ped.canal = 'ucc' then raise exception 'Los pedidos estratégicos (UCC) no pasan por bodega central.' using errcode = '22023'; end if;
    if ped.estado not in ('stock', 'compra', 'rechazado') then raise exception 'No hay decisión de bodega para deshacer.' using errcode = '22023'; end if;
    if v.comprado or v.aut_id is not null or exists (select 1 from tc_movimiento where pedido_id = ped.id and anulado_en is null) then
      raise exception 'Ya hay autorización, compra o movimientos: la decisión de bodega no se puede deshacer.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_pedido set estado = 'pendiente' where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Bodega reabrió su decisión', v_mot);

  -- ── compras: pedidos estratégicos (UCC) ─────────────────────
  -- No pasan por bodega: entran directo a compras. Compras puede devolverlos
  -- para aclaración o rechazarlos mientras no haya autorización pedida ni compra.
  when 'ucc_aclaracion', 'ucc_rechazar' then
    perform public._tc_exigir(yo, 'compras');
    if ped.canal <> 'ucc' then raise exception 'Solo para pedidos estratégicos (UCC).' using errcode = '22023'; end if;
    if ped.estado <> 'compra' then raise exception 'El pedido no está en compras.' using errcode = '22023'; end if;
    if v.comprado or v.aut_id is not null then
      raise exception 'Ya hay autorización pedida o compra registrada: no se puede devolver ni rechazar.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo (lo ve el solicitante).' using errcode = '22023'; end if;
    update tc_pedido set estado = case p_accion when 'ucc_aclaracion' then 'revision' else 'rechazado' end,
      bodega_por = v_uid, bodega_nombre = yo ->> 'nombre', bodega_en = now(), bodega_nota = v_mot
     where id = ped.id;
    perform public._tc_evento(ped.id, yo, case p_accion when 'ucc_aclaracion' then 'Compras pidió aclaración' else 'Compras rechazó el pedido' end, v_mot);

  when 'ucc_reabrir' then
    perform public._tc_exigir(yo, 'compras');
    if ped.canal <> 'ucc' or ped.estado <> 'rechazado' then raise exception 'Solo se reabre un pedido estratégico rechazado.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_pedido set estado = 'compra' where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Compras reabrió el pedido', v_mot);

  -- ── compras: cotizaciones ───────────────────────────────────
  when 'cot_guardar', 'cot_anular' then
    perform public._tc_exigir(yo, 'compras');
    if ped.estado <> 'compra' then raise exception 'El pedido no está derivado a compras.' using errcode = '22023'; end if;
    if v.comprado then raise exception 'La compra ya está registrada: las cotizaciones quedan como están.' using errcode = '22023'; end if;
    v_id := nullif(public._tc_txt(p, 'id'), '')::uuid;
    if v_id is not null then
      select * into cot from tc_cotizacion where id = v_id and pedido_id = ped.id for update;
      if not found or cot.anulada then raise exception 'La cotización no existe o está anulada.' using errcode = '22023'; end if;
    elsif p_accion = 'cot_anular' then raise exception 'Falta la cotización.' using errcode = '22023';
    end if;
    if p_accion = 'cot_anular' then
      update tc_cotizacion set anulada = true, editado_en = now() where id = v_id;
      perform public._tc_evento(ped.id, yo, 'Cotización anulada', cot.proveedor_nombre || coalesce(' · ' || v_mot, ''));
    else
      v_n := public._tc_num(p, 'precio_unit');
      if v_n is null or v_n < 0 then raise exception 'Indicá el precio unitario.' using errcode = '22023'; end if;
      v_txt := public._tc_txt(p, 'proveedor_nombre');
      if public._tc_txt(p, 'proveedor_id') is not null then
        select nombre into v_txt from tc_proveedor where id = public._tc_txt(p, 'proveedor_id')::uuid;
        if not found then raise exception 'El proveedor no existe.' using errcode = '22023'; end if;
      end if;
      if v_txt is null then raise exception 'Indicá el proveedor.' using errcode = '22023'; end if;
      if v_id is null then
        insert into tc_cotizacion (pedido_id, proveedor_id, proveedor_nombre, precio_unit, moneda, flete, unidad, impuesto,
                                   plazo_dias, condiciones, nota, creado_por, creado_nombre)
        values (ped.id, public._tc_txt(p, 'proveedor_id')::uuid, v_txt, v_n, coalesce(public._tc_txt(p, 'moneda'), 'PYG'),
                coalesce(public._tc_num(p, 'flete'), 0), coalesce(public._tc_txt(p, 'unidad'), ped.unidad),
                coalesce(public._tc_txt(p, 'impuesto'), 'incluido'), public._tc_num(p, 'plazo_dias')::int,
                public._tc_txt(p, 'condiciones'), public._tc_txt(p, 'nota'), v_uid, yo ->> 'nombre')
        returning * into cot;
        v_id := cot.id;
        perform public._tc_evento(ped.id, yo, 'Cotización cargada', v_txt || ' · ' || cot.moneda || ' ' || public._tc_fmt(v_n) || ' c/u');
      else
        update tc_cotizacion set proveedor_id = public._tc_txt(p, 'proveedor_id')::uuid, proveedor_nombre = v_txt, precio_unit = v_n,
          moneda = coalesce(public._tc_txt(p, 'moneda'), moneda), flete = coalesce(public._tc_num(p, 'flete'), 0),
          unidad = coalesce(public._tc_txt(p, 'unidad'), unidad), impuesto = coalesce(public._tc_txt(p, 'impuesto'), impuesto),
          plazo_dias = public._tc_num(p, 'plazo_dias')::int, condiciones = public._tc_txt(p, 'condiciones'),
          nota = public._tc_txt(p, 'nota'), rev = rev + 1, editado_en = now()
         where id = v_id;
        perform public._tc_evento(ped.id, yo, 'Cotización modificada', v_txt || ' · ' || coalesce(public._tc_txt(p, 'moneda'), cot.moneda) || ' ' || public._tc_fmt(v_n) || ' c/u');
      end if;
    end if;
    -- tocar la oferta que se pidió autorizar la deja sin efecto
    if v_id is not null and v.aut_id is not null then
      select * into aut from tc_autorizacion where id = v.aut_id;
      if aut.cotizacion_id = v_id then
        update tc_autorizacion set estado = 'anulada', resuelto_en = coalesce(resuelto_en, now()),
          motivo_resolucion = coalesce(motivo_resolucion, 'La cotización cambió después de pedir la autorización.') where id = aut.id;
        perform public._tc_evento(ped.id, yo, case aut.estado when 'autorizada' then 'Autorización sin efecto' else 'Pedido de autorización sin efecto' end,
          'Se modificó o anuló la cotización elegida: hay que volver a pedir autorización.');
      end if;
    end if;

  -- ── autorización ─────────────────────────────────────────────
  when 'aut_solicitar' then
    perform public._tc_exigir(yo, 'compras');
    if ped.estado <> 'compra' or v.comprado then raise exception 'El pedido no está esperando compra.' using errcode = '22023'; end if;
    if v.aut_id is not null then raise exception 'Ya hay una autorización % para este pedido.', case v.aut_estado when 'pendiente' then 'pedida' else 'vigente' end using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá por qué se elige esta oferta.' using errcode = '22023'; end if;
    select * into cot from tc_cotizacion where id = public._tc_txt(p, 'cotizacion_id')::uuid and pedido_id = ped.id and not anulada;
    if not found then raise exception 'Elegí una cotización vigente.' using errcode = '22023'; end if;
    insert into tc_autorizacion (pedido_id, cotizacion_id, cotizacion_rev, oferta, total, moneda, solicitado_por, solicitado_nombre, motivo)
    values (ped.id, cot.id, cot.rev, to_jsonb(cot), cot.precio_unit * ped.cantidad + cot.flete, cot.moneda, v_uid, yo ->> 'nombre', v_mot);
    perform public._tc_evento(ped.id, yo, 'Autorización solicitada',
      cot.proveedor_nombre || ' · ' || cot.moneda || ' ' || public._tc_fmt(cot.precio_unit * ped.cantidad + cot.flete) || ' · ' || v_mot);

  when 'aut_resolver' then
    perform public._tc_exigir(yo, 'autorizar');
    select * into aut from tc_autorizacion where id = public._tc_txt(p, 'autorizacion_id')::uuid and pedido_id = ped.id for update;
    if not found or aut.estado <> 'pendiente' then raise exception 'Esa solicitud de autorización ya no está pendiente.' using errcode = '22023'; end if;
    if aut.solicitado_por = v_uid then raise exception 'Quien pide la autorización no la puede resolver: la tiene que resolver otra persona.' using errcode = '42501'; end if;
    select * into cot from tc_cotizacion where id = aut.cotizacion_id;
    if cot.anulada or cot.rev <> aut.cotizacion_rev then raise exception 'La cotización cambió desde que se pidió la autorización.' using errcode = '22023'; end if;
    v_txt := public._tc_txt(p, 'decision');
    if v_txt not in ('autorizar', 'devolver') then raise exception 'Decisión no válida.' using errcode = '22023'; end if;
    if v_txt = 'devolver' and v_mot is null then raise exception 'Indicá el motivo para devolver a compras.' using errcode = '22023'; end if;
    update tc_autorizacion set estado = case v_txt when 'autorizar' then 'autorizada' else 'devuelta' end,
      resuelto_por = v_uid, resuelto_nombre = yo ->> 'nombre', resuelto_en = now(), motivo_resolucion = v_mot where id = aut.id;
    perform public._tc_evento(ped.id, yo, case v_txt when 'autorizar' then 'Compra autorizada' else 'Autorización devuelta a compras' end,
      concat_ws(' · ', aut.oferta ->> 'proveedor_nombre', aut.moneda || ' ' || public._tc_fmt(aut.total), v_mot));

  -- ── compra ───────────────────────────────────────────────────
  when 'compra_registrar' then
    perform public._tc_exigir(yo, 'compras');
    if ped.estado <> 'compra' or v.comprado then raise exception 'El pedido no está esperando compra.' using errcode = '22023'; end if;
    if v.aut_estado is distinct from 'autorizada' then raise exception 'Falta la autorización de la compra.' using errcode = '22023'; end if;
    select * into aut from tc_autorizacion where id = v.aut_id;
    if public._tc_txt(p, 'doc_tipo') not in ('oc', 'factura', 'comprobante') then raise exception 'Elegí el tipo de documento.' using errcode = '22023'; end if;
    if public._tc_txt(p, 'doc_numero') is null then raise exception 'Indicá el número del documento.' using errcode = '22023'; end if;
    v_fecha := public._tc_txt(p, 'fecha_compra')::date;
    if v_fecha is null then raise exception 'Indicá la fecha de compra.' using errcode = '22023'; end if;
    if jsonb_typeof(p -> 'uso_caja_chica') is distinct from 'boolean' then raise exception 'Indicá si se pagó con caja chica.' using errcode = '22023'; end if;
    v_txt := case when ped.tipo = 'servicio' then 'directa' else coalesce(public._tc_txt(p, 'ruta'), 'central') end;
    if v_txt not in ('central', 'directa', 'mixta') then raise exception 'Ruta de entrega no válida.' using errcode = '22023'; end if;
    insert into tc_compra (pedido_id, autorizacion_id, oferta, cantidad, total, moneda, doc_tipo, doc_numero, fecha_compra,
                           uso_caja_chica, registrado_por, registrado_nombre)
    values (ped.id, aut.id, aut.oferta, ped.cantidad, aut.total, aut.moneda, public._tc_txt(p, 'doc_tipo'), public._tc_txt(p, 'doc_numero'),
            v_fecha, (p ->> 'uso_caja_chica')::boolean, v_uid, yo ->> 'nombre');
    update tc_pedido set ruta = v_txt where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Compra registrada',
      concat_ws(' · ', upper(public._tc_txt(p, 'doc_tipo')) || ' ' || public._tc_txt(p, 'doc_numero'), aut.oferta ->> 'proveedor_nombre',
        case when (p ->> 'uso_caja_chica')::boolean then 'caja chica' end,
        case v_txt when 'central' then 'entrega por central' when 'directa' then 'entrega directa en obra' else 'entrega mixta' end));

  when 'compra_corregir' then
    perform public._tc_exigir(yo, 'compras');
    select * into com from tc_compra where pedido_id = ped.id for update;
    if not found then raise exception 'No hay compra registrada.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo de la corrección.' using errcode = '22023'; end if;
    update tc_compra set doc_tipo = coalesce(public._tc_txt(p, 'doc_tipo'), doc_tipo), doc_numero = coalesce(public._tc_txt(p, 'doc_numero'), doc_numero),
      fecha_compra = coalesce(public._tc_txt(p, 'fecha_compra')::date, fecha_compra),
      uso_caja_chica = case when jsonb_typeof(p -> 'uso_caja_chica') = 'boolean' then (p ->> 'uso_caja_chica')::boolean else uso_caja_chica end,
      corregido_en = now()
     where pedido_id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Compra corregida', concat_ws(' · ',
      case when public._tc_txt(p, 'doc_numero') is distinct from com.doc_numero and public._tc_txt(p, 'doc_numero') is not null then 'documento ' || com.doc_numero || ' → ' || public._tc_txt(p, 'doc_numero') end,
      case when jsonb_typeof(p -> 'uso_caja_chica') = 'boolean' and (p ->> 'uso_caja_chica')::boolean is distinct from com.uso_caja_chica
           then 'caja chica: ' || case when (p ->> 'uso_caja_chica')::boolean then 'sí' else 'no' end end,
      v_mot));

  when 'ruta_cambiar' then
    if not (coalesce((yo ->> 'compras')::boolean, false) or coalesce((yo ->> 'bodega')::boolean, false)) then
      raise exception 'Tu usuario no puede cambiar la ruta de entrega.' using errcode = '42501'; end if;
    if not v.comprado then raise exception 'La ruta se define al registrar la compra.' using errcode = '22023'; end if;
    v_txt := public._tc_txt(p, 'ruta');
    if v_txt not in ('central', 'directa', 'mixta') then raise exception 'Ruta de entrega no válida.' using errcode = '22023'; end if;
    if v_txt = 'central' and v.q_directa > 0 then raise exception 'Ya hay entregas directas en obra: usá «mixta».' using errcode = '22023'; end if;
    if v_txt = 'directa' and (v.q_central > 0 or v.q_prepara > 0) then raise exception 'Ya hay recepciones en central: usá «mixta».' using errcode = '22023'; end if;
    update tc_pedido set ruta = v_txt where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Ruta de entrega cambiada', ped.ruta || ' → ' || v_txt || coalesce(' · ' || v_mot, ''));

  -- ── movimientos (entregas parciales) ─────────────────────────
  when 'mov_registrar' then
    v_tipo := public._tc_txt(p, 'tipo');
    v_q := public._tc_num(p, 'cantidad');
    v_fecha := coalesce(public._tc_txt(p, 'fecha')::date, current_date);
    if v_q is null or v_q <= 0 then raise exception 'La cantidad tiene que ser mayor a cero.' using errcode = '22023'; end if;
    if ped.cierre_en is not null then raise exception 'El pedido se cerró con lo entregado: deshacé el cierre para registrar más.' using errcode = '22023'; end if;
    if v_tipo = 'prepara' then raise exception 'El paso «preparado» ya no se usa: registrá el envío directamente.' using errcode = '22023'; end if;
    v_doc_t := public._tc_txt(p, 'doc_tipo'); v_doc_n := public._tc_txt(p, 'doc_numero');
    if v_doc_t is not null and v_doc_t not in ('nota_remision', 'remito', 'vale_salida', 'factura', 'otro') then
      raise exception 'Tipo de documento no válido.' using errcode = '22023'; end if;
    if v_tipo = 'envio' and (v_doc_t is null or v_doc_n is null) then
      raise exception 'Indicá el tipo y el número del documento del envío.' using errcode = '22023'; end if;
    if v_fecha > current_date + 1 then raise exception 'La fecha no puede ser futura.' using errcode = '22023'; end if;
    if v_tipo in ('central', 'prepara', 'envio') then perform public._tc_exigir(yo, 'bodega');
    elsif v_tipo in ('recepcion', 'directa', 'servicio') then
      if not public._tc_sol(yo, ped.obra_clave) then raise exception 'Solo la gente de % confirma lo recibido en obra.', ped.obra_nombre using errcode = '42501'; end if;
    else raise exception 'Movimiento no válido.' using errcode = '22023'; end if;
    if ped.estado = 'stock' then
      if v_tipo not in ('envio', 'recepcion') then raise exception 'Un pedido desde stock solo se envía y se recibe.' using errcode = '22023'; end if;
    elsif ped.estado = 'compra' and v.comprado then
      if ped.tipo = 'servicio' and v_tipo <> 'servicio' then raise exception 'Un servicio se cierra con la conformidad.' using errcode = '22023'; end if;
      if ped.tipo = 'producto' and v_tipo = 'servicio' then raise exception 'La conformidad es solo para servicios.' using errcode = '22023'; end if;
      if v_tipo = 'central' and ped.ruta = 'directa' then raise exception 'La compra va directo a obra: cambiá la ruta a «mixta» para recibir en central.' using errcode = '22023'; end if;
      if v_tipo = 'directa' and ped.ruta = 'central' then raise exception 'La compra va por central: cambiá la ruta a «mixta» para registrar entrega directa.' using errcode = '22023'; end if;
    else raise exception 'Todavía no hay nada para entregar (falta la decisión de bodega o la compra).' using errcode = '22023';
    end if;
    insert into tc_movimiento (pedido_id, tipo, cantidad, fecha, doc_tipo, doc_numero, referencia, responsable, nota, registrado_por, registrado_nombre)
    values (ped.id, v_tipo, v_q, v_fecha, v_doc_t, v_doc_n, public._tc_txt(p, 'referencia'),
            coalesce(public._tc_txt(p, 'responsable'), case when v_tipo in ('recepcion', 'directa', 'servicio') then yo ->> 'nombre' end),
            public._tc_txt(p, 'nota'), v_uid, yo ->> 'nombre')
    returning * into mov;
    perform public._tc_validar_saldos(ped.id);
    perform public._tc_evento(ped.id, yo, case v_tipo when 'central' then 'Recibido en taller central' when 'prepara' then 'Preparado en bodega'
        when 'envio' then 'Enviado a obra' when 'recepcion' then 'Recibido en obra' when 'directa' then 'Recibido en obra directo del proveedor'
        else 'Conformidad del servicio' end,
      concat_ws(' · ', public._tc_fmt(v_q) || ' ' || ped.unidad,
        case when mov.doc_numero is not null then case mov.doc_tipo when 'nota_remision' then 'Nota de remisión' when 'remito' then 'Remito'
          when 'vale_salida' then 'Vale de salida' when 'factura' then 'Factura' else 'Doc.' end || ' ' || mov.doc_numero end,
        mov.referencia, mov.responsable));

  -- ── cerrar con lo entregado (SQL 111) ───────────────────────
  -- Se mandó menos de lo pedido (stock parcial, urgencia, cantidad exagerada):
  -- bodega (o compras, si fue compra) cierra el pedido con lo que llegó a la obra.
  when 'cerrar_parcial' then
    if not (coalesce((yo ->> 'bodega')::boolean, false) or (v.comprado and coalesce((yo ->> 'compras')::boolean, false))) then
      raise exception 'Solo bodega%cierra el pedido con lo entregado.', case when v.comprado then ' o compras ' else ' ' end using errcode = '42501'; end if;
    if v.fase <> 'entrega' then raise exception 'Solo se cierra un pedido que está en entrega.' using errcode = '22023'; end if;
    if v.q_envio > v.q_recepcion then raise exception 'Hay % % en tránsito: que la obra confirme lo recibido (o anulá el envío) antes de cerrar.', public._tc_fmt(v.q_envio - v.q_recepcion), ped.unidad using errcode = '22023'; end if;
    if v.q_recepcion + v.q_directa + v.q_servicio <= 0 then raise exception 'Todavía no llegó nada a la obra: si no se va a entregar, anulá o rechazá el pedido.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo (por qué se entrega menos de lo pedido).' using errcode = '22023'; end if;
    update tc_pedido set cierre_en = now(), cierre_por = v_uid, cierre_nombre = yo ->> 'nombre', cierre_motivo = v_mot where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Cerrado con lo entregado',
      public._tc_fmt(v.q_recepcion + v.q_directa + v.q_servicio) || ' de ' || public._tc_fmt(ped.cantidad) || ' ' || ped.unidad || ' · ' || v_mot);

  when 'cierre_deshacer' then
    if not (coalesce((yo ->> 'bodega')::boolean, false) or coalesce((yo ->> 'compras')::boolean, false)) then
      raise exception 'Solo bodega o compras deshacen el cierre.' using errcode = '42501'; end if;
    if ped.cierre_en is null then raise exception 'El pedido no está cerrado con lo entregado.' using errcode = '22023'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_pedido set cierre_en = null, cierre_por = null, cierre_nombre = null, cierre_motivo = null where id = ped.id;
    perform public._tc_evento(ped.id, yo, 'Cierre deshecho: vuelve a entrega', v_mot);

  when 'mov_anular' then
    select * into mov from tc_movimiento where id = public._tc_txt(p, 'movimiento_id')::uuid and pedido_id = ped.id for update;
    if not found or mov.anulado_en is not null then raise exception 'El movimiento no existe o ya está anulado.' using errcode = '22023'; end if;
    if ped.cierre_en is not null then raise exception 'El pedido se cerró con lo entregado: deshacé el cierre primero.' using errcode = '22023'; end if;
    if mov.tipo in ('central', 'prepara', 'envio') then perform public._tc_exigir(yo, 'bodega');
    elsif not public._tc_sol(yo, ped.obra_clave) then raise exception 'Tu usuario no puede anular recepciones de esta obra.' using errcode = '42501'; end if;
    if v_mot is null then raise exception 'Indicá el motivo.' using errcode = '22023'; end if;
    update tc_movimiento set anulado_en = now(), anulado_por = v_uid, anulado_nombre = yo ->> 'nombre', anulado_motivo = v_mot where id = mov.id;
    perform public._tc_validar_saldos(ped.id);   -- p. ej. no se anula lo preparado si ya se envió
    perform public._tc_evento(ped.id, yo, 'Movimiento anulado', mov.tipo || ' ' || public._tc_fmt(mov.cantidad) || ' ' || ped.unidad || ' · ' || v_mot);

  else
    raise exception 'Acción desconocida: %', p_accion using errcode = '22023';
  end case;

  update tc_pedido set version = version + 1, actualizado_en = now() where id = ped.id returning version into v_n;
  res := jsonb_build_object('ok', true, 'id', ped.id, 'version', v_n::int);
  insert into tc_operacion (op, user_id, accion, pedido_id, resultado) values (p_op, v_uid, p_accion, ped.id, res);
  return res;
end $$;



revoke all on public.v_tc_pedido from anon;
grant select on public.v_tc_pedido to authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.tc_accion(uuid, text, integer, uuid, jsonb)', 'public.tc_detalle(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public._tc_validar_saldos(uuid) from public, anon, authenticated';
end $$;

commit;

select 'SQL 111 ok' as resultado,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tc_movimiento' and column_name in ('doc_tipo', 'doc_numero')) as columnas_doc_2,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_tc_pedido' and column_name = 'cierre_en') as vista_cierre_1,
  (select count(*) from public.tc_movimiento where tipo = 'prepara' and anulado_en is null) as preparados_viejos;
