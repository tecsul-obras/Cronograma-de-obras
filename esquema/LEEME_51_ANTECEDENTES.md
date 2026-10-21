# Licitaciones › Antecedentes de obra (SQL 51 · v20261020a)

Vista nueva dentro de la pestaña **Licitaciones** (radar/), al lado de
«Participaciones / KPI». Reúne los contratos, actas de recepción, convenios
modificatorios, formularios y documentos del personal que se presentan como
experiencia en las ofertas. No depende de ninguna obra activa.

## Cómo funciona

- **Índice en Supabase**: tabla `radar_antecedentes`. Cada fila es un documento
  (obra, contratante, N° de contrato, tipo, fecha, páginas) con el ID del PDF en
  Google Drive y el texto OCR del escaneo para la búsqueda.
- **PDF en Google Drive**: se abren con el visor de la app (`visor.js`) o con el
  botón «Drive ↗». Quien no tenga permiso sobre el archivo en Drive no lo ve,
  aunque vea la fila en la lista.
- **Permisos**: los del Radar. Ver = `radar_access(false)`; agregar, editar o
  borrar = `radar_access(true)`. Las escrituras pasan solo por
  `radar_antecedente_guardar` y `radar_antecedente_borrar`.
- **Búsqueda**: por obra, contratante, N° de contrato, tipo y detalle. Con 3 o
  más letras busca también dentro del texto OCR (sin importar tildes) y muestra
  el fragmento encontrado.

## Puesta en marcha

1. Supabase › SQL editor: correr `esquema/51_radar_antecedentes.sql`.
2. Supabase › SQL editor: correr `51b_antecedentes_carga_inicial_NO_SUBIR.sql`
   (se entrega aparte). Carga los 45 documentos del piloto. **No subirlo a
   GitHub**: el repositorio es público y el OCR tiene datos personales.
3. Publicar los cambios del repo (radar/antecedentes.js, radar/antecedentes.css,
   radar/index.html, radar/app.js, index.html, sw.js). El service worker pasa a
   `obra-shell-v65`, así que los teléfonos toman la versión nueva solos.
4. Compartir la carpeta `REPOSITORIO_OBRAS` de Drive con quienes usan
   Licitaciones (o con el grupo de Tecsul), con permiso de lectura.

## Agregar documentos

Desde la app (usuarios con edición del Radar): **＋ Agregar documento**, elegir
o escribir el código de obra (OB12, OB13…), completar los datos y pegar el
enlace del PDF en Drive. Los documentos cargados así se buscan por sus datos;
el texto OCR se agrega cuando se procesa un lote de escaneos.
