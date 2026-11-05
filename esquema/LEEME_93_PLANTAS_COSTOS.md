# SQL 93 — Plantas: medición sin producción, tabla del CAP y costo por tonelada (05/11/2026)

Correr **después del 92**, en el SQL Editor de Supabase (`93_plantas_costos.sql`, ≈ 16 KB).
No borra nada y se puede correr dos veces. Al final muestra los 3 tanques de la PA-01: el de CAP
tiene que decir `tabla · libre · 301 puntos`, y `equipos_planta = 2` (PC-04 y GG-02).

## 1. Medir tanques sin arrancar la planta

En **Parte de planta**, cuando la planta no está en marcha, aparece «Medir tanques sin arrancar la
planta»: hora + regla de los tanques que se midan (no hace falta cargar los tres) + observación.
Pensado para la caldera, que calienta el CAP también los días sin producción. La lista muestra cuánto
bajó cada tanque entre mediciones. Esas mediciones cuentan en el stock de En vivo y en los costos.

## 2. Tabla del tanque de CAP de 40.000 L

Se cargó `control_tanque.xlsx` (columna «Litros»: altura libre 0 → 3,00 m = 41.079 → 0 L) en el
**Tanque de CAP de la PA-01** como tabla, regla «libre», altura 3,00 m. Solo si ese tanque no tenía
tabla todavía. Falta la **densidad de referencia** del CAP (Configuración › Tanques).
La planilla trae otra columna «Litros2» (20.531 L con el tanque lleno): si es otro tanque, se carga
igual con el botón **Tabla**.

## 3. Costos (vista **Costos**, para admin central, admin de obra y gerentes)

Costo por tonelada del período =

| Grupo | De dónde sale |
|---|---|
| CAP | consumo medido con las reglas (tanque + recargas) × precio del CAP (USD × tipo de cambio) |
| Áridos y filler | producción × % de la **dosificación** de la fórmula × (1 + desperdicio, 5 %) × precio |
| Fuel secadero / gasoil caldera | litros medidos (también los días sin producción) × precio |
| Equipos de la planta | horas del parte diario × tarifa del maestro de tarifas (la de esa obra y fecha). Solo las horas cargadas en la obra donde está la planta: si la PC-04 se fue a otra obra, esas horas no se le cargan |
| Amortización de la planta | tarifa de la planta × t (Configuración; si está vacía, la del maestro: PA-01 = 27.800 Gs) |
| Fijos | costo fijo mensual (personal de planta, etc.) × días / 30 |

Producción = báscula. Se compara con el **costo de referencia (APU)** que se cargue, y se reparte por
obra destino para imputar. Arriba avisa lo que falta (precios, tipo de cambio, densidad, dosificación,
partes sin tarifa, horas en otras obras, tanques que subieron sin recarga cargada).

## Configuración nueva (admin central)

- **Planta**: tipo de cambio, costo fijo mensual, % de desperdicio de áridos, costo de referencia APU.
- **Precios de insumos**: CAP (t), áridos (t), filler/cal (t), fuel y gasoil (L), en Gs o USD, con fecha
  desde (para cambiar un precio se agrega otro renglón; vale el último vigente). «Maestro» trae el precio
  sin IVA de un recurso del maestro en una obra.
- **Fórmulas › Dosificación**: % de cada material sobre la mezcla, con su precio (como la planilla
  Consumo PA01: 6ª 40,15 · 5ª 16,66 · 4ª 30,59 · arena 7,21 · cal 0,99 %). El CAP no va acá.
- **Equipos de la planta**: PC-04 y GG-02 vienen cargados para la PA-01 (de la planilla); cambiarlos si no corresponde.

## Quién ve los precios

Admin central, admin de obra, gerente (Equipos u Obras) y admin de Obras. El encargado, los operadores,
la báscula y taller no ven la solapa Costos ni los precios (lo impide la base).
