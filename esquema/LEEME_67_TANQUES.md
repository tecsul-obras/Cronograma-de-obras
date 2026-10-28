# SQL 67 — tanques de combustible unificados · equipos-v75 (28/10/2026)

Aplica la «Propuesta de unificación de tanques de combustible» con las respuestas de Taller.

**Cuándo:** a primera hora, con los despachadores sin cargas pendientes. Igual, si un
celular manda una carga vieja con un código anterior, la base la pasa sola al código
nuevo (tabla `equipo_codigo_anterior`): no se rechaza.

**Cómo:** SQL Editor de Supabase → `67_tanques_unificacion.sql` de Drive (`migracion_supabase\tanques\`, ≈ 59 KB: trae la lista de Submission ID de la bodega 1012599996; la copia del repo público no la tiene). No borra
nada y se puede correr dos veces. Después, publicar la app (equipos-v75) y pedir a los
despachadores que la actualicen.

## Qué cambia

| Antes | Ahora | Qué es |
|---|---|---|
| TQM-5937 | **TQM-CC02** | Despacho 13.000 L en CC-02 |
| TQM-3516 | **TQM-CM01** | Despacho 2.000 L en CM-01 |
| — | **TQM-CM02** (nuevo) | Despacho 6.000 L en CM-02 |
| TQM-1051 | **TQM-CM03** | Despacho 6.000 L en CM-03 |
| TQM-6035 | **TQM-CM04** | Despacho 5.000 L en CM-04 |
| TQM-3366 | **TQM-01** | Móvil 3.000 L Ruta de la Leche |
| TQM-6522 | **TQM-02** | Móvil 1.000 L CT Vial (el «Minga Guazú» de JotForm) |
| TQM-2458 | **TQM-03** | Móvil 1.000 L CCC/Tecsul |
| TQM-7244 | **TQM-04** | Móvil 1.000 L Olimpia |
| TQM-2503 | **TQM-05** | Móvil 1.000 L CECON |
| TQM-10 | **TQM-06** | Móvil Consorcio Victoria |
| — | **TQM-07** (nuevo) | Móvil 1.000 L: el que rotó por Taller Central, Cruz Monte y Molas Abasto |
| TQM-1715 | → **TQ-02** | Duplicado del fijo de Ruta de la Banana (Tembiaporá): cargas a TQ-02, queda de baja |

TQ-01 a TQ-09 conservan el código; cambian las descripciones (tipo, capacidad, obra).
La ubicación del día no va en el nombre: la muestra Flota.

- **Bodega 1012599996** (Ruta de la Banana) = fijo **TQ-02**: 1.404 despachos y 11
  ingresos de proveedor pasan del móvil del CM-04 a TQ-02 (por Submission ID).
- **Cargas de JotForm que eran solo texto** quedan vinculadas: CM-02 → TQM-CM02,
  Minga Guazú → TQM-02, Ruta de la Leche → TQM-01, Taller Central / Cruz Monte /
  Molas Abasto 1.000 L → TQM-07, bodegas de Consorcio Victoria → TQ-09 / TQM-06.
  El texto original queda guardado. Quedan como texto los 26 «(sin tanque de salida
  en JotForm)» (9 millones de litros: hay al menos un valor mal cargado para corregir).
- **Trasvase entre tanques** (actividad nueva): sale de un tanque y entra a otro, no es
  consumo de ninguna máquina. Pasan a trasvase los ~640 despachos que tenían un tanque
  como receptor y los 10 despachos de más de 400 L a CC-02 / CM-01 / CM-03 (eran el
  llenado de su tanque de despacho; quedan con la nota «Antes: despacho a …»).
- **Emulsión / diluido** (TQ-03, TQ-06, TQ-08): fuera del formulario de combustible y
  del stock (se reconocen por el Tipo en Flota).
- Stock de tanques: los trasvases suman al que recibe y restan al que sale. El cuenta
  litros precargado también toma el último trasvase.

## En la app (equipos-v75)

- Formulario de combustible: botón **Trasvase** (tanque de salida → tanque que recibe,
  cuenta litros, litros, fotos). Se edita desde «Editar formulario» como las demás secciones.
- En **Despacho**, el receptor ya no ofrece tanques. Si el receptor es un camión con
  tanque de despacho y los litros superan su tanque de motor, pregunta: «Sí, llené el
  TQM-xx (trasvase)» / «No, fue al motor» / «Volver».
- Tanque del motor: Flota › ficha › Consumo y valores › **Tanque del motor (L)**.
  Mientras no esté cargado se usa 200 L. Con el dato cargado, la vista de anomalías
  también marca cargas mayores al tanque del motor.
- En la ficha de un tanque: **Montado en (camión)**, para cuando se pasa a otro camión.
- Control de combustible y «Mis cargas»: actividad Trasvase en filtros y en Corregir.

## JotForm (mientras se siga usando)

`migracion_supabase\Combustible y Taller\`: `mapeo_tanques.csv` ya tiene los códigos
nuevos y `cargar_combustible_taller.py` marca como Trasvase lo que va de un tanque a
otro y los despachos de más de 400 L a un camión con tanque de despacho. Correr el
SQL 67 **antes** de volver a cargar.

## Comprobación

Al final el SQL lista los tanques con sus cargas y un resumen. Con los datos del 28/10:
trasvases ≈ 650 · despachos solo texto = 26 · TQ-02 ≈ 1.405 salidas y 11 ingresos ·
códigos anteriores = 11. (Probado sobre la base real en una transacción deshecha.)

Pendiente de Taller, en la app: capacidad de TQ-08, TQ-09 y TQM-06, y el tanque del
motor de CM-01…04 y CC-02.
