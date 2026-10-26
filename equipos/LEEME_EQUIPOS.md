# Parte Diario de Maquinaria — Tecsul S.A.E.

Sistema de carga de partes diarios de equipos. Reemplaza el formulario
de JotForm + Google Sheets por una PWA propia sobre Supabase.

**Última actualización de esta carpeta: 01/10/2026**

---

## Cómo está armado

```
Operador (celular)  →  PWA  →  Supabase (Postgres + Storage)
                                    │
                                    ├─→ Apps Script (cada hora) → Google Sheet espejo → Power BI
                                    └─→ Apps Script (semanal)   → Google Drive (fotos de +3 meses)
```

**Supabase es la fuente de verdad.** Ahí carga la PWA, ahí están las
reglas y los permisos, ahí está el panel de control.

**Por qué hay un espejo en Google Sheets y no una conexión directa:**
la red de Tecsul bloquea los puertos de base de datos (5432 y 6543), y
el servicio web de Power BI además no valida el certificado del pooler
de Supabase. El espejo va por HTTPS (puerto 443), que sí pasa. Si algún
día sistemas abre el puerto, la conexión directa vuelve a ser mejor y el
espejo se retira sin tocar nada más que esa consulta de Power Query.

---

## Los archivos SQL, en orden

Se corren en el **SQL Editor de Supabase**, uno por vez, en este orden.
Si alguno da error, no sigas con el siguiente.

| # | Archivo | Qué hace |
|---|---|---|
| 00 | `00_verificar_o_reset.sql` | Diagnóstico, y el reset total (comentado) |
| 01 | `01_esquema.sql` | Tablas, columnas calculadas, funciones, auditoría |
| 02 | `02_rls.sql` | Permisos por rol (RLS) y bucket privado de imágenes |
| 03 | `03_vista_powerbi.sql` | Vistas con los nombres de columna de JotForm |
| 04 | `04_formulario.sql` | El constructor: secciones, campos y reglas |
| 05 | `05_mejoras.sql` | Familia de equipo, viajes de camiones, m³ de hormigón |
| 06 | `06_cambio_clave.sql` | Cambio de contraseña obligatorio en el primer ingreso |
| 07 | `07_regla_remision.sql` | Exigir remisión cuando se carga combustible |
| 08 | `08_horometro.sql` | **Arregla el último horómetro** (ver abajo) |
| 09 | `09_panel_control.sql` | Panel: faltantes, cumplimiento, anomalías |
| 10 | `10_vista_powerbi_anexo.sql` | Vista que alimenta el espejo de Power BI |
| 11 | `11_archivo_fotos.sql` | Archivado de fotos a Drive |
| 11b | `11b_archivo_fotos_correccion.sql` | Filtro más estricto + diagnóstico de datos |
| 12 | `12_componente_falla_catalogo.sql` | Componente de falla desde el catálogo |
| 13 | `13_rol_taller.sql` | Rol nuevo `taller`. **Solo, en su propia pestaña** |
| 14 | `14_flota.sql` | Flota: ficha técnica, estado, historial, documentos, mantenimiento, seguros, alquileres, personal |
| 15 | `15_ordenes_trabajo.sql` | Órdenes de trabajo de taller (ex JotForm "Reportes - Taller") |
| 16 | `16_combustible.sql` | Control de combustible (ex JotForm "Control Combustible") |
| 17 | `17_app_flota.sql` | Funciones que usa la pantalla de flota |
| 18 | `18_terceros_y_turnos.sql` | Equipos de terceros, horas hombre sin duplicar, edición de partes |
| 19 | `19_formularios_campo.sql` | Formularios de taller y combustible en la app, numeración de OT desde 20001 |
| 20 | `20_mantenimiento_avisos_personal.sql` | Service por ciclo 250/500/750/1.000, avisos por correo, personal, documentos a Drive |
| 21 | `21_reportes_bi.sql` | Reportes de Power BI embebidos (solapa Reportes, se cargan en Administración) |
| 22 | `22_asistente_ia.sql` | Asistente IA (Gemini) para admin central: consultas de solo lectura y registro de preguntas |
| 23 | `23_certificado_maquinas.sql` | Maestro de tarifas (importable desde Unysoft) y certificado de máquinas por obra |
| 24 | `24_tipo_registro_falla.sql` | Estado del equipo como en JotForm: tipo de registro con casillas (Falla / Traslado), campos según lo marcado y foto obligatoria si hay falla |

Si alguna vez se vuelve a correr `14_flota.sql`, correr `15` después:
el 15 reemplaza la función del parte que cambia el estado del equipo.

`05_constraints.sql` quedó de una versión anterior: **no se usa**, su
contenido está dentro de `01_esquema.sql`.

---

## Flota (lo que estaba en Monday)

`14_flota.sql` suma a la misma base los tableros de taller de Monday.
No hay un maestro paralelo: se amplía la tabla `equipos` que ya usa el
parte diario, así el CV-05 del parte y el del taller son la misma fila.

| Monday | Supabase |
|---|---|
| Maestro de Equipos | `equipos` (columnas nuevas de ficha técnica) |
| Estado de Equipos | `equipo_estado` + `equipo_estado_historial` |
| Inventario Contenedores, Tanques, Básculas | `equipos` con `categoria` contenedor / tanque / bascula |
| Tanques de Combustible | `equipos` (categoría tanque, datos extra en `atributos`) |
| Operadores y Mecánicos | `operadores` (+ especialidad, teléfono, ubicación) |
| Mantenimiento preventivo | `planes_mantenimiento` (por días, horas o km) + `mantenimientos` |
| Seguro de Vehículos y camiones | `seguros` |
| Equipos Alquilados a Terceros | `alquiler_contratos`, `alquiler_equipos`, `alquiler_facturacion` |
| Archivos (Dinatran, cédula verde…) | `documentos` + bucket `documentos` → Drive |

**Reglas que corren solas:**
- Un parte con falla que *impidió* trabajar pasa el equipo a Inoperativo
  (y disponibilidad En Reparación); si no impidió, a Fallando. Solo
  empeora el estado, nunca lo mejora: volver a Operativo es de taller.
  Solo partes de los últimos 3 días.
- Todo cambio de estado queda en `equipo_estado_historial` con quién,
  cuándo y si vino de la app, de un parte o del sistema.
- Registrar un mantenimiento de un plan reinicia el plan.
- La liquidación de alquileres (`v_alquiler_liquidacion`) no se guarda:
  se calcula con el horómetro de los partes, horas mínimas prorrateadas
  por los días del mes.
- `v_alertas_flota` junta vencimientos de Dinatran, habilitación
  municipal, seguros, mantenimientos y equipos con la salida de taller
  atrasada.

**Permisos:** el operador no ve nada nuevo (y en su desplegable solo
aparecen equipos con `en_parte_diario`). `admin_obra` ve toda la flota y
cambia la disponibilidad de cualquier equipo. `taller` edita todo lo de
flota y lee todos los partes. Seguros y alquileres: solo taller y
admin_central.

### Migración desde Monday

Carpeta `migracion_monday/`. Necesita `pip install requests`.

```
py migrar_monday.py descargar   ← baja Monday a monday_dump.json
py migrar_monday.py preparar    ← arma los mapeos para revisar
py migrar_monday.py cargar      ← carga (reejecutable)
py migrar_monday.py archivos    ← PDFs e imágenes a Storage
```

La primera vez crea `config_migracion.json` para completar con el token
de Monday y la URL y clave secreta de Supabase. **Ese archivo tiene la
clave secreta: no se sube a GitHub ni se comparte.**

`preparar` genera tres CSV que hay que revisar antes de cargar (mirar la
columna `nota`): `mapeo_equipos.csv` (códigos que no coinciden, ej.
AM-02 vs AM-2), `mapeo_asignaciones.csv` (qué obra es "San Juan") y
`mapeo_responsables.csv` (qué usuario es cada responsable). Si ya
existen no los pisa.

---

## Órdenes de trabajo (lo que era "Reportes - Taller")

Se mantiene la estructura del formulario: cada envío es un **registro**
con su "Condición de Carga" (Diagnóstico Inicial, Registro de Trabajos,
Reporte de Fallas, Cierre de OT), y varios registros cuelgan de una
**OT** con número. La numeración sigue la de JotForm.

| Tabla | |
|---|---|
| `ordenes_trabajo` | La OT: máquina, fallas, líder, tipo (Taller / Pista), ingreso, estado |
| `ot_registros` | Cada envío: técnico, fecha, lectura, estado de la máquina, boletas, cierre |
| `ot_registro_items` | Las matrices "Reporte Diario - SISTEMA" (horas y estado por componente) |
| `ot_checklist` | Los checklists respondidos |
| `ot_catalogo_trabajos`, `ot_checklist_plantillas` | Las filas de las matrices, editables |

**Reglas:** abrir una OT pone el equipo Inoperativo/Fallando y En
Reparación; "Trabajo Finalizado = SI" la cierra, y con "Reparado" el
equipo vuelve a Operativo y A Disposición (si no tiene otra OT
abierta). El cierre queda en `mantenimientos` y, si fue preventivo,
reinicia el plan. Un parte con falla crea una OT **Solicitada** si el
equipo no tiene ninguna abierta.

Vistas: `v_ot` (bandeja de taller) y `v_ot_horas` (horas por técnico).

## Combustible (lo que era "Control Combustible")

Una fila por envío en `combustible_movimientos`, con los mismos campos
del formulario. Actividades: Despacho, Ingreso de combustible, Medición
de tanque, Prueba de desviación. Los tanques son equipos (categoría
tanque).

| Vista | |
|---|---|
| `v_stock_tanques` | Stock estimado: última medición + ingresos − despachos |
| `v_combustible_conciliacion` | Despacho contra lo declarado en el parte, por equipo y día |
| `v_combustible_consumo` | Litros/hora por equipo y mes contra la ficha técnica |
| `v_combustible_anomalias` | Contador que no cierra, horómetro que retrocede, boleta repetida |

### Migración desde JotForm

En la misma carpeta `migracion_monday/`, con el mismo
`config_migracion.json` más la clave `jotform_api_key` (JotForm →
Configuración → API, de la cuenta dueña de los formularios):

```
py migrar_jotform.py descargar
py migrar_jotform.py preparar    ← revisar mapeo_obras_jotform.csv y mapeo_tanques_jotform.csv
py migrar_jotform.py cargar
```

El histórico no cambia el estado actual de los equipos (eso vino de
Monday). Muchas OT de JotForm nunca se marcaron como finalizadas y
quedan abiertas; para cerrarlas todas las que no tuvieron movimiento en
el mes, en el SQL Editor:

```sql
update ordenes_trabajo
   set estado = 'Cerrada',
       detalle_cierre = 'Cerrada en la migración: en JotForm no se marcó Trabajo Finalizado'
 where origen = 'jotform' and estado = 'Abierta'
   and id not in (select ot_id from ot_registros
                  where fecha >= date_trunc('month', current_date));
```

---

## La PWA

Carpeta `pwa-v5/`. Se sube a GitHub Pages.

| Archivo | |
|---|---|
| `parte_diario_v5.html` | La app: parte diario, historial y administración |
| `menu.js` | Las solapas de arriba, iguales en las dos páginas (para el usuario es una sola app), y el botón ⊞ para ir a la app de Cronograma y gestión de obras |
| `formularios.js` | Los formularios de taller y combustible (solapas dentro de la misma app) |
| `flota.html` | Flota, Órdenes de trabajo, Control de combustible y Alertas |
| `gestion.js` | Las bandejas de Órdenes de trabajo y Control de combustible |
| `gestion2.js` | Mantenimiento, Alquileres, Seguros, Personal y Reportes de Power BI |
| `certificado.js` | Resumen de horas y maestro de tarifas (solo admin central) |
| `minutas.js` | Minutas de reunión (compromisos, actualizaciones, impresión) — SQL 46 |
| `cert_maquinas.js` | Certificados de maquinarias numerados: formato oficial, Excel e impresión (SQL 45) |
| `ia.js` | Asistente IA: botón flotante abajo a la derecha (admin central), en las dos páginas. La IA corre en la Edge Function `supabase/functions/asistente` |
| `sw.js` | Service worker: hace que funcione sin señal |
| `index.html` | Redirección |
| `manifest.json` | Para instalarla como app en el celular |

**Cada vez que cambies el HTML hay que subirle la versión a `sw.js`**
(la constante `CACHE_VERSION`, arriba de todo). Si no, los celulares que
ya abrieron la app siguen usando la copia vieja y el cambio no aparece.
Versión actual: `parte-diario-v5-27`.

---

## Los scripts de Google

Van en un proyecto de Apps Script, en la hoja espejo.
La clave de Supabase NO va en el código: va en **Configuración del
proyecto → Propiedades del script**.

| Archivo | Propiedades que necesita | Cada cuánto |
|---|---|---|
| `espejo_supabase_a_sheets.gs` | `SUPABASE_KEY` | cada hora |
| `archivo_fotos_a_drive.gs` | `SUPABASE_KEY`, `DRIVE_CARPETA_ID` | domingos 3 AM |
| `archivo_documentos_a_drive.gs` | `SUPABASE_KEY`, `DRIVE_CARPETA_ID` (o `DRIVE_DOCUMENTOS_ID`) | todas las noches 2 AM |
| `avisos_correo.gs` | `SUPABASE_KEY` | cada 15 min (manda según lo configurado en Administración → Avisos por correo) |

`consulta_M_PWA_PARTE_DIARIO_EQUIPOS.txt` es la consulta de Power Query
que lee la hoja espejo. Se pega en el Editor avanzado de la consulta
`PWA_PARTE_DIARIO_EQUIPOS`, y esa consulta se anexa al `Table.Combine`
de `BD_PARTE_DIARIO_EQUIPOS`.

---

## Reporte de taller igual a JotForm (v20261016g)

`formularios.js` replica el formulario de JotForm "Reportes - Taller"
(251424355949666): las 4 condiciones de carga (Reporte de Fallas,
Diagnóstico Inicial - Generación OT, Registro de Trabajos - OT, Inspección
Final - Taller), con sus 46 condiciones de mostrar/ocultar y los mismos
obligatorios (firma, imágenes de la falla, foto del horómetro con MTTO,
fotos de salida, revisiones de neumáticos/frenos/parabrisas completas).
- OT de pista con varias máquinas: se abre una OT por máquina, con la
  lectura de cada una.
- Trabajo ejecutado suma MTTO. ACEITES (tipo y horas de mantenimiento +
  grillas 250-500-750 o 1.000-2.000 + filtros), SUPERVISIÓN (horas de
  supervisión tercerizada) y OTROS (filas libres).
- Estados de máquina = listas de JotForm; `47_taller_estados_jotform.sql`
  los traduce al estado de la flota (Funcional → Operativo, etc.).
- "Inspección Final - Taller" se sigue guardando como `Cierre de OT - Taller`.

## Formularios de campo: taller y combustible

Viven en la misma app que el parte. Cada persona ve las solapas que le
tocan según su **especialidad** en el catálogo de personal:

| Especialidad | Ve |
|---|---|
| OPERADOR, CHOFER, OTRO | Parte diario |
| MECANICO (A/B), ELECTRICISTA, GOMERO, AYUDANTE MECANICO, SUPERVISOR | Taller |
| DESPACHADOR | Combustible |
| Rol taller / admin_central | Los tres |
| Rol admin_obra | Parte y combustible |

Para casos especiales (un chofer que también despacha) se cambia la
columna **Formularios** en Administración → Usuarios.

**Taller**: las cuatro condiciones de JotForm (registro de trabajos,
diagnóstico inicial, reporte de falla, cierre de OT), con las mismas
matrices de horas por sistema y los mismos checklists. Todo el envío
entra junto en una sola llamada (`ot_registrar`): no quedan OT sin
registro si se corta la señal.

**Combustible**: despacho, ingreso, medición de tanque y prueba de
desviación. El cuenta litros inicial se precarga con el final del
despacho anterior del mismo tanque.

Los dos funcionan sin señal: se guardan en el teléfono y se envían solos.

**Bandejas de oficina** (taller, admin de obra y admin central):

- *Órdenes de trabajo*: pendientes de tomar, abiertas, atrasadas, con todo
  lo cargado en cada OT (trabajos, checklists, fotos). Taller la toma, la
  edita, la cierra o la anula. "Horas por técnico" suma las horas del mes.
- *Control de combustible*: movimientos, stock estimado de cada tanque,
  conciliación con lo declarado en el parte, consumo por equipo y anomalías.

El **Panel de control** del parte (máquinas sin parte, cumplimiento,
anomalías) está dentro de *Historial de partes*. *Administración* queda
para el admin central: catálogos de los tres formularios y de flota,
usuarios, formulario del parte y reglas.

**Numeración de OT**: las OT que se abren desde la app empiezan en la
**20001**, para no pisarse con las de JotForm mientras se sigan usando.

---

## Migración y usuarios

| Archivo | |
|---|---|
| `migrar_datos.py` | Carga el histórico de JotForm desde el Excel |
| `usuarios/crear_usuarios.py` | Da de alta usuarios (roles: operador, admin_obra, taller, admin_central) |
| `usuarios/usuarios.csv` | La lista, con la cédula como contraseña inicial |
| `usuarios/operadores_faltantes.sql` | 8 operadores con cuenta pero sin ficha en el catálogo |

`migrar.py` es una versión anterior de `migrar_datos.py`: **no se usa**.

El script de migración es reejecutable — usa `ON CONFLICT DO NOTHING`
sobre `client_id`, así que correrlo dos veces no duplica nada. El día del
corte se vuelve a correr con el Excel actualizado y solo entra lo nuevo.

---

## Cosas que conviene tener presentes

**Las ~60.000 fotos históricas viven en JotForm.** La base solo guarda el
enlace. El día que se dé de baja esa cuenta, se pierden todas. Es lo único
del proyecto con fecha de vencimiento real. El script de archivado ya
tiene la mitad del trabajo hecho; falta una función que haga lo mismo
partiendo de las URLs de JotForm.

**No hay respaldo automático.** El plan gratuito de Supabase no los
incluye. La hoja vieja de JotForm sí es un respaldo real del histórico,
pero los catálogos, los 175 usuarios y la definición del formulario no
tienen copia en ningún lado. El espejo NO sirve como respaldo: se
reescribe entero cada hora, así que replica los borrados.

**El proyecto se pausa solo** tras 7 días sin actividad. Con carga diaria
no pasa, pero después de un feriado largo puede aparecer caído un lunes.
Se despausa desde el panel en un minuto.

**1 GB de Storage** en el plan gratuito, ~160 MB por mes de fotos. El
archivado a Drive es lo que mantiene eso bajo control.

**El proyecto está en Oregón (us-west-2)**, no en São Paulo. Son ~150 ms
más de latencia desde Paraguay. No rompe nada, pero si algún día se
rehace desde cero, conviene `sa-east-1`.

**Partes con fecha futura:** quedaban 2 con fecha 2028 (equipo VC-08).
El panel los lista en Anomalías.

---

## El agujero del horómetro (por si vuelve a aparecer)

`ultimo_horometro` se creó sin `SECURITY DEFINER`, así que corría con los
permisos de quien la llamaba — y RLS dice que un operador solo ve SUS
partes. Resultado: cuando una máquina cambiaba de operador, la función
devolvía el último parte *de ese operador*, no el último real. La regla
"el horómetro no retrocede" funcionaba perfecto mientras la máquina
tuviera siempre el mismo chofer, y se volvía ciega justo cuando rotaba.

Lo arregla `08_horometro.sql`. La comprobación del final tiene que decir
`definer`. Si alguna vez alguien recrea esa función, que no se olvide.

---

## Asistente IA (Gemini)

Botón flotante ✨ abajo a la derecha (en partes y en flota), solo para admin central. La pregunta va a la
Edge Function `asistente` de Supabase, que habla con Gemini y corre las
consultas que Gemini propone con `ia_consulta()`: solo SELECT, en una
transacción de solo lectura, máximo 300 filas y 10 segundos, y con los
permisos del usuario que pregunta. Cada pregunta queda en `ia_registro`.

La clave de Gemini es un secreto de Supabase (`GEMINI_API_KEY`), nunca
está en la PWA. Opcional: `GEMINI_MODEL` para cambiar de modelo.

Ojo: en el plan **gratuito** de Gemini, Google puede usar lo que se le
manda (preguntas y resultados de las consultas) para mejorar sus
productos. Con facturación activada (plan pago) no.

---

## Alquileres (v20261016h, SQL 48)

Ya no es una solapa aparte: es **Certificado de máquinas → Alquileres**
(`alquileres.js`). Edita admin central; gerente solo ve.
- Listado tipo Flota: cliente y RUC, centro de costo, equipos con sus
  condiciones (precio/h, horas mínimas/mes), horas y monto del mes,
  facturación y facturas anexadas. Todo centro de costo **305AM…** es un
  alquiler: si no tiene contrato aparece igual ("Sin contrato") para crearlo.
- El contrato se vincula con la **obra que eligen en el parte diario**
  (`obra_clave`): la liquidación cuenta solo los partes de esa obra. Avisa
  los equipos con partes en la obra que no tienen condiciones.
- Clientes (`clientes`): nombre, RUC, contacto, teléfono, correo, dirección;
  se comparten entre contratos y los usa el certificado de máquinas.
- Facturas (`alquiler_facturas`, bucket privado `alquileres`): número,
  fecha, mes, monto y el PDF/foto. Anexar la del mes la marca FACTURADO.
- "Armar certificado" abre el certificado con la obra y el mes; las
  condiciones del contrato (precio y mínimo) se usan en las líneas nuevas.

## Minutas de reunión (v20261016d)

Solapa **Minutas**, al lado de Flota (`minutas.js`, SQL 46). Reemplaza el
tablero de Monday "Minuta COPAC Obras - Taller - Compras".

- Ven: taller, admin de obra (residentes), gerente y admin central. Cargan y
  editan: taller, admin de obra y admin central. Borrar un compromiso: admin
  central o quien lo creó. Crear otra minuta (otro comité): admin central.
- Compromisos con responsables, fecha de comité, estado (No iniciado,
  Programado, En curso, En espera de definición, Detenido, Listo), prioridad
  (Crítica, Alta, Media, Baja), fecha límite, equipo y notas. Pendientes =
  todo lo que no está Listo; ejecutados abajo, plegados.
- Estado y prioridad se cambian desde la tabla. Tocando el compromiso se abre
  el detalle con las **actualizaciones** (comentarios con autor y hora); los
  cambios de estado quedan anotados solos.
- Filtros: buscar, estado/vencidos, responsable, prioridad, reunión, "Míos".
- **Imprimir minuta**: elegís la reunión → compromisos de esa reunión,
  pendientes de reuniones anteriores y cerrados desde la reunión anterior.
- Carga inicial: `migracion_supabase/minutas/46b_minutas_carga.sql` (190
  compromisos del Excel de Monday; no está en GitHub porque son datos).

## Certificado de máquinas y tarifas

Solapa **Certificado de máquinas**: admin central edita, gerente solo ve
(`certificado.js` + `cert_maquinas.js`, SQL 23 y 45). Tres sub-solapas:
Certificados · Resumen de horas · Maestro de tarifas.

- **Certificados** (v20261016a, SQL 45 `cert_maq`): el certificado formal,
  con el formato de `migracion_supabase/Formato de Certificados.xlsx`.
  - Un solo formato con todas las columnas de las tres hojas. Plantillas
    **Estándar**, **Horas mínimas** y **Volumen mínimo** prenden las columnas
    de su hoja; después cada columna se incluye o excluye a mano (queda
    guardado con el certificado). Pantalla, Excel e impresión salen iguales.
  - Numerado por obra (único). **+ Nuevo certificado**: obra + período. Copia
    del certificado anterior de la obra cliente, RUC, líneas, precios, mínimos
    y columnas; su **acumulado pasa a ser el anterior**. Cantidades de los
    partes según la unidad de la línea: HM/HS → horas de horómetro, M3 → m³ de
    hormigón, TN → toneladas, DIAS → días con parte; MES/UN/GL se cargan a mano.
    Litros: gasoil despachado al equipo en la obra. Precio: tarifa 1 del
    maestro si la línea no tenía precio; mínimo: Mínimo Hr del maestro.
  - Mínimo del período = Mín × (DT/DM) × ((DM − DR)/DM) si hay "días
    considerados"; si no, el mínimo tal cual. A certificar = el mayor entre lo
    trabajado y el mínimo, **solo si la columna "mínimo del período" está
    incluida**. Se puede pisar a mano (queda en naranja, ↺ vuelve al cálculo).
  - Líneas manuales (traslados, salario de operador…), ↑ ↓ ✕, descuentos
    (positivo resta, negativo suma) y "Descontar el combustible provisto"
    (litros × Gs/lt). Total a cobrar con "Son guaraníes" en letras y firmas.
  - Estados: borrador → **Emitir** (ya no se edita) → Reabrir / Anular. Un
    anulado no cuenta como anterior. El primero de cada obra: cargá el
    anterior a mano (cantidad y monto) desde el Excel de siempre.
  - Excel con logo, celdas combinadas y **fórmulas** (precio total, acumulados,
    mínimo, totales); hoja aparte "Informe diario" (horómetro inicial/final y
    horas por día de cada equipo). Imprimir: A4 apaisado, con cálculo auxiliar
    y el informe diario como anexo (se elige en "Formato y columnas").
  - Power BI: vista `v_cert_maq_items` (una fila por línea).
  - Días operativos (v20261016i): cada línea con equipo trae los días que NO
    estuvo operativo (OT de taller abierta, estado Inoperativo en el historial
    de la flota, o parte con falla que impidió trabajar). Con "Descontar días
    inoperativos del mínimo", Mínimo del período = Mín × ((días − inoperativos)
    / días): 100 h con 15 de 30 días inoperativo → 50 h. Se corrige a mano
    (📅 por línea, o escribiendo los días inoperativos o el mínimo; ↺ vuelve
    al cálculo). Horas mínimas/mes: del certificado anterior, si no del
    contrato de alquiler, si no del Mínimo Hr del maestro de tarifas.
  - Informe diario: todos los días del período, con litros de combustible y
    operativo ✔/❌ (opcionales), totales y % de días operativos.
- **Resumen de horas:** elegís período y obra (o todas). Por cada equipo: días,
  horas de horómetro de los partes, tarifa por hora y costo. Con "todas las
  obras" muestra el total por obra y por equipo; tocando una obra entra al
  detalle. Se descarga en Excel (.xlsx: hojas Por obra, Detalle y Por equipo,
  con totales) e imprime / guarda en PDF.
- **Maestro de tarifas:** tabla `tarifas_equipos`, igual al Excel de Unysoft
  (Id, Equipo, Descripción, Fecha Hasta, Unidad Negocio, Mínimo Hr, Tarifa 1,
  Proveedor, Tarifa 2). Botón **Importar de Unysoft**: se elige el .xlsx tal
  cual se descarga y se actualiza por Id (lo que no viene no se borra).
  También se cargan o corrigen tarifas a mano.

Cómo se calcula:

- La **unidad de negocio** de una obra son las 5 primeras posiciones de su
  código + `00000` (305AM00048 → 305AM00000; 3050100006 → 3050100000).
- Para cada parte se toma la tarifa del equipo en esa unidad de negocio con
  la "fecha hasta" más cercana que no sea anterior al parte. Si todas
  vencieron se usa la última y se marca **vencida**.
- Costo = horas de horómetro × Tarifa 1. Las horas sin tarifa se muestran
  aparte y no suman. Tarifa 2 y Mínimo Hr se guardan pero todavía no se usan.
- Los equipos alquilados en Unysoft tienen un número como código; se vinculan
  con la app por el código al principio de la descripción (`TA-13042 ALQUILER…`).
  Los que no se encuentran quedan "sin vincular" y se eligen a mano.
- Excel suele dar vuelta día y mes de las fechas que puede leer como
  mes-día (03-12-2023 → 12 de marzo). La importación lo detecta y lo corrige.

---

## Historial de taller y de combustible (v20261026b, equipos-v59)

`mis_cargas.js`. Igual que el "Historial de partes" del operador, pero
para lo que cargan los mecánicos (Reporte de taller) y los despachadores
(Carga de combustible). Aparece como solapa propia a quien tiene ese
formulario y **no** es taller ni gerente (esos ya ven todo en Órdenes
de trabajo y Control de combustible). El admin central también la ve
(v20261026c, equipos-v60): con el filtro **Persona** ve lo de todos, lo
suyo o lo de un mecánico/despachador, y corrige siempre (sin límite de 24 h).

- Muestra solo lo suyo: lo que cargó él, o donde figura como técnico /
  despachador (por cédula). Filtro de fechas (30 días por defecto),
  actividad, buscador, totales (horas / litros) y Exportar.
- Arriba, lo que quedó en el teléfono sin enviar.
- Tocando una carga: detalle completo con fotos. Dentro de las 24 h de
  cargada la puede **corregir** o **eliminar** (papelera, 7 días).
- Sin señal muestra lo último que bajó.
- **No hay SQL nuevo**: usa las reglas de lectura del SQL 43 y
  `corregir_registro` / `eliminar_registro` del SQL 54, que ya controlan
  las 24 h y que sea suyo.

## Observación de flota: manual y aviso automático (v20261026d, SQL 57)

En la ficha del equipo (Flota › Estado) hay dos renglones:

- **Observación (manual)**: la escribe taller / administración. Ningún
  proceso la cambia.
- **Último aviso automático (parte / OT)** (`equipo_estado.observacion_auto`,
  solo lectura): lo que antes el sistema escribía en la observación cuando
  el estado del equipo empeora:
  - parte con falla de los últimos 3 días → `Parte DD/MM — fallas — tipo de
    falla — descripción de la falla` (solo los campos de la falla, no las
    observaciones generales del parte);
  - OT abierta o registro de trabajos → `OT N — nombre`;
  - OT cerrada que cambia el estado → `OT N cerrada — estado de salida`.
- **Situación actual**: siempre fue solo manual.

El SQL 57 agrega un disparador que desvía a `observacion_auto` lo que
escriben el parte y las OT (`flota.origen` = parte / ot), y pasa ahí las
observaciones que hoy tienen texto automático. En la tabla de flota hay
una columna nueva «Aviso parte / OT».

## Usuarios (Administración → Usuarios)

Igual que en la app de Cronograma y gestión de obras: lista con rol, obras
que ve, formularios, acceso y último ingreso; ✎ para editar; **+ Usuario**
para dar de alta, y la tabla "Qué puede hacer cada rol".

Dar de alta, cambiar contraseñas y ver el último ingreso necesitan la clave
de servicio de Supabase, que no puede estar en la app. Lo hace la Edge
Function `supabase/functions/usuarios` (la clave la pone Supabase sola; la
función primero verifica que quien llama sea admin_central).

- Alta con cédula → entra con la cédula (`<cédula>@campo.tecsul.com.py`); con correo → entra con el correo.
- Se crea con una contraseña inicial y al entrar se le pide cambiarla.
- "Cambiar" contraseña: para cuando alguien se la olvida (también le pide cambiarla al entrar).
