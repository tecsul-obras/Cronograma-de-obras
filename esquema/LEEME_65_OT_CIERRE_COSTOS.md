# SQL 65 — equipos-v70 (27/10/2026)

Correr en el **SQL Editor de Supabase** `65_ot_cierre_y_costos_taller.sql`.
No borra datos y se puede correr más de una vez. Termina con una consulta de
comprobación: `trigger_ok_1 = 1`, `reparado_fm_true = true`,
`tercerizado_true = true`, `esperando_false = false`, `columnas_v_ot_2 = 2`,
`columnas_horas_3 = 3` y cuántas OT tienen el tipo estimado.

Si la app nueva se publica antes de correrlo, todo sigue andando como antes
(sin las reglas de cierre en la base, sin tipo estimado ni costos).

## Qué cambia

| | Antes | Ahora |
|---|---|---|
| Tipo de OT | Columna «Taller/Pista» al final, casi siempre vacía | Columna **Tipo OT** al lado del estado. Si no se cargó, se estima: ubicación TALLER CENTRAL = Taller, otra = Pista (se ve con «≈») |
| Cerrar OT de **pista** | Cualquier estado | Solo con la máquina **Reparado**, **Reparado- Fallas menores** o **Servicio Tercerizado** (formulario y bandeja) |
| Cerrar OT de **taller** | Desde el registro o la bandeja | Solo con la **Inspección Final - Taller**. «Cerrar OT» en la bandeja lleva al formulario con la OT elegida. En el Registro de Trabajos, «Trabajo Finalizado = SI» guarda el registro y abre la Inspección Final |
| OT cerrada | No aceptaba más registros | Acepta **Registro de Trabajos** durante **48 h** (para que los demás mecánicos carguen sus horas). No cambia el estado de la OT ni de la máquina |
| Horómetro en el reporte de taller | A mano | Se completa con el **último horómetro / km del parte diario** de la máquina (se puede corregir) |
| Horas por técnico | Solo por técnico y mes, solo horas por componente | **Horas y costos**: por técnico, por máquina y por OT, con período desde/hasta; suma también horas de mantenimiento (service) y de traslado; costo = horas × tarifa |
| Tarifa horaria | — | Tabla `tecnico_tarifas` (con fecha «desde»: un aumento no cambia el costo de lo anterior). Carga el **admin central**; ven costos admin central y gerente; taller ve solo horas |
| Mantenimiento | Sin responsable | Columnas **Responsable** y **Asignación**; filtros por responsable, estado del service, asignación, tipo de equipo, estado de la máquina, control por (horas/km/días) y categoría; las tarjetas cuentan con los filtros |

Las OT sin máquina (servicios generales, trabajos internos) no tienen las
reglas de cierre.

Al **tomar** una OT solicitada desde la bandeja se elige si es de taller o de
pista. En el Registro de Trabajos con «¿Ya tienes OT? = NO» y una máquina, se
pide el tipo de OT.

## Probado antes

En un Postgres 16 local con las funciones reales (ot_registrar, triggers) y la
app completa contra esa base (PostgREST, RLS como admin, taller y gerente):
pista con «Esperando repuestos» + SI → queda abierta con aviso; con «Reparado-
Fallas menores» → se cierra; otro mecánico carga horas en la OT cerrada → se
guarda sin estado y la OT sigue cerrada; a las 72 h → error; OT de taller con SI
→ queda abierta; bandeja cierra OT de taller → bloqueado; Inspección Final →
cierra; pista desde bandeja con «Esperando pruebas en Campo» → bloqueado, con
«Servicio Tercerizado» → cierra; sin máquina → cierra libre; tarifas: taller no
puede cargar ni ve costos, admin sí, gerente ve; horómetro del último parte en
Inspección Final y Registro; filtros de Mantenimiento por responsable.
