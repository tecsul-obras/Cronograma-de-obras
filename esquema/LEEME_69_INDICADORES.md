# SQL 69 — equipos-v76 (28/10/2026): lo que tenía Power BI y le faltaba a la app

Correr en el **SQL Editor de Supabase** `69_indicadores_taller.sql` (requiere el
SQL 68). No borra datos y se puede correr más de una vez. Termina con una
comprobación: todo mayor a 0 y `true`.

Después, **si se quieren las tarifas por hora de los técnicos**, correr
`69b_tarifas_tecnicos.sql` (NO está en GitHub porque tiene el costo por hora de
cada persona; sale de `Costo_Horas.xlsx` vía el Power BI «Control OT - Taller
nuevo»). Sin él, Horas y costos sigue sin costos hasta que se carguen las tarifas a mano.

Si la app nueva se publica antes de correr el SQL, todo lo anterior sigue
andando; las pantallas nuevas avisan «Falta correr el SQL 69».

## Qué agrega

| # | Qué | Dónde en la app | Base |
|---|---|---|---|
| 1 | **Ausencias del personal de taller** (ex Jotform «Reportes - Varios»): supervisor, una o varias personas, desde–hasta, motivo (Vacaciones, Receso en obra, Ausencia justificada), observaciones | Solapa **Ausencias de taller** (`ausencias.js`). Cargan supervisores (especialidad SUPERVISOR, con usuario), taller y admin central; gerente ve. Corrige / borra: taller y admin central, o el supervisor lo suyo | `taller_ausencias`, `puede_cargar_ausencias()`, `v_taller_ausencias_dia` |
| 1 | **Cada día de cada persona**: horas cargadas en OT o el motivo de la ausencia (colores como Power BI) | Órdenes de trabajo › Horas y costos › **Por día** | — |
| 2 | **Disponibilidad %** por equipo, tipo o asignación y por mes (desde 10/2025: OT de taller, OT de pista ≥ 6 h, paro del parte > 6 h, Inoperativo en flota) | Solapa **Indicadores** › Disponibilidad (`indicadores.js`); tocando una fila, los días parados con su motivo | `equipo_dia_estado()`, `indicadores_equipo_mes()` |
| 3 | **Utilización %**: horas del parte contra horas laborales (10 h × lun-vie 1, sáb ½, dom/feriado 0) y contra horas mínimas | Indicadores › Utilización | `feriados`, `dia_laboral()`, `equipos.horas_minimas_mes` |
| 3 | **Feriados** (cargados 2024–2027) | Administración › Catálogos › **Calendario** | `feriados` |
| 4 | **Productividad del taller**: horas en OT ÷ (10 h × días disponibles), trabajo vs. traslado, por persona o por supervisor | Horas y costos › **Productividad** | — |
| 4 | **Cargo, supervisor y taller designado** del técnico | Personal › ficha de la persona | `operadores.cargo / supervisor_cedula / taller_designado` |
| 5 | **Control de carga**: equipos asignados sin parte o sin carga de combustible hace N días | Indicadores › Control de carga (y botón en Alertas) | `v_alertas_carga` |
| 6 | **Rendimiento semanal** contra meta y máximo, y **ranking de sobreconsumo** | Control de combustible › Rendimiento semanal / Sobreconsumo; meta y máximo también en Consumo por equipo | `combustible_semanal()`, `equipos.consumo_meta_lh / consumo_max_lh` |

Meta, máximo y horas mínimas se editan en **Flota › ficha › Consumo y valores**.

## Reglas

- **Días disponibles (productividad)**: lunes a sábado sin feriados, hasta hoy, menos
  los días con ausencia. Se excluyen del listado quienes tienen cargo «AUXILIAR …».
  Por supervisor solo cuentan los días de quienes cargaron horas.
- **Días laborales (utilización)**: lun-vie 1, sábado ½, domingo y feriado 0 (igual que
  el reporte «Maquinaria - Ocupación»). Horas mínimas del período = mínimas del mes ×
  días del período en ese mes ÷ días del mes. Si la ficha no tiene mínimas, se usa el
  Mínimo Hr del maestro de tarifas.
- **Control de carga**: equipos y vehículos activos que llevan parte, con asignación
  (no «Sin Asignación» ni Taller) y no Inoperativos. Combustible = despacho del
  formulario de combustible o gasoil > 0 declarado en el parte.
- **Consumo semanal**: litros de gasoil despachados ÷ horas de horómetro de los partes
  (semana de lunes a domingo). Sin meta cargada se usa el consumo promedio; sin
  máximo, meta × 1,2. Variación como Power BI: sobre el máximo (L/h − máx)/máx; bajo la
  meta −(meta − L/h)/meta; entre los dos, 0.
- `v_equipo_dia_estado` (SQL 68) ahora llama a `equipo_dia_estado()`: misma cuenta,
  mismas columnas; la app y Power BI ven lo mismo.

## Carga inicial (desde los Power BI)

- Feriados 2024–2025: los del reporte Ocupación. 2026–2027: las fechas de la ley;
  si el Ejecutivo traslada uno (1/3, 12/6, 29/9 suelen moverse), corregir en Administración.
- Horas mínimas por mes: «Tarifario Máquinas» (Ocupación), 132 equipos.
- Meta y máximo L/h: «SP_Metas» (Control Combustible), 131 equipos. VC-13 y VC-14 tenían el
  máximo por debajo de la meta: se cargan con meta × 1,2.
- Cargo, supervisor y taller designado: «SP_Salarios» (Control OT - Taller nuevo).
  Se agrega la supervisora 3726182 (FLEITAS MALDONADO, MARGARET), que estaba en el
  formulario de Jotform y no en el catálogo. No pisa lo cargado a mano.

## Power BI (función `powerbi`, vistas nuevas)

`v_powerbi_feriados`, `v_powerbi_taller_ausencias_dia`, `v_powerbi_indicadores_equipo_mes`,
`v_powerbi_combustible_semanal`, `v_powerbi_alertas_carga`; `v_powerbi_personal` suma
cargo, supervisor y taller al final.

## Supervisores

Los supervisores entran con su usuario de **taller** (rol taller → cargan ausencias).
Como esos usuarios tienen un nombre de usuario en vez de la cédula, el formulario los
reconoce como supervisor por el nombre (Lucas Cristaldo → LUCAS CRISTALDO del catálogo).

## SQL 70 (29/10/2026)

`70_consumo_por_periodo.sql`: Control de combustible › Consumo por equipo daba
«statement timeout» (la vista sumaba los 46 mil partes antes de filtrar el mes). La
función `combustible_consumo(desde, hasta)` filtra primero: 9 ms en vez de 7,5 s.
La app la usa sola; sin el SQL 70 sigue con la vista.

## Probado antes

En un Postgres 16 local con las tablas reales (sin datos) y datos de prueba: el SQL
dos veces seguidas, permisos (supervisor carga, mecánico no ve ni carga, gerente solo ve,
admin corrige, feriados solo admin), cuentas de disponibilidad / utilización / semanal /
control de carga. Las consultas, en solo lectura sobre los datos reales (control de carga
~50 ms, un mes de equipo × día ~150 ms). La app con Playwright (escritorio y celular):
carga de ausencias de dos personas, Por día, Productividad, Indicadores, detalle de un
equipo, Control de carga, Rendimiento semanal, Sobreconsumo, sin errores de consola.
