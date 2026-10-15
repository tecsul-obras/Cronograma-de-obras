-- =========================================================================
-- 42_horometro_sin_saltos.sql · v20261015b
--
-- Registra la regla "horometro_sin_saltos" para que aparezca en
-- Parte diario › Administración › Reglas y se pueda apagar (1 = activa).
--
-- Con la regla activa, el horómetro inicial del parte tiene que ser IGUAL
-- al horómetro final del parte anterior de esa máquina (tolerancia 0,05 h).
-- La app ya la aplica aunque este SQL no se haya corrido (por defecto 1).
-- Si una máquina cambia de horómetro, se apaga la regla un momento o se
-- corrige el parte anterior.
-- =========================================================================
insert into public.form_reglas (clave, valor, descripcion, unidad)
values ('horometro_sin_saltos', '1',
        'El horómetro inicial debe ser igual al final del parte anterior del equipo (no se permiten saltos).',
        null)
on conflict (clave) do nothing;

-- REVERTIR: delete from public.form_reglas where clave = 'horometro_sin_saltos';
