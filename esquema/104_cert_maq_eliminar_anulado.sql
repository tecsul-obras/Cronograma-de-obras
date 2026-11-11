-- 104 · Certificado de máquinas: eliminar un certificado ANULADO (solo admin central)
-- Antes: el disparador solo frenaba borrar un EMITIDO; un anulado lo podía borrar
-- cualquiera que edita certificados (admin central y gerente).
-- Ahora: borrador → lo borra quien edita (igual que antes); emitido → no se borra
-- (reabrir primero); anulado → solo admin central.
-- No hay tablas que apunten a cert_maq (verificado 11/11/2026): borrar no deja huérfanos.

create or replace function public.cert_maq_proteger() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'emitido' then raise exception 'El certificado N° % está emitido: reabrilo antes de borrarlo', old.numero; end if;
    if old.estado = 'anulado' and coalesce(public.mi_rol()::text, '') <> 'admin_central' then
      raise exception 'Solo un administrador central puede eliminar el certificado anulado N° %', old.numero;
    end if;
    return old;
  end if;
  if old.estado = 'emitido' and new.estado = 'emitido' then
    raise exception 'El certificado N° % está emitido: reabrilo para editarlo', old.numero;
  end if;
  new.actualizado_en := now();
  if new.estado = 'emitido' and old.estado is distinct from 'emitido' then new.emitido_en := now(); end if;
  return new;
end $$;

-- verificación: debe devolver 1 fila con «ok»
select 'ok' as verificacion
from pg_proc where proname = 'cert_maq_proteger' and prosrc like '%admin_central%';
