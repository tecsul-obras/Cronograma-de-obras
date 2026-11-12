# Compras › Taller / UCC: envío directo, documento y cierre con lo entregado (SQL 111) · v20261112d

Pedido de José (12/11/2026), sobre la pantalla «Preparado en bodega».

## Qué cambia

1. **Sin «Preparado en bodega».** Cuando el pedido está en Entrega, bodega registra
   directamente el **Envío a obra**: enviar → la obra confirma lo recibido.
   Lo enviado no puede superar lo que hay en central para el pedido (lo pedido si sale
   de stock; lo recibido del proveedor si fue compra). Los «preparado» que ya existen
   quedan en el historial como «paso anterior» (no cuentan, se pueden anular).
2. **Documento del envío.** El envío pide **Tipo de documento** (Nota de remisión, Remito,
   Vale de salida, Factura, Otro) y **Número** (obligatorios). Transporte / chapa / chofer
   queda como dato libre. Se ve en la tabla de movimientos y en el historial.
3. **Enviar lo que hay.**
   - «Hay stock» ya no exige tener todo lo pedido: alcanza con más de cero (si hay menos,
     avisa «se envía lo que hay» y lo deja anotado en el historial).
   - Se puede enviar menos de lo disponible (lo propone igual).
   - **Cerrar con lo entregado** (con motivo): para cuando no se va a mandar más — había
     1 de 2 y se mandó por urgencia, o pidieron de más. Lo hace bodega (o compras si fue
     compra), sin nada en tránsito y con algo ya recibido en obra. El pedido queda
     **Cerrado** «1 de 2 un · motivo». Se puede **deshacer** (vuelve a Entrega).

## Desplegar
1. Correr `esquema/111_compras_taller_envio_directo.sql` en el SQL Editor (después del 110).
   Termina con `SQL 111 ok · columnas_doc_2 = 2 · vista_cierre_1 = 1 · preparados_viejos`.
   Va en transacción; se puede correr dos veces.
2. La app (obra-shell-v97) ya está en main. Hasta correr el 111, enviar sin preparar,
   el stock parcial y el cierre avisan «Falta correr el SQL 111».

Si alguna vez se vuelve a correr el 79 o el 110, correr después otra vez el 111.

## Probado
Postgres 16 local (79 + 99 + 110 + 111 dos veces, con un pedido viejo «preparado»):
envío del viejo, stock parcial 1 de 2, preparado rechazado, envío sin documento rechazado,
envío por encima de lo pedido rechazado, cierre con tránsito / por la obra / sin motivo
rechazado, cierre OK y bloquea movimientos, deshacer, compra por central (envío ≤ recibido
en central, compras cierra), anular un preparado viejo. Pantalla: `taller_ui.test.cjs` y
`ucc_ui.test.cjs` OK.

## Abierto
- Si además del cierre conviene un botón «comprar el faltante» (crear un pedido nuevo a
  compras por lo que no se mandó). Hoy, si hace falta, se carga un pedido nuevo.
