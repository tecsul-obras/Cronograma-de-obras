# 112 · Fotos a Drive, «Foto vencida» y fotos en grande en toda la app (09/11/2026)

App v20261112e (obra-shell-v98) · equipos-v110.

## Qué cambia

**En la app (se ve apenas se publica):**
- Tocar cualquier foto la abre **en grande** (visor con flechas, Esc, ⤢ abrir aparte). Antes, en los historiales de combustible y taller, tocar una foto de JotForm la **descargaba**.
- Vale para: Historial y detalle de **combustible** y **taller**, **OT**, **Historial de partes**, **Mis cargas**, **Saltos de horómetro**, **Plantas**, **Transporte** y **Producción**.
- Las fotos que ya están en Drive se muestran dentro de la app (antes: «Abrir en Drive»).
- Si una foto o firma se borró, en su lugar aparece un recuadro gris **«Foto vencida»**. No se puede ampliar.

**Fotos a Drive y retención (cuando se instale lo de abajo):**
- **Se guarda un año.** Toda foto o firma de un registro con **más de 365 días** se borra, tanto de Drive como de Supabase. En la base queda el texto `vencida`. Esto corre solo, todas las noches.
- **JotForm:** se copian solo las fotos de registros de los **últimos 100 días**, unas **18.700**. Las más viejas JotForm ya las borró, porque elimina los archivos a los 3 meses. Esas ≈120.000 pasan directo a «vencida», sin intentar copiarlas.
- **Destino:** van a la unidad compartida **«Fotos Tecsul»**, achicadas a **1600 px**, como las que saca la app. Las firmas quedan como están.
  - La carpeta es *Módulo / Año / Año-Mes*, por ejemplo `Partes/2026/2026-10`.
  - El nombre es `fecha_equipo_campo_código.jpg`.
- **Fotos de la app (Supabase):** pasan a Drive cuando el registro tiene **más de 30 días**. Después se borran de Supabase, para liberar espacio.
- **Acceso:** la unidad es **privada**. La app pide las fotos a la función **«foto»**, que solo atiende a usuarios con sesión y solo fotos de esa unidad.
- **En la base:** el link pasa a `https://drive.google.com/file/d/<id>/view`.
- **No es una edición:** cambiar el link o poner «vencida» no deja log, no cambia «editado» y no recalcula la flota.
- **Archivador viejo:** el archivador viejo de fotos de partes queda apagado. Las 7 fotos que ya había pasado a un Drive privado se copian a la unidad.

## Orden (todo lo hacés vos, ≈30 min)

### 1. Unidad compartida
1. Entrá a Drive › **Unidades compartidas › Nueva** y ponele de nombre **Fotos Tecsul**.
2. Copiá el **ID**: es lo que sigue a `/drive/folders/` en la dirección.

### 2. Cuenta de servicio de Google (la que lee las fotos para la app)
1. Entrá a **console.cloud.google.com** con tu cuenta de Tecsul y creá un proyecto nuevo, «Tecsul fotos».
2. Andá a **APIs y servicios › Biblioteca** y habilitá **Google Drive API**.
3. Andá a **IAM › Cuentas de servicio** y creá una cuenta `fotos-app`, sin ningún rol.
4. En esa cuenta, andá a **Claves › Agregar clave › JSON**. Se baja un archivo `.json`.
5. En la unidad **Fotos Tecsul**, abrí **Administrar miembros** y agregá el correo de la cuenta (`fotos-app@…iam.gserviceaccount.com`) como **Lector**.

> Si al crear la clave aparece «la creación de claves está deshabilitada por una política de la organización», desactivá la política `iam.disableServiceAccountKeyCreation` en la consola de Google Cloud.

### 3. Supabase
1. En el **SQL Editor**, corré `112_fotos_drive.sql` (antes se llamaba 102; si ya lo corriste, no hace falta repetirlo). Tarda 1–2 minutos porque arma la cola. Al final muestra el avance: ≈18.700 `pendiente` y ≈120.000 `vencer`.
2. Con eso ya empieza la tarea de cada minuto (pg_cron `fotos_drive_vencer`). Pone «vencida» en las fotos viejas de JotForm, de a 5000 por minuto, y termina en ≈25 minutos.
3. Andá a **Edge Functions › Secrets** y cargá dos secretos:
   - `GOOGLE_SA_JSON`: el contenido entero del `.json` del paso 2.
   - `FOTOS_DRIVE_ID`: el ID del paso 1.
4. Andá a **Edge Functions › Deploy a new function › Via Editor**, con el nombre **`foto`**. Pegá `supabase/functions/foto/index.ts` y dejá **Verify JWT** activado.

### 4. Publicar la app
Mergeá la rama `fotos-drive-visor-112` a `main` **antes del paso 5**. La app vieja no sabe mostrar las fotos que pasan a Drive ni el «vencida». La nueva sigue mostrando lo que todavía está en JotForm o en Supabase, así que se puede publicar ya.

### 5. Apps Script «Fotos a Drive» (copia, achica y borra lo vencido)
1. Entrá a **script.google.com › Nuevo proyecto** con tu cuenta. Tenés que ser **Administrador de contenido** o más en la unidad.
2. Pegá `esquema/herramientas/fotos_drive/FotosDrive.gs`.
3. En ⚙ Configuración, tildá «Mostrar appsscript.json» y pegá `appsscript.json`.
   - Ese archivo agrega el servicio avanzado **Drive API**, que enciende la API de Drive en el proyecto interno del script. Sin eso, `probar` da «Google Drive API has not been used in project … or it is disabled». Si no aparece en **Servicios**, agregalo a mano: **Servicios › + › Drive API**.
4. En ⚙ **Propiedades del script**, cargá:
   - `SUPABASE_URL` = `https://sququxlqcrbsoqvmycfa.supabase.co`
   - `SUPABASE_SERVICE_KEY`: está en Project Settings › API › `service_role`.
   - `DRIVE_ID`: el ID del paso 1.
   - `JOTFORM_API_KEY`: solo si en la prueba aparece «JotForm pide login». Está en JotForm › Settings › API.
5. Ejecutá **`probar`** y autorizá los permisos. Copia 5 fotos y en el registro tiene que decir `listas`.
6. Ejecutá **`instalar`**. Queda corriendo cada 5 minutos, siempre: copia las nuevas y borra las que cumplen el año.
7. Para ver cómo va, ejecutá **`avance`**, o en el SQL Editor: `select * from fotos_drive_avance;`

## Cuánto tarda y cuánto ocupa
- **Tiempo:** la primera tanda de ≈18.700 fotos tarda **1 a 2 días**, porque Google permite ≈100.000 llamadas por día y cada foto usa de 3 a 7.
- **Espacio:** cada foto achicada queda en ≈200–300 KB, así que la primera tanda son **≈4–5 GB**. Con la retención de un año la unidad no pasa de un año de fotos.
- **De quién es el espacio:** las unidades compartidas usan el espacio de **toda Tecsul** en Google Workspace, no el tuyo ni el de los miembros.
- **Errores:** si una foto falla 5 veces queda en `con_error`. Si en el origen ya no existe (404), queda «vencida». Para verlas: `select origen, error, estado from fotos_drive where estado in ('error', 'vencida') and error like 'No está%';`

## Ajustes (`fotos_drive_config`)
| Columna | Valor | Qué hace |
|---|---|---|
| `dias_retencion` | 365 | Las fotos y firmas de registros más viejos se borran y quedan «vencida» |
| `dias_jotform` | 100 | Las fotos de JotForm más viejas que esto no se intentan copiar (JotForm ya no las tiene) |
| `dias_app` | 30 | Las fotos de la app pasan a Drive a partir de estos días |
| `borrar_storage` | true | Borrar de Supabase después de copiar |

Ejemplo: `update fotos_drive_config set dias_retencion = 730;` guarda dos años. Vale para lo que todavía no se borró.

## Volver atrás
- Para que no se copie ni se borre nada más: ejecutá **`detener`** en el Apps Script y en el SQL Editor corré `select cron.unschedule('fotos_drive_vencer'); select cron.unschedule('fotos_drive_encolar');`.
- Para que las fotos de la app no pasen a Drive ni se borren de Supabase: `update fotos_drive_config set dias_app = 100000, borrar_storage = false;`.
- **El link original no se pierde.** En `fotos_drive.origen` queda el link original de cada foto, también de las «vencida». Si alguna de JotForm resultara seguir viva, se puede volver a poner.
- Lo que se borra de Drive va a la **papelera de la unidad compartida** y se puede restaurar durante 30 días. Lo que se borra de Supabase **no se recupera**.
