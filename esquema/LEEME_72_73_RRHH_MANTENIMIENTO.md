# 72 · Recursos humanos  ·  73 · Services por horas (29/10/2026)

App v20261029a (obra-shell-v69) · equipos-v79.

## Orden

| # | Archivo | Dónde | Qué hace | Comprobación al final |
|---|---|---|---|---|
| 72 | `72_rrhh.sql` | GitHub y Drive | Sección **Recursos humanos**: rol `rrhh`, tablas, permisos, funciones | `tablas_ok_4 = 4`, `politicas_ok_8 = 8`, `categorias_16 = 16`, `rol_rrhh_true = t` |
| 73 | `73_mantenimiento_ciclo_horometro.sql` | GitHub y Drive | Solo un preventivo mueve el contador de horas; planes viejos sin horas pasan al ciclo 250 → 2.000 | `planes_sin_frecuencia_0 = 0`, `solo_preventivo_true = t` |
| 73b | `73b_control_mantenimiento_datos.sql` | **Solo Drive** (datos) | Últimos services de *CONTROL DE MANTENIMIENTO GENERAL.xlsx* sin pisar lo de la app | Resumen por acción y la lista para revisar |

Después de los SQL, publicar la app (rama `rrhh-mantenimiento-v79` → `main`).
Si se publica antes del 72, el menú simplemente no muestra Recursos humanos
(y la página rrhh/ avisa «Falta correr el SQL 72»). Nada más se rompe.

Los tres se probaron sobre la base real dentro de una transacción que se
deshizo al final (no quedó nada escrito) y la app completa contra un
Postgres local con las mismas funciones y permisos.

---

## 72 · Recursos humanos (`rrhh/`)

Se entra desde el botón **⊞ Otras apps de Tecsul** (en Obras, en Parte
diario y en Flota) → **👥 Recursos humanos**.

**Quién** (lo decide la base, `rrhh_acceso()`; las tablas tienen RLS):

| Quién | Qué |
|---|---|
| Administrador de Obras (`admin`) | carga y edita |
| Admin central de Equipos (`admin_central`) | carga y edita |
| **Recursos humanos** (`rrhh`, rol nuevo en Obras) | carga y edita; al entrar va directo a `rrhh/` (no ve obras) |
| Gerente | solo ve |
| Todos los demás | no ven nada (ni el botón ni los datos) |

El rol se da en **Administración › persona › Rol en Obras › Recursos humanos**
(con correo @tecsul.com.py; no hace falta asignarle obras).

**Solapas:**

- **Planilla de salarios** — una por mes, con las mismas columnas del Excel
  de RRHH. Total horas, total bruto, IPS y sueldo líquido se calculan solos
  (mismas fórmulas que el Excel; la base también los calcula). Al cambiar
  días o salario base se recalcula el salario a cobrar (base × días ÷ 30),
  salvo que se haya escrito a mano.
  - **Importar Excel**: busca la hoja con *Nº CI* y *Apellido y nombre*,
    lee el mes del título, muestra totales comparados con la fila TOTALES y
    los avisos. Se carga en pantalla y recién se guarda con **Guardar**.
  - **Bajar Excel**: mismo formato, con fórmulas, más la hoja CATEGORÍAS.
  - **Nueva planilla**: copia las personas de un mes (o el legajo), días 30,
    sin HH ni descuentos. Quien está de baja en el legajo no se copia.
  - **Comparar HH con partes**: suma las horas hombre de los partes diarios
    del período (por defecto del 26 del mes anterior al 25) por cédula y
    muestra la diferencia. **Traer HH de partes…** propone los cambios con
    casillas; nada se aplica sin confirmar.
  - **Cerrar planilla**: cerrada no se puede modificar ni eliminar (se puede
    reabrir). Eliminar pide escribir el mes.
  - Si otra persona guardó la misma planilla mientras estaba abierta, no se
    pisa: avisa y hay que volver a abrirla.
  - ⚠ en la celda: precio de la hora fuera del rango de la categoría,
    salario base menor al salario mínimo de la planilla, salario a cobrar
    distinto del cálculo, HH distintas a los partes. No bloquea.
- **Personal** — legajo: queda solo con la última planilla guardada de cada
  persona; se corrige a mano y se da de baja (fecha de baja).
- **Categorías** — las de la hoja CATEGORÍAS del Excel (salario y HH mín./máx.).

Los datos de salarios **no van a GitHub**: se cargan desde la pantalla con
*Importar Excel*.

### Lo que se vio en la planilla de septiembre 2026

- La fila **TOTALES** del Excel suma desde la fila 9 (`SUBTOTAL(9,L9:L145)`):
  **deja afuera a la primera persona** (Dominguez, Cristina). Por eso el
  total bruto del Excel da 641.816.834 y el real es 646.034.064 (IPS
  56.599.047 vs 56.978.598). El líquido sí la incluye (`SUM(X8:X145)`).
- Sin IPS en el Excel (quedan con 0 %): Baez Arzamendia, Gonzalez Maidana,
  Avalos Medina.
- Espinola Gimenez, Lucas Ramon: factor s/SM **11,1** (seguramente 1,1).
- Acosta Vera, Eliodoro: fecha de ingreso escrita «11/08/026» → 11/08/2026.
- Cardenas Rojas: salario base 3.800.000 pero a cobrar 3.900.000 (queda como cargado a mano).
- La hoja CATEGORÍAS tiene salarios por debajo del mínimo vigente (2.900.000
  vs 3.044.000): por eso la app no marca el salario contra la categoría.
- Las HH del Excel coinciden con los partes del **26/08 al 25/09** en la
  mayoría; hay 47 personas con diferencia (ver «Comparar HH con partes»).

---

## 73 · Services por horas

José confirmó:
1. 250, 500 y 750 h usan el mismo kit, pero se registran como **250, 500 y
   750** (no todo como 250), para saber cuándo viene el de 1.000 y el de
   2.000. → Ya era así en la app y en el reporte de taller (ciclo 250 → 2.000
   del SQL 63). El 73 pasa a ese ciclo los **21 planes viejos de Monday**
   que no tenían horas ni ciclo («Mantenimiento preventivo» cada 60 días):
   esos equipos no avisaban nunca el próximo service por horas.
2. Las 250 h corren **desde el horómetro del último service hecho**: si se
   hizo a las 265 h, el próximo es a las 515 h. → La vista ya calculaba
   último + 250. Se corrige que un correctivo con plan elegido en la ficha
   reiniciaba el contador, y que un horómetro vacío o 0 lo pisaba.

### 73b · Planilla CONTROL DE MANTENIMIENTO GENERAL (solo Drive)

Probado sobre la base real (deshecho al final), hoy daría:

| Acción | Renglones | Qué es |
|---|---|---|
| agregar | 100 | Service que la app no tenía: entra como Preventivo con nivel, horómetro y fecha. El plan lo toma como último solo si es más nuevo que el de la app |
| completar_nivel | 17 | La app lo tenía (vino de Monday) pero sin nivel: se completa 250/500/… |
| revisar | 1 | EX-18: la app y el plan dicen 750 h; la planilla 250 h → no se toca |
| ya_estaba | 1 | TA-04 |
| saltear | 15 | 9 sin datos («No está en el monitor»), VC-13 con fecha 06/12/2026 (futura), MT-01 / CV-10 / TC-02 / CV-06 con horómetro mayor al actual (cambio de horómetro o error), CRA-01 que no cierra con lo cargado en la app |

Para revisar en la planilla (el texto «Ultimo … H:» no coincide con la
columna HORÓMETRO ULT. MANTENIMIENTO; se usó la columna): CR-02, CV-03,
CV-04, CV-09, CX-04, MN-03, MN-05, PC-02, AM-01, TC-02, CRA-01. ES-01 dice
«550hs» y VC-20 «100hs» (rodaje): entran sin nivel. CV-01 queda con el
último service a las 668 h y el parte marca 12.105 h (la planilla también
lo da muy vencido). CV-06 tiene el mismo horómetro que CV-05 (copiado).

Los agregados empiezan con «Planilla CONTROL DE MANTENIMIENTO GENERAL» en la
descripción y no llevan kit de recursos (no se sabe qué se usó).
Se puede correr dos veces: la segunda no agrega nada.

### Volver atrás
- 73: ver el final del archivo (solo la regla del contador).
- 73b: `delete from mantenimientos where descripcion like 'Planilla CONTROL DE MANTENIMIENTO GENERAL%';`
  (los niveles completados quedan; los planes no vuelven solos a su último anterior).
