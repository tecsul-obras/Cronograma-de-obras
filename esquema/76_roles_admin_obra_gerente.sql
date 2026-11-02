-- =========================================================================
-- 76 · ROLES (02/11/2026)
--
--  A. OBRAS · rol nuevo «Administrador de obra» (admin_obra)
--     Ve todo en sus obras (como el residente: sin obras marcadas = todas) y
--     carga / corrige SOLO Producción, Transporte (cargas y stock) y Compras
--     (pedidos, cotizaciones, OC, adjuntos, importar de Monday, enlazar,
--     «ya pedido fuera de la app»). Cronograma, plan semanal, certificación,
--     cómputo, convenios, comunicaciones, situación de pista: solo ver.
--     Ve costos y tarifas de flete igual que el residente.
--
--  B. EQUIPOS · el rol «Gerente» no se podía guardar: faltaba en el tipo
--     rol_usuario y en adm_perfil_guardar («Rol de equipos no válido»).
--     No tenía que ver con tener también gerente en Obras.
--     Ahora además el gerente de Equipos:
--       · ve todos los partes, flota, documentos, mantenimiento, combustible y
--         seguros (antes las reglas de la base no lo dejaban ver casi nada);
--       · EDITA la flota (tabla, estado, ficha, documentos, catálogos, nuevo
--         equipo, enganches) y los certificados de máquinas (+ tarifas).
--     Alquileres y mantenimiento siguen solo para ver.
--
--  Se puede correr más de una vez. Comprobación al final.
-- =========================================================================

-- Para cambiar un pedazo de una función existente sin copiarla entera.
-- Si el texto viejo no está y el nuevo sí, ya se había aplicado: no hace nada.
create or replace function pg_temp.parchar(p_fn regprocedure, p_viejo text, p_nuevo text) returns void
language plpgsql as $$
declare d text;
begin
  d := pg_get_functiondef(p_fn);
  if position(p_viejo in d) = 0 then
    if position(p_nuevo in d) > 0 then return; end if;
    raise exception 'SQL 76: no encontré en % el texto «%»', p_fn, p_viejo;
  end if;
  execute replace(d, p_viejo, p_nuevo);
end $$;

-- ═════════════════════════════ A · OBRAS ═════════════════════════════

alter table public.usuario drop constraint if exists usuario_rol_check;
alter table public.usuario add constraint usuario_rol_check check (rol = any (array[
  'admin', 'residente', 'consulta', 'lectura', 'transporte', 'produccion', 'compras', 'gerente', 'rrhh', 'admin_obra']));

select pg_temp.parchar('public.adm_usuario_guardar(jsonb)'::regprocedure,
  $x$'compras', 'gerente', 'rrhh') then$x$, $x$'compras', 'gerente', 'rrhh', 'admin_obra') then$x$);

-- ¿Puede cargar / corregir en este módulo de la obra?
--   admin y residente: todo · admin de obra: producción, transporte y compras
create or replace function public.app_edita_modulo(p_obra text, p_modulo text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select public.app_puede_escribir(p_obra)
      or (coalesce(public.app_rol() = 'admin_obra', false)
          and p_modulo in ('produccion', 'transporte', 'compras')
          and public.app_puede_ver(p_obra))
$$;
grant execute on function public.app_edita_modulo(text, text) to authenticated;

create or replace function public._exigir_modulo(p_obra text, p_modulo text)
 returns void language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if public.app_rol() is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not public.app_edita_modulo(p_obra, p_modulo) then
    raise exception 'Sin permiso de escritura en la obra %', p_obra using errcode = '42501';
  end if;
end $$;

-- campo (transporte / produccion) carga lo suyo; admin de obra, residente y admin todo
create or replace function public.app_puede_cargar(p_obra text, p_modulo text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select public.app_edita_modulo(p_obra, p_modulo)
      or (public.app_rol() = p_modulo and public.app_puede_ver(p_obra))
$$;

create or replace function public._exigir_carga_propia(p_obra text, p_modulo text, p_cargado_por text)
 returns void language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if public.app_edita_modulo(p_obra, p_modulo) then return; end if;   -- corrige lo de cualquiera
  perform public._exigir_carga(p_obra, p_modulo);
  if coalesce(p_cargado_por, '') <> public.app_email() then
    raise exception 'Solo podés corregir lo que cargaste vos.' using errcode = '42501';
  end if;
end $$;

create or replace function public.app_puede_comprar(p_obra text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select public.app_edita_modulo(p_obra, 'compras')
      or (public.app_rol() = 'compras' and public.app_puede_ver(p_obra))
$$;

create or replace function public.app_ve_costos(p_obra text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce(public.app_rol() in ('admin', 'gerente', 'residente', 'admin_obra'), false) and public.app_puede_ver(p_obra)
$$;

create or replace function public.app_ve_tarifas(p_obra text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce(public.app_rol() in ('admin', 'residente', 'gerente', 'compras', 'admin_obra'), false) and public.app_puede_ver(p_obra)
$$;

alter policy leer on public.flete_tarifa
  using (((select public.app_rol()) = any (array['admin', 'residente', 'gerente', 'compras', 'admin_obra']))
         and ((select public.app_ve_todas_obras()) or (obra_id = any ((select public.app_obras_usuario())::text[]))));

-- compras: importar de Monday, enlazar recursos, «ya pedido fuera de la app»
select pg_temp.parchar('public.compra_importar'::regproc::regprocedure,
  'PERFORM public._cron_exigir_escritura(p_obra);', $x$PERFORM public._exigir_modulo(p_obra, 'compras');$x$);
select pg_temp.parchar('public.compra_enlazar'::regproc::regprocedure,
  'PERFORM public._cron_exigir_escritura(p_obra);', $x$PERFORM public._exigir_modulo(p_obra, 'compras');$x$);
select pg_temp.parchar('public.compra_ajuste_guardar'::regproc::regprocedure,
  'PERFORM public._cron_exigir_escritura(p_obra);', $x$PERFORM public._exigir_modulo(p_obra, 'compras');$x$);

-- transporte: stock (conteos) y el encargado de una carga
select pg_temp.parchar('public.stock_conteo_guardar'::regproc::regprocedure,
  'PERFORM public._cron_exigir_escritura(p_obra);', $x$PERFORM public._exigir_modulo(p_obra, 'transporte');$x$);
select pg_temp.parchar('public.stock_conteo_borrar'::regproc::regprocedure,
  'PERFORM public._cron_exigir_escritura(p_obra);', $x$PERFORM public._exigir_modulo(p_obra, 'transporte');$x$);
select pg_temp.parchar('public.tr_editar'::regproc::regprocedure,
  $x$AND public.app_puede_escribir(p_obra) THEN$x$, $x$AND public.app_edita_modulo(p_obra, 'transporte') THEN$x$);

-- fotos de producción y transporte
alter policy fotos_obra_subir on storage.objects
  with check ((bucket_id = 'fotos-obra') and (public.app_puede_escribir((storage.foldername(name))[1])
    or ((public.app_rol() = any (array['produccion', 'transporte', 'admin_obra'])) and public.app_puede_ver((storage.foldername(name))[1]))));
alter policy fotos_obra_reemplazar on storage.objects
  using ((bucket_id = 'fotos-obra') and (public.app_puede_escribir((storage.foldername(name))[1])
    or ((public.app_rol() = any (array['produccion', 'transporte', 'admin_obra'])) and public.app_puede_ver((storage.foldername(name))[1]))))
  with check ((bucket_id = 'fotos-obra') and (public.app_puede_escribir((storage.foldername(name))[1])
    or ((public.app_rol() = any (array['produccion', 'transporte', 'admin_obra'])) and public.app_puede_ver((storage.foldername(name))[1]))));

-- ═════════════════════════════ B · EQUIPOS ═════════════════════════════

alter type public.rol_usuario add value if not exists 'gerente';

select pg_temp.parchar('public.adm_perfil_guardar(jsonb)'::regprocedure,
  $x$if v_rol not in ('operador', 'admin_obra', 'taller', 'admin_central') then$x$,
  $x$if v_rol not in ('operador', 'admin_obra', 'taller', 'gerente', 'admin_central') then$x$);

-- quién edita flota y certificados (se compara como texto: sirve en la misma corrida que agrega 'gerente')
create or replace function public.edita_flota() returns boolean
 language sql stable security definer set search_path to 'public'
as $$ select coalesce(mi_rol()::text in ('admin_central', 'taller', 'gerente'), false) $$;
create or replace function public.edita_certificados() returns boolean
 language sql stable security definer set search_path to 'public'
as $$ select coalesce(mi_rol()::text in ('admin_central', 'gerente'), false) $$;
grant execute on function public.edita_flota() to authenticated;
grant execute on function public.edita_certificados() to authenticated;

-- ver: flota (y con eso documentos, estado, historial, mantenimiento y combustible vía ve_gestion)
create or replace function public.ve_flota() returns boolean
 language sql stable security definer set search_path to 'public'
as $$ select coalesce(mi_rol()::text in ('admin_central', 'taller', 'admin_obra', 'gerente'), false) $$;

drop policy if exists partes_lectura_gerente on public.partes;
create policy partes_lectura_gerente on public.partes for select to authenticated
  using (coalesce((select public.mi_rol())::text, '') = 'gerente');

drop policy if exists seguros_gerente_lee on public.seguros;
create policy seguros_gerente_lee on public.seguros for select to authenticated
  using ((select public.ve_alquileres()));

-- editar flota
alter policy equipos_escritura          on public.equipos           using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy equipo_estado_escritura    on public.equipo_estado     using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy asignaciones_escritura     on public.asignaciones      using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy documentos_escritura       on public.documentos        using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy cat_disponibilidad_escritura on public.cat_disponibilidad using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy cat_marcas_escritura       on public.cat_marcas        using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy cat_tipos_equipo_escritura on public.cat_tipos_equipo  using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy cat_ubicaciones_escritura  on public.cat_ubicaciones   using ((select public.edita_flota())) with check ((select public.edita_flota()));
alter policy documentos_sube  on storage.objects with check ((bucket_id = 'documentos') and public.edita_flota());
alter policy documentos_borra on storage.objects using ((bucket_id = 'documentos') and public.edita_flota());

select pg_temp.parchar('public.catalogo_renombrar'::regproc::regprocedure,
  $x$if not es_taller() then raise exception 'Solo taller o administración'; end if;$x$,
  $x$if not public.edita_flota() then raise exception 'Solo taller, gerencia o administración'; end if;$x$);
select pg_temp.parchar('public.catalogo_eliminar'::regproc::regprocedure,
  $x$if not es_taller() then raise exception 'Solo taller o administración'; end if;$x$,
  $x$if not public.edita_flota() then raise exception 'Solo taller, gerencia o administración'; end if;$x$);

-- editar certificados de máquinas y tarifas
alter policy cert_maq_escribe on public.cert_maq using ((select public.edita_certificados())) with check ((select public.edita_certificados()));
alter policy tarifas_admin on public.tarifas_equipos using (public.edita_certificados()) with check (public.edita_certificados());
select pg_temp.parchar('public.certificado_maquinas'::regproc::regprocedure,
  'where es_admin()', 'where public.edita_certificados()');
select pg_temp.parchar('public.tarifas_importar'::regproc::regprocedure,
  $x$if not es_admin() then raise exception 'Solo admin_central'; end if;$x$,
  $x$if not public.edita_certificados() then raise exception 'Solo administración o gerencia'; end if;$x$);

-- ═════════════════════════════ Comprobación ═════════════════════════════
select
  (select pg_get_constraintdef(oid) like '%admin_obra%' from pg_constraint where conname = 'usuario_rol_check') as obras_rol_admin_obra_t,
  (select prosrc like '%''admin_obra'') then%' from pg_proc where proname = 'adm_usuario_guardar') as obras_guardar_t,
  (select count(*) from pg_proc where proname in ('compra_importar', 'compra_enlazar', 'compra_ajuste_guardar', 'stock_conteo_guardar', 'stock_conteo_borrar') and prosrc like '%_exigir_modulo%') as modulos_5,
  (select prosrc like '%''gerente'', ''admin_central'') then%' from pg_proc where proname = 'adm_perfil_guardar') as equipos_guardar_gerente_t,
  (select count(*) from pg_policies where policyname in ('equipos_escritura', 'equipo_estado_escritura', 'asignaciones_escritura', 'documentos_escritura',
     'cat_disponibilidad_escritura', 'cat_marcas_escritura', 'cat_tipos_equipo_escritura', 'cat_ubicaciones_escritura', 'documentos_sube', 'documentos_borra')
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%edita_flota%') as flota_10,
  (select count(*) from pg_policies where policyname in ('cert_maq_escribe', 'tarifas_admin') and qual like '%edita_certificados%') as cert_2;
-- Debe dar: t · t · 5 · t · 10 · 2
-- (el valor 'gerente' del tipo rol_usuario queda disponible al terminar esta corrida)

-- Volver atrás (resumen): usuario_rol_check sin admin_obra; app_puede_cargar / app_puede_comprar /
-- _exigir_carga_propia con app_puede_escribir; las políticas de flota con es_taller(); cert_maq_escribe y
-- tarifas_admin con es_admin(). El valor 'gerente' del tipo no se puede quitar (no molesta).
