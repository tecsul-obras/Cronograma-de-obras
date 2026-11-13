# SQL 116 · Permisos a medida por pestaña (v20261113d · obra-shell-v102 · equipos-v120)

## Qué cambia
En **Administración › Usuarios › ✎ (ficha)** hay una sección nueva **🔐 Pestañas y permisos**: una fila por pestaña o permiso, con lo que da el rol y lo que se elige para esa persona.

- **Pestañas** (Cronograma, Producción, Certificación, Flota, OT, Certificado de máquinas, Plantas…): *Como su rol* / *Editar solo en sus obras* / *Solo ver* / *Oculto*. Solo se pueden **bajar** respecto del rol; para dar más hay que cambiar el rol.
- **Acciones**: eliminar partes, cargas y reportes · emitir certificados de máquinas · aprobar certificados de obra → *No*.
- **Formularios** (parte, taller, combustible), **Compras de taller** (ver, solicitar, bodega, compras, autorizar) y **Recursos humanos**: se pueden **dar o quitar**. Ej.: admin central sin «Autorizar compras».
- **🧩 Plantillas** (roles a medida): rol en Obras + rol en Equipos + permisos cambiados. Se asignan en la ficha. Si se cambia la plantilla, cambia para todos los que la tienen (también el rol). En la ficha se puede ajustar algo más solo para esa persona. Botón «Guardar como plantilla…» en la ficha.

## Cómo se respeta
- La pestaña oculta no aparece (Obras, Equipos, Compras). En Obras, «Solo ver» abre la pestaña en modo lectura; en Equipos avisa.
- **La base rechaza** cargar, editar o eliminar en lo quitado (control en 68 tablas). «Editar solo en sus obras» usa las obras de la persona (Obras: obras que ve · Equipos: frentes).
- Lo automático (sincronización de JotForm, disparadores en cadena, tareas programadas) no se ve afectado.
- Leer datos sigue dependiendo del rol (decidido: ocultar + bloquear cargas).

## Lo que pasa al correrlo
- Los 20 formularios marcados a mano pasan a permisos (Sí/No respecto del automático): nadie gana ni pierde un formulario.
- Los RRHH extra (permiso_extra) pasan a permisos.
- Compras de taller: lo dado a mano sigue en tc_permiso (la pantalla Compras › Taller › Permisos sigue andando); lo quitado va en los permisos nuevos. La función de siempre queda como `tc_yo_rol` y `tc_yo` le aplica los ajustes.

## Quién edita
- Administrador de Obras: todo, y las plantillas.
- Admin central de Equipos: los permisos de Equipos, Compras de taller y RRHH (los de Obras y las plantillas los ve).

## Pasos
1. Supabase › SQL Editor › `116_permisos_a_medida.sql`. Debe dar `39 · 68 · t · (número) · 0`.
2. Publicar la rama `permisos-a-medida-116` a main.
3. Probar: ficha de un admin central → Compras de taller: autorizar → *No* → Guardar. Esa persona ya no ve «Autorizar» en Compras de taller.
