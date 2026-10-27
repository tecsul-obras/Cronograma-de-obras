# SQL 60 · 61 · 62 — equipos-v65 (27/10/2026)

Correr en el **SQL Editor de Supabase**, uno por vez y en este orden.
Ninguno borra datos. Cada uno termina con una consulta de comprobación.

| # | Archivo | Qué hace | Comprobación esperada |
|---|---|---|---|
| 60 | `60_reporte_fallas_solicitada.sql` | Un *Reporte de Fallas* deja la OT **Solicitada**: solo se suma a otra OT Solicitada de la máquina, nunca a una Abierta. | `OK: reporte de fallas solo se suma a OT Solicitada` |
| 61 | `61_avisos_operador.sql` | Registro de cambios de operador habitual (`equipo_operador_cambios` + trigger), vista `v_avisos_operador` y función `operador_cambios_marcar_vistos`. El parte marca su origen antes de cambiar el operador. | `trigger_ok = 1` y la cantidad de máquinas con operador repetido |
| 62 | `62_accesorios_enganchados.sql` | Columna `equipos.enganchado_a`, reglas (sin cadenas, no a sí mismo) e historial `equipo_enganche_historial`. | `columna_ok = 1`, `triggers_ok = 2` |

Si falta alguno, la app sigue andando: sin el 61 no aparecen los avisos de
*cambio* de operador (el de "operador en varias máquinas" sí, porque se
calcula con la flota); sin el 62 no aparece el bloque de enganche.

`v_alertas_flota` no se toca: los avisos por correo y Power BI siguen igual.

Probado antes en un Postgres local con las mismas funciones: reporte de
falla con OT vieja Abierta → OT nueva Solicitada; segundo reporte → se suma
a la Solicitada (fallas y fotos); cambio de operador por app y por parte →
2 avisos; "Visto" los saca; enganche a un accesorio o desde un equipo con
accesorios → error claro.
