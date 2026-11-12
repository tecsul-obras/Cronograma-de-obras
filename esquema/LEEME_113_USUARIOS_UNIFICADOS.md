# SQL 113 · Usuarios unificados (v20261112g · obra-shell-v99 · equipos-v112)

## Qué cambia
- **Una sola pantalla de usuarios** (`usuarios.js`): la misma en **Obras › Administración** y en **Equipos › Administración › Usuarios**.
- En la ficha (✎) de cada persona está todo:
  - Cuenta (cédula o correo, contraseña).
  - Rol en **Obras** (+ obras que ve).
  - Rol en **Equipos** (+ frentes) — ahora también **Compras (taller)** desde esta pantalla.
  - **Formularios a medida** (parte, taller, combustible) para cualquier rol. Ej.: Compras (taller) + Carga de combustible.
  - **Compras de taller**: ver, solicitar (obras), bodega, compras, autorizar (misma tabla que Compras › Taller › Permisos, que sigue funcionando).
  - **Plantas**: encargado / operador / báscula por planta (misma tabla que Plantas › Configuración › Personal).
  - **Responsable de máquinas** (lista de Flota) y **aprueba partes certificados**.
  - **Recursos humanos** además del rol (ver o editar).
- Columna «Además» en la tabla, filtro «Con permisos a medida» y Exportar.

## Quién edita
- Administrador de Obras: todo.
- Admin central de Equipos: todo menos el rol en Obras (lo ve en gris).

## Regla de formularios
Antes Compras, Taller, Admin de obra y Gerente tenían formularios fijos (lo marcado a mano se ignoraba). Ahora **lo marcado a mano manda para todos**; «Automático» sigue igual. La primera vez que se corre, a esos 4 roles se les limpia lo marcado a mano (no tenía efecto), así nadie gana ni pierde un formulario. Si se vuelve a correr, no toca nada.

## Pasos
1. Supabase › SQL Editor › correr `113_usuarios_unificados.sql`. Debe dar: `4 · t · t · t · (número)`.
2. Publicar el código (rama `usuarios-unificados-113` → main).
3. Probar: Obras › Administración › ✎ una persona de compras de taller → destildar «Automático» → tildar «Carga de combustible» → Guardar. Esa persona, al entrar a Equipos, ve «Carga de combustible».

No hace falta tocar la Edge Function «usuarios».
