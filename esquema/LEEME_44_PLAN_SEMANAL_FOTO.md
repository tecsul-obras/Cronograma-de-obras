# v20261015d: cronograma por semana y foto del plan semanal

## Orden (importante)
1. **Correr `44_plan_semanal_foto.sql`** en el SQL Editor de Supabase (proyecto del cronograma). Se puede correr más de una vez.
2. **Después**, mezclar el PR de la app en GitHub (`main`). El badge pasa a `✓ v20261015d`.

Si se publica la app antes del SQL, la app avisa «Falta correr el SQL 44» y **no guarda el plan semanal** hasta que se corra. El resto del cronograma se guarda normalmente.

## Reglas nuevas
**Cronograma (pestaña Cronograma, vistas Meses y Semanas): un solo dato.**
- El dato base es la **cantidad por semana**. Cuando una semana cae entre dos meses, se parte por días (Regla B).
- El **mes es la suma de sus semanas**, siempre. La vista Meses, la vista Semanas y el plan semanal (semana en curso y futuras) muestran lo mismo.
- **Editar una semana** cambia esa semana y su mes cambia lo mismo. Si la semana ya tenía cantidad, se respeta cómo estaba partida entre los dos meses; si no, se parte por días.
- **Editar un mes** reparte ese valor parejo por día entre los días del ítem en ese mes (si el ítem arranca el 15, desde el 15). Los demás meses no se tocan.
- **Cambiar fechas** reparte la **cantidad vigente** parejo por día calendario desde el inicio real hasta el fin. Vale para cualquier forma de cambiar fechas: inicio, fin, duración, arrastrar la barra, dependencias, compactar, panel del ítem e importación de ítems.
- **Cargar una cantidad fuera de las fechas** (una semana o un mes) extiende las fechas hasta cubrirla, **sin repartir nada de nuevo**. Las fechas nunca se achican solas.
- **Nada se ajusta solo** contra la cantidad vigente: la diferencia se ve en «Σ Cronograma» y se corrige con **Ajustar**. Ajustar pone el residuo en la última semana con cantidad (y, si no alcanza para restar, sigue hacia atrás).
- Cambiar la cantidad ajustada o la de contrato **no reparte** el plan. Se reparte con la próxima vez que cambien las fechas, o con Ajustar.
- «Re-sincronizar» reparte todos los ítems parejo según sus fechas y su cantidad vigente. Pisa lo cargado a mano, por eso pide confirmación.
- Sin redondeo que pierda decimales: cada pedazo va con 6 decimales y el más grande cierra el residuo. Las cantidades MOPC con 4 decimales cierran exacto.

**Plan semanal (pestaña Plan semanal): dos tramos.**
- **Semana en curso y futuras** = el cronograma. Lo que se edita ahí cambia el cronograma, y al revés.
- **Semanas cerradas** (desde el lunes 00:00 siguiente) = la **foto**: lo que quedó planificado al cerrar. No cambia con el cronograma y sirve de KPI (PPC). Siempre se actualizan lo ejecutado (sale de Producción), la causa y el estado de las actividades. Solo el administrador corrige la foto (por ejemplo, para cargar el historial de Monday), y esa corrección no toca el cronograma.

## Qué hace el SQL
- Tabla `plan_semanal_foto` (misma forma que `plan_semanal`) y `plan_semanal_foto_estado` (hasta qué semana ya se sacó la foto, por obra). Lectura igual que el resto; escritura solo por la función.
- `cron_guardar_semanal` nueva: antes de guardar, saca la foto de las semanas que cerraron desde la última vez, con lo que estaba guardado (lo que había al cerrar). Después reemplaza el cronograma completo, todas las semanas. Si viene la foto editada, el admin la reemplaza y los demás solo cambian la causa.
- **Primera foto:** al correrlo se fotografían todas las semanas cerradas de todas las obras **tal como están hoy**. El historial no cambia.
- `v_powerbi_programacion_semanal`: las semanas cerradas salen de la foto y las demás del cronograma. Las columnas son las mismas, así que no hay que tocar nada en Power BI.

## Al abrir cada obra la primera vez
Los ítems cuyas semanas no suman su mes (por ejemplo, porque había semanas cerradas congeladas dentro del cronograma) se rearman desde su mensual. En la consola del navegador se ve cuántos fueron (`[cronograma] N ítem(s)…`). Esto se guarda con el próximo cambio que se haga en la obra. La foto no se toca.

## Prueba sugerida (obra Prueba)
1. En Cronograma › Cantidad › Semanas, editá una semana futura. Pasá a Meses: el mes tiene que haber cambiado exactamente lo mismo.
2. Abrí Plan semanal en esa semana: tiene que estar el mismo número. Cambialo ahí y volvé al Gantt.
3. Cambiá el inicio de un ítem al día 15: meses y semanas se reparten parejo desde el 15 y la Σ queda igual a la cantidad vigente.
4. Abrí una semana cerrada en Plan semanal: tiene que mostrar lo que había (por ejemplo, el 7 de la semana 40 de la obra Prueba), aunque el cronograma ya no lo tenga.
