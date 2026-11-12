# Compras › ⭐ Estratégicas UCC (SQL 110) · v20261112c

Sección nueva del módulo Compras, al lado de **Obras** y **🔧 Taller**
(`compras/index.html` › ⭐ Estratégicas UCC, o `compras/index.html?s=ucc`).
Reemplaza el tablero «Compras Estratégicas UCC» de Monday: el taller manda sus
pedidos especiales por ahí y los ve la gente de Compras.

## Cómo funciona

| | Taller (TAL-) | Estratégicas UCC (UCC-) |
|---|---|---|
| Número | TAL-000001… | UCC-000001… (serie propia) |
| Bodega central | Sí, decide stock / comprar | **No pasa por bodega**: entra directo a Compras › Cotización |
| Compras devuelve | — | **Pedir aclaración** (vuelve al solicitante) o **Rechazar**, con motivo, mientras no haya autorización pedida ni compra. Un rechazado se puede **reabrir**. |
| El solicitante edita / anula | Hasta que bodega decide | Hasta que compras carga la primera cotización, o cuando compras le pidió aclaración |
| Cotizaciones, autorización, compra, entregas parciales, fotos y PDF | Igual | Igual (mismas reglas, mismas tablas) |
| Bandeja, Excel y KPIs | Solo TAL | Solo UCC |

**Quién carga:** los mismos que piden en Taller (personal de taller, admin de obra
en sus obras, o permiso «Pedir»). **Quién trabaja:** compras cotiza y registra; el
autorizador autoriza (quien pide la autorización no la resuelve). Los permisos son
los de **Compras › Taller › 🔑 Permisos**: no hay permisos nuevos.

## Desplegar

1. Correr `esquema/110_compras_estrategicas_ucc.sql` en el SQL Editor de Supabase.
   Va en una transacción; termina con `SQL 110 ok · pedidos_taller · pedidos_ucc · vista_con_canal = 1`.
   Se puede correr más de una vez.
2. Publicar la app (caché `obra-shell-v96`).

Sin el SQL 110 la sección UCC muestra «Falta correr el SQL 110» y no deja cargar
(para no crear pedidos TAL por error). Taller sigue igual antes y después.

**Ojo:** después del 110 no volver a correr el 79 solo (vuelve a armar la vista
sin el canal y da error). Si hiciera falta, correr el 79 y enseguida el 110.

## Qué cambia en la base

- `tc_pedido.canal` ('taller' | 'ucc', por defecto 'taller'); secuencia `tc_pedido_num_ucc`;
  el número pasa a ser único por canal (`tc_pedido_canal_numero_uq`).
- `v_tc_pedido`: código `UCC-` y etapa nueva `aclaracion` (UCC devuelto al solicitante).
- `tc_pedido_crear` acepta `canal`; `tc_accion` agrega `ucc_aclaracion`, `ucc_rechazar`,
  `ucc_reabrir` y rechaza las acciones de bodega en UCC; `tc_listar` y `tc_kpis` filtran
  por `canal` (sin canal = taller, como antes).

Probado en Postgres 16 local con las funciones reales del 79 y 99 (pedido TAL viejo
antes del 110, 110 corrido dos veces): crear UCC, bandejas separadas, editar sin
cotización, sin bodega, aclaración y corrección, no editar ni anular con cotización,
no rechazar con autorización pedida, autorizar → comprar → recibir (cerrado),
rechazar y reabrir, TAL nuevo sigue en bodega, KPIs separados.
Pantalla: `node compras/pruebas/ucc_ui.test.cjs` (y `taller_ui.test.cjs` sigue OK).

## Pendiente de decidir (no se inventaron reglas)

- Si los pedidos UCC necesitan **otro autorizador o un límite de monto** distinto al de taller.
- Si conviene pasar a UCC los pedidos viejos del tablero de Monday (hoy no se importan).
