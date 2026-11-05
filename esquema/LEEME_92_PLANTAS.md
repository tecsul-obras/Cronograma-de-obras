# SQL 92 — Plantas (asfalto, hormigón, suelo) · equipos-v91 (05/11/2026)

Pestaña nueva **Plantas** dentro de Equipos (`equipos/plantas.html` + `plantas.js`).
Fase 1: parte de planta, lecturas cada hora, **En vivo**, tablero, recargas y configuración.
Los costos por tonelada (amortización de la planta + máquinas + insumos) son la fase 2.

## Cómo se instala

1. **SQL Editor de Supabase** → correr `92_plantas.sql` (≈ 25 KB). No borra nada y se puede correr dos veces.
   Al final muestra las 4 plantas, cuántos tanques tiene cada una y `tablas_en_vivo = 4`.
2. Publicar la app (equipos-v91: `plantas.html`, `plantas.js`, `menu.js`, `sw.js`).
3. Entrar como admin central → Equipos → **Plantas** → **Configuración** (PA-01 y PA-02):
   - **Tanques**: medidas (Ø y largo si es cilindro acostado), regla «libre» o «stock» y
     **densidad de referencia** del CAP (t/m³, la que usan para la lectura a 150 °C).
     Si tienen la tabla de Excel: botón **Tabla** → pegar columnas altura | litros
     (se pueden pegar las 4 parejas de la Hoja2 de cilindro_vol tal cual). **Probar** calcula
     los litros de una regla para comparar con lo que ya usan.
   - El fuel del secadero de la PA-01 viene cargado con Ø 1,90 × 4,80 m (la planilla
     cilindro_vol.xlsx, ≈ 13.609 L). **Confirmar que es ese tanque**; los otros dos quedan sin medidas.
   - **Fórmulas**: nombre y % de CAP (ej. «Polímero TECSUL» 4,60 %), tolerancia ± (vacío = la de la planta, 0,2).
   - **Personal**: agregar al encargado y a los operadores de cada planta (del personal de Flota, por cédula).
   - **Planta**: caudal nominal, tarifa de amortización (para la fase 2), tolerancias, causas de parada.

## Quién ve qué (lo decide la base, `planta_rol`)

| Persona | Parte de planta | En vivo / Tablero | Recargas | Configuración |
|---|---|---|---|---|
| Admin central | sí | sí | todas | sí |
| Encargado de la planta | carga, corrige y reabre | sí | fuel / gasoil (no CAP) | — |
| Operador de la planta | carga (corrige lo suyo con la jornada abierta) | sí | — | — |
| Admin de obra | — | sí | **todas, incluido CAP** | — |
| Gerente, taller, gerente/admin de Obras | — | sí | ve | — |

## El parte de planta (celular)

- **Arranque**: obra destino, fórmula, contador del SCADA («Producción planta») y regla de cada tanque.
- **Lectura de la hora**: contador + reglas (+ CAP del SCADA opcional). Al escribir la regla se ve en el
  momento cuántos litros (y toneladas de CAP) son. Antes de enviar muestra el tramo: t, t/h, %CAP, L/t,
  en verde o rojo contra la fórmula. Si escriben «39» en un tanque de 1,20 m lo toma como 39 cm.
- **Paré la planta / Reanudé**: causa (falta de camión, espera en pista, falla…) con hora.
- **Cerrar jornada**: **báscula total y viajes (producción oficial)**, contador y totales del SCADA,
  reglas finales, foto de la pantalla del SCADA o del ticket.
- **Sin señal**: todo queda en el teléfono («⏳ n sin enviar») y se envía solo cuando vuelve la señal.
  Cada fila lleva su id desde el teléfono, así reenviar nunca duplica.

## Parte de báscula (rev. b)

- Solapa **Báscula**: un renglón por ticket — hora, N° de ticket, chapa, obra destino, **bruto y tara**
  (o neto directo), foto del ticket opcional. La tara se completa sola con la última de esa chapa.
  Avisa si el ticket ya está cargado o si el neto pasa de 45 t; no acepta más de 80 t (kg por t).
  El N° de ticket siguiente se propone solo (+1).
- Lo carga el **operador de báscula** (rol nuevo «Báscula» en Configuración › Personal), el encargado
  o los operadores. Corrige lo suyo 48 h; el encargado y el admin siempre.
- Cada ticket se suma a la jornada abierta (o a la del día) y llega **en vivo**: En vivo muestra
  báscula despachada, camiones, último camión y la columna «Báscula t» por hora al lado del contador.
- Al cerrar la jornada, el total y los viajes de báscula vienen ya sumados de los tickets.
- Tabla `planta_pesadas` y vista `v_powerbi_plantas_pesadas` (un renglón por ticket).

## Probar sin publicar en main

1. Correr el SQL 92 (solo agrega tablas: la app publicada no cambia nada).
2. Doble clic en `rama-supabase\probar_plantas_local.bat`: levanta la app en tu PC
   (http://localhost:8080) y abre el ingreso. Entrar con tu usuario y luego ir a Equipos › Plantas.
3. Desde el celular, en la misma red WiFi: `http://<IP de la PC>:8080/equipos/plantas.html`
   (la IP la muestra la ventana del .bat). Así se prueba el en vivo entre celular y PC.
   En modo local no funciona el modo sin señal del service worker (solo en https).

## En vivo

Se actualiza sola (Supabase Realtime) cuando llega una lectura, parada, recarga o cierre:
estado (produciendo / parada y por qué), t/h, %CAP y L/t de la última hora y del día, gráfico hora a
hora con la franja de la fórmula, stock de cada tanque con cuántas horas de planta alcanza, y aviso
cuando pasan más de 90 min sin lectura (configurable). Si una hora sale de la fórmula aparece un aviso
rojo con sonido; con «Activar avisos en este equipo» también llega como notificación mientras la
página esté abierta (aunque sea en otra pestaña). Avisos con la app cerrada (push) quedan para después.

## Cálculos

- Litros = aforo(altura de líquido); «libre» → altura = alto del tanque − regla.
  Cilindro acostado: A = r²·acos((r−h)/r) − (r−h)·√(h·(2r−h)), V = A·largo (igual a cilindro_vol.xlsx:
  0,49 m → 2.779,7 L; 1,00 m → 7.260,5 L).
- Consumo de un tramo = litros antes + recargas en el tramo − litros después. Si sube sin recarga
  cargada, la lectura queda marcada «revisar».
- CAP t = litros × densidad ÷ 1000 · %CAP = CAP t ÷ t del contador · L/t = litros de fuel ÷ t.
- Tablero: producción = **báscula** (si falta, el contador); Dif. % contador vs báscula; Transporte =
  toneladas cargadas en pista para esa obra y día (`planta_transporte`, control cruzado).

## Tablas y vistas

`plantas`, `planta_tanques`, `planta_formulas`, `planta_personal`, `planta_jornadas`, `planta_lecturas`,
`planta_paradas`, `planta_recargas` · bucket privado `plantas` (fotos) ·
`v_planta_consumo_jornada` (consumo por jornada y tanque) · `v_powerbi_plantas_jornadas` (una fila por
jornada, lista para Power BI / la reunión del lunes).

## Pendiente (fase 1b / 2)

- Leer la foto del SCADA con IA (propone los números, el encargado confirma). La PA-02 tiene otro SCADA.
- Detalle de pesadas de báscula por camión (importar el reporte de la báscula, si lo exporta).
- Costo por tonelada: amortización de la planta + PC/GG del parte diario × tarifas + insumos × precios.
- PH-01 y PS-01: dosificaciones (cemento kg/m³) y sus tanques/silos.
