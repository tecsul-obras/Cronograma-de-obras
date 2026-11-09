# 100 · Todas las fotos a Drive + fotos en grande en toda la app (09/11/2026)

App v20261109a (obra-shell-v89) · equipos-v98.

## Qué cambia

**En la app (se ve apenas se publica):**
- Tocar cualquier foto la abre **en grande** (visor con flechas, Esc, ⤢ abrir aparte). Antes, en los historiales de combustible y taller, tocar una foto de JotForm la **descargaba**.
- Vale para: Historial y detalle de **combustible** y **taller**, **OT**, **Historial de partes**, **Mis cargas**, **Saltos de horómetro**, **Plantas**, **Transporte** y **Producción**.
- Las fotos que ya estén en Drive se muestran dentro de la app (antes: «Abrir en Drive»).

**Fotos a Drive (cuando se instale lo de abajo):**
- Las **≈139.000 fotos de JotForm** pasan a la unidad compartida **«Fotos Tecsul»**. Incluye partes (82.400), combustible (44.400), taller (9.500) y transporte (2.700).
- Las fotos se achican a **1600 px**, como las que saca la app. Las firmas quedan como están.
- La carpeta de cada foto es *Módulo / Año / Año-Mes*, por ejemplo `Partes/2026/2026-10`.
- El nombre es `fecha_equipo_campo_código.jpg`.
- Las fotos que se cargan **desde la app** también pasan a Drive cuando el registro tiene **más de 30 días**. Después se borran de Supabase, para liberar espacio. Los días se cambian en `fotos_drive_config.dias_app`.
- La unidad es **privada**. La app pide las fotos a la función **«foto»**: solo usuarios con sesión y solo fotos de esa unidad.
- En la base, el link pasa a `https://drive.google.com/file/d/<id>/view`.
- Cambiar el link **no** cuenta como edición del parte: no deja log y no cambia «editado».
- El archivador viejo de fotos de partes queda apagado. Las 7 fotos que ya había pasado a un Drive privado se copian a la unidad.

## Orden (todo lo hacés vos, ≈30 min)

### 1. Unidad compartida
1. Entrá a Drive y andá a **Unidades compartidas › Nueva**, con el nombre **Fotos Tecsul**.
2. Copiá el **ID**: lo que sigue a `/drive/folders/` en la dirección.

### 2. Cuenta de servicio de Google (la que lee las fotos para la app)
1. Entrá a **console.cloud.google.com** con tu cuenta de Tecsul y creá un proyecto nuevo, «Tecsul fotos».
2. Andá a **APIs y servicios › Biblioteca** y habilitá **Google Drive API**.
3. Andá a **IAM › Cuentas de servicio** y creá una con el nombre `fotos-app`. No le des ningún rol.
4. Abrí la cuenta y andá a **Claves › Agregar clave › JSON**. Se baja un archivo `.json`.
5. En la unidad **Fotos Tecsul**, entrá a **Administrar miembros**. Agregá el correo de la cuenta de servicio (`fotos-app@…iam.gserviceaccount.com`) como **Lector**.

> Si al crear la clave aparece «la creación de claves está deshabilitada por una política de la organización», hay que desactivar la política `iam.disableServiceAccountKeyCreation` en la consola de Google Cloud.

### 3. Supabase
1. En el **SQL Editor**, corré `100_fotos_drive.sql`. Tarda 1–2 minutos, porque arma la cola. Al final muestra el avance: ≈139.000 pendientes.
2. Andá a **Edge Functions › Secrets** y cargá dos secretos:
   - `GOOGLE_SA_JSON`: el contenido entero del `.json` del paso 2.
   - `FOTOS_DRIVE_ID`: el ID del paso 1.
3. Andá a **Edge Functions › Deploy a new function › Via Editor**. Ponele el nombre **`foto`**, pegá `supabase/functions/foto/index.ts` y dejá **Verify JWT** activado.

### 4. Apps Script «Fotos a Drive» (copia y achica)
1. Entrá a **script.google.com › Nuevo proyecto**, con tu cuenta. Tenés que ser **Administrador de contenido** o más en la unidad.
2. Pegá `esquema/herramientas/fotos_drive/FotosDrive.gs`.
3. En ⚙ Configuración, tildá «Mostrar appsscript.json» y pegá `appsscript.json`.
4. En ⚙ **Propiedades del script**, cargá:
   - `SUPABASE_URL` = `https://sququxlqcrbsoqvmycfa.supabase.co`
   - `SUPABASE_SERVICE_KEY`: la sale de Project Settings › API › `service_role`.
   - `DRIVE_ID`: el ID del paso 1.
   - `JOTFORM_API_KEY`: solo si en la prueba aparece «JotForm pide login». La sacás de JotForm › Settings › API.
5. Ejecutá **`probar`** y autorizá los permisos. Copia 5 fotos; en el registro tiene que decir `listas`.
6. Ejecutá **`instalar`**. Queda corriendo cada 5 minutos hasta terminar.
7. Para ver cuánto falta, usá **`avance`**, o en el SQL Editor: `select * from fotos_drive_avance;`

### 5. Publicar la app
Mergeá la rama `fotos-drive-visor-100` a `main` **antes de `instalar` (paso 4.6)**. La app vieja no sabe mostrar las fotos que ya pasaron a Drive. La nueva muestra igual lo que todavía está en JotForm o en Supabase, así que se puede publicar ya.

## Cuánto tarda y cuánto ocupa
- **Tiempo:** el límite de Google es de ≈100.000 llamadas por día a internet desde Apps Script, y cada foto usa 3 a 7 llamadas. Son unos **9 a 12 días**.
- **Espacio:** las fotos de JotForm vienen del celular, de 2 a 4 MB cada una; achicadas quedan en ≈200–300 KB. En total serán **≈30–40 GB** en la unidad compartida, que usan el espacio de Tecsul en Google Workspace. Conviene mirar que alcance antes de instalar.
- **No des de baja JotForm hasta que `avance` diga 100 %.** Si una foto falla 5 veces, queda en `con_error`. Las que JotForm ya no tiene (404) quedan como `descartadas`; para verlas: `select origen, error from fotos_drive where estado in ('error', 'descartada');`

## Volver atrás
- Para que no se copie nada más, ejecutá **`detener`** en el Apps Script.
- Para que las fotos de la app no pasen a Drive ni se borren de Supabase: `update fotos_drive_config set dias_app = 100000, borrar_storage = false;`
- Las que ya pasaron siguen en Drive. En `fotos_drive` está el link original de cada una (`origen`) por si hubiera que volver.
