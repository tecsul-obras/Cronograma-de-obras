# 76 · Roles: Administrador de obra (Obras) y Gerente (Equipos) — 02/11/2026

App v20261102c (obra-shell-v78) · equipos-v82.

## Orden

1. Correr **`76_roles_admin_obra_gerente.sql`** en el SQL Editor de Supabase.
   Al final debe dar: `t · t · 5 · t · 10 · 2`.
2. Publicar la app (rama `roles-admin-obra-gerente` → `main`).

Si se publica la app antes del SQL no se rompe nada: elegir «Administrador de obra»
avisa «Rol no válido» y el gerente de Equipos sigue sin poder guardarse.

Probado sobre la base real dentro de una transacción que se deshizo al final
(no quedó nada escrito): un usuario admin_obra de prueba dio
producción ✔ · transporte ✔ · compras ✔ · cronograma ✘ · certificación ✘ · costos (ver) ✔.

## A · Obras: rol nuevo «Administrador de obra»

Administración › persona › **Rol en Obras › Administrador de obra** (y las obras que ve;
ninguna marcada = todas, igual que el residente).

| Pestaña | Administrador de obra |
|---|---|
| Cronograma / Plan semanal | ve |
| **Producción** | carga y corrige (lo de cualquiera, con fotos) |
| Certificación / Cómputo / Convenios / Situación de pista | ve |
| **Transporte** (cargas, encargado, stock / conteos) | carga y corrige |
| Transporte › maestro de camiones | ve |
| **Compras** (pedidos, cotizaciones, OC, adjuntos, importar de Monday, enlazar recursos, «ya pedido fuera de la app») | carga y corrige |
| Compras › cargar recursos por ítem | no (es del cronograma: residente / admin) |
| Costos y tarifas de flete | ve |
| Comunicaciones | ve |
| Administración / RRHH | no |

En la base: función nueva `app_edita_modulo(obra, módulo)`; `app_puede_cargar`,
`app_puede_comprar` y `_exigir_carga_propia` la usan.

## B · Equipos: Gerente

**Por qué no dejaba poner gerente:** el rol «gerente» de Equipos nunca había
llegado a la base (faltaba en el tipo `rol_usuario` y en la función que guarda
el perfil). Daba «Rol de equipos no válido». No era por tenerlo también en Obras:
se puede ser gerente en los dos.

Con el 76 el gerente de Equipos:
- **ve** todos los partes, flota, estado, documentos, mantenimiento, combustible,
  OT, alquileres y seguros;
- **edita la flota**: tabla (estado, disponibilidad, asignación, ubicación,
  responsable, operador, varios a la vez), ficha técnica, documentos, nuevo equipo,
  enganches y los catálogos (agregar / renombrar);
- **edita los certificados de máquinas** (crear, emitir, reabrir, anular) y el
  maestro de tarifas (agregar, corregir, importar de Unysoft);
- sigue **sin formularios** (parte, taller, combustible) y solo ve alquileres y
  mantenimiento.

## Volver atrás
Ver el final del archivo SQL. El valor 'gerente' del tipo `rol_usuario` no se
puede quitar (no molesta).
