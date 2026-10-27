# SQL 63 · 63b · 64 — equipos-v68 (27/10/2026)

Correr en el **SQL Editor de Supabase**, uno por vez y en este orden.
Ninguno borra datos. Cada uno termina con una consulta de comprobación.

| # | Archivo | Qué hace | Comprobación esperada |
|---|---|---|---|
| 63 | `63_recursos_mantenimiento.sql` | Tablas de recursos de mantenimiento (`mant_listas`, `mant_codigos`, `mant_recursos`, `mantenimiento_recursos`), columna `equipos.lista_recursos_id`, kit estándar automático al registrar un preventivo, funciones para guardar / recargar lo usado, vista de totales, permisos (ven admin, taller y gerencia; editan admin y taller). Pasa los planes con ciclo 250/500/750/1.000 al ciclo **250 → 2.000**. | `tablas_ok_4 = 4`, `trigger_ok_1 = 1`, `kit_750_es_250 = 250`, `kit_2000_es_2000 = 2000` y cuántos planes quedaron con el ciclo nuevo |
| 63b | `63b_recursos_mantenimiento_datos.sql` (solo en la carpeta de Drive) | Carga el Excel *RECURSOS PARA MANTENIMIENTOS*: 85 listas, 963 renglones, códigos con su color (SIS / compatible / a verificar) y los precios de las hojas Moto120/Moto140. Asigna cada lista a sus equipos (solo si no tenían una). Se puede correr dos veces: no duplica. | Cantidad de listas, renglones, equipos con lista, códigos y códigos con precio; y abajo, los equipos del Excel que **no existen en Flota** (quedan sin asignar) |
| 64 | `64_personal_ultima_maquina.sql` | Personal: `personal_resumen` devuelve la última máquina operada (equipo, tipo, fecha y si es de terceros). | `columnas_nuevas_4 = 4` |

**El 63b no va a GitHub** (tiene códigos y precios de la empresa): solo está
en esta carpeta.

Si falta el 63, la app sigue andando: la tarjeta de recursos y las subsolapas
nuevas muestran «Falta correr el SQL 63». Si falta el 64, Personal anda igual
pero la columna «Última máquina» queda vacía.

## Lo que hay que saber del Excel

- Solo **22 de las 85 listas** (218 de 963 renglones) tienen marcado en qué service va cada recurso
  (columnas 250 hs / 1.000 hs / 2.000 hs). El resto queda «sin service»: se
  ve en la ficha, pero **no entra en el kit automático** hasta que se le
  marque el service (desde la app o con *Subir Excel*). La subsolapa
  *Listas de recursos* tiene la tarjeta «Renglones sin service» para
  encontrarlos.
- El bloque de PC-05 / PC-06 (Sany) estaba corrido una columna en el Excel:
  se leyó corrido. Los grupos repetidos (cucharones de EX-05 / EX-07 / EX-11,
  segundo ZM-01, EX17) se sumaron a la lista del equipo.
- Las listas se llaman con la marca y el modelo de la ficha del primer equipo.
  Dos grupos del Excel con el mismo modelo (p. ej. MN-01/02/04 y MN-07,
  ambos CAT 140K) quedan como **dos listas con el mismo nombre**: se pueden
  dejar así o unir pasando los equipos a una (Listas › Nombre y equipos).

## Probado antes

En un Postgres local con las mismas funciones y permisos (RLS real como
admin, taller y operador), y la app completa contra esa base:
service 1.000 h de MN-01 → 13 recursos (kit 1.000 h); 750 h → 10 (kit 250);
correctivo → nada; equipo sin lista → nada; el operador no ve ni guarda
recursos; taller sí; «Volver al kit estándar» y «Guardar y confirmar»;
precio uno por código; recurso «solo para MN-01»; Excel bajar → editar →
subir (con lista nueva); Personal con última máquina y de terceros.
