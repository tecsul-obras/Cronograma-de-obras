# SQL 66 — equipos-v71 (28/10/2026)

Correr en el **SQL Editor de Supabase** `66_ot_tipo_por_origen.sql` (después del 65).
No borra datos y se puede correr más de una vez.

Tipo de OT con las reglas de José (reemplaza la estimación por ubicación del SQL 65):

1. Ubicación **TALLER CENTRAL** → siempre **Taller**.
2. Abierta desde **Registro de Trabajos - OT** → siempre **Pista**.
3. **Diagnóstico Inicial - Generación OT** → el tipo elegido; si no se eligió, **Taller**.
4. Reporte de falla / parte diario (OT Solicitada) → sin tipo hasta que taller la toma (se elige al tomarla).

Corrige el tipo guardado de todas las OT (sin tocar fechas, estado ni flota) y un
disparador lo aplica a las OT nuevas y editadas. En la bandeja, «Editar» no deja
cambiar el tipo cuando lo fija la regla 1 o 2. El formulario de Registro de
Trabajos ya no pregunta el tipo.

Comprobación al final: tabla «antes → ahora» con la cantidad de OT. Con los datos
del 28/10 debería dar aprox.: sin tipo → Pista 2.017; sin tipo → Taller 361;
Pista → Taller 1 (una OT de pista en TALLER CENTRAL); quedan 12 sin tipo
(solicitadas desde el parte o reporte de falla).
