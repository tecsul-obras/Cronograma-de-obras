# Compras de taller (SQL 79 y 80) · v20261103a

Sección **Taller** del módulo Compras (`compras/index.html` › 🔧 Taller, o `compras/index.html?s=taller`).
Sirve para los pedidos de repuestos y servicios que las obras le hacen al taller central.
Cada pedido lleva un solo número, `TAL-000001`, desde la solicitud hasta la entrega.

## Flujo

| Etapa | Quién | Qué pasa |
|---|---|---|
| Solicitud | Obra: taller, o admin de obra (solo sus obras) | Se cargan el repuesto, el código y la marca/modelo, la cantidad, la unidad, la obra, el equipo, la OT, la fecha requerida y fotos. |
| Bodega central | Bodega (permiso) | Decide entre **hay stock**, **derivar a compras**, **pedir aclaración** o **rechazar**, y anota el motivo. |
| Desde stock | Bodega → obra | Prepara → envía → la obra confirma. No lleva cotizaciones ni compra. |
| Cotización | Compras | Carga las ofertas: proveedor, precio unitario, moneda, flete, IVA y plazo. Total = precio × cantidad + flete. |
| Autorización | Compras pide · autorizador resuelve | Son dos pasos separados, cada uno con usuario, hora y motivo. **Quien pide no puede resolver.** Devolver exige motivo. |
| Compra | Compras | Se registra la OC, factura o comprobante con número y fecha. **«¿Se pagó con caja chica?» sí/no** se responde acá. Se elige la ruta: central, directa o mixta. |
| Entrega | Bodega / obra | Recepción en central → preparado → envío → recepción en obra. La entrega directa del proveedor la confirma la obra. Se admiten entregas parciales. |

**Cuándo cierra un pedido:** recién cuando todo está recibido en obra (R + D + S ≥ Q). Haberlo enviado no lo cierra.

**Regla de saldos (la controla la base):** C + D ≤ Q, P ≤ C (o Q si sale de stock), E ≤ P, R ≤ E. Un movimiento no se puede anular si rompe esta regla; por ejemplo, no se anula lo preparado si ya se envió.

**Cotización cambiada:** si se modifica o anula la oferta que se pidió autorizar, esa autorización queda sin efecto. Agregar otra oferta no la invalida.

## Seguridad

- Todas las escrituras pasan por funciones de la base (`tc_pedido_crear`, `tc_accion`, `tc_adjunto_registrar`…). Las tablas no tienen permiso de escritura directa.
- La identidad es la de la sesión, nunca un nombre escrito en el formulario.
- **Versión:** si otra persona cambió el pedido mientras lo tenías abierto, la base responde 40001 y la ficha se recarga sola.
- **Clave de operación (`p_op`):** reintentar la misma operación no la repite.
- **Fotos y PDF:** van al bucket privado `taller_compras/<pedido>/…` (hasta 10 MB; JPG, PNG, WebP o PDF) y se ven con enlaces firmados que vencen en 1 h. Las fotos se achican en el navegador a 1280 px. Tamaño y tipo los toma la base del archivo subido. Quitar un archivo de la ficha no lo borra: queda en el historial.

## Permisos

| Permiso | Por defecto | Se da a mano |
|---|---|---|
| Todo | Admin de Obras, admin central de Equipos | — |
| Pedir y confirmar recepción | Taller (todas las obras); admin de obra de Equipos (sus obras) | Sí, con o sin obras |
| Bodega central | — | **Sí** |
| Compras | Rol compras de Obras | Sí |
| Autorizar | — | **Sí** |
| Ver | Gerente (Obras o Equipos) y los anteriores | Sí |

Los permisos se asignan en **Compras › Taller › 🔑 Permisos**, que solo ve un administrador.

## Desplegar

1. Correr `esquema/79_compras_taller.sql` en el SQL Editor. Se puede correr más de una vez y termina con «SQL 79 ok».
2. *(Opcional, antes del paso 1)* Correr `esquema/pruebas/79_prueba_completa.sql`. Ejecuta begin, la migración, la prueba y rollback; termina con «PRUEBA OK (se deshace todo)» y no deja nada guardado. **Probado el 03/11/2026: los 19 pasos OK.**
3. Publicar la app. Cachés nuevas: `obra-shell-v82` y `equipos-v85`.
4. En Permisos, asignar **Bodega central** y **Autorizar** a las personas que correspondan.
5. *(Después, aparte)* Correr `esquema/80_compras_taller_historico.sql`, que prepara el staging del histórico de Monday.
6. Cargar los Excel de Monday con `python esquema/herramientas/cargar_historico_taller.py "<carpeta con los .xlsx>"`. Sin opciones solo simula y cuenta (tienen que dar 16.938 filas). Con `--subir` pide el usuario y la contraseña del administrador y carga en lotes de 500. Se puede correr más de una vez sin duplicar. Necesita `pip install openpyxl`.

Prueba de la pantalla con la base simulada: `node compras/pruebas/taller_ui.test.cjs` (usa Chromium y Playwright; deja capturas en `compras/pruebas/capturas/`).

## Histórico de Monday (SQL 80)

Las 16.938 filas **no se importan como pedidos**. Van a `tc_hist_fuente` como evidencia:
- Cada fila se identifica por (sha del archivo, hoja, fila). Cargar dos veces no duplica, y si una fila cambió queda marcada «conflicto» en vez de pisarse.
- `tc_hist_vinculo` guarda las decisiones de vinculación sin sumar cantidades.
- Caja chica y UCC quedan como texto de procedencia: no crean bandejas.
- Solo el administrador puede cargar.
- Los datos de Monday **no** van al repositorio, porque es la carpeta pública de la app.

Falta definir con taller y compras cómo se promueve una fila a pedido real y si conviene una pantalla de conciliación.

## Cambios que afectan a lo existente

- `compras/` ahora deja entrar también a quien solo tiene usuario de Equipos y acceso a Taller. Si una persona tiene acceso a las dos secciones, arriba elige **Obras / Taller**. Compras de obras no cambió.
- En el menú «Otras apps» de Equipos aparece **Compras de taller** para los roles taller, admin central, admin de obra y gerente.

## Pendiente de decidir (no se inventaron reglas)

- Quiénes autorizan y con qué **límites de monto**. Hoy cualquiera con el permiso «autorizar» autoriza cualquier monto.
- **Stock parcial + compra del faltante.** Hoy, desde stock solo se atiende el pedido entero.
- **Inventario real y reservas.** No hay inventario compartido: «stock» es lo que bodega declara para ESE pedido. Propuesta para cuando exista: una tabla de existencias por repuesto y ubicación; al elegir «hay stock» se crea una reserva en la misma transacción y la salida (envío) la descuenta.
- Equivalencias de repuestos, devoluciones o sobrantes, y notificaciones (por ejemplo, avisar a bodega cuando entra un pedido).
- Cotizaciones mínimas, y agrupar varios pedidos en una OC. Hoy es una compra por pedido.
- Límites de fotos. La demo ponía 3; acá no hay tope por pedido, solo el tamaño por archivo.
