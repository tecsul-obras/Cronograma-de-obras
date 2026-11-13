/* =========================================================================
 * sw.js — Service Worker de la PWA "Cronograma de Obra"
 *
 * Objetivo: que la app ABRA sin conexión y cargue más rápido en visitas
 * repetidas (los archivos se sirven desde caché en vez de la red).
 *
 * Estrategias:
 *  - POST (todas las llamadas al Apps Script) → SIEMPRE red directa. No se
 *    cachean; el guardado offline lo maneja la "outbox" en offline.js.
 *  - Cross-origin (script.google.com, Power BI, etc.) → red directa.
 *  - Navegación / HTML (index.html) → red primero, caché de respaldo. Así un
 *    deploy nuevo se ve enseguida, pero offline igual abre.
 *  - Resto same-origin (js/css/íconos, versionados con ?v=) → stale-while-
 *    revalidate: responde del caché al instante y actualiza en segundo plano.
 *    Como los .js llevan ?v=... en la URL, un cambio de versión = URL nueva =
 *    se baja fresco automáticamente.
 *
 * Al subir cambios importantes al SW, subí también CACHE_VERSION para que los
 * navegadores limpien la caché vieja.
 * ========================================================================= */

'use strict';

var CACHE_VERSION = 'obra-shell-v102';   // v102: permisos a medida por pestaña (SQL 116, usuarios.js + permisos_app.js): ocultar / solo ver / editar solo en sus obras / acciones, y plantillas · v101: letras del celular iguales a la PC (--fs 1) en Obras, Compras y RRHH · v100: letras 15 % más grandes en el celular (--fs 1.15, antes 1.2) · v99: Administración › Usuarios única (usuarios.js, SQL 113): la misma pantalla en Obras y en Equipos, con rol en Obras, rol en Equipos (también Compras de taller), formularios a medida, compras de taller, plantas, responsable de máquinas, aprobador de partes y RRHH por persona · v98: fotos en grande y fotos en Drive «Fotos Tecsul» (visor.js, función «foto», SQL 112) en transporte, producción y su galería; las de más de un año quedan «Foto vencida» · v97: Compras › Taller/UCC › entregas sin «preparado» (envío directo con tipo y n° de documento), stock parcial y «Cerrar con lo entregado» (SQL 111) · v96: Compras › sección «⭐ Estratégicas UCC» (pedidos especiales del taller directo a compras, UCC-000001, SQL 110) · v95: producción › subpestaña Galería de fotos; cronograma › columna Cant. certificada (ocultable) · v94: producción › historial: editar también fecha e ítem (SQL 105) · v93: cronograma › listado navegable por celda (←→ columnas, rangos con Shift, editar con Enter o escribiendo), arreglo de la selección «pegada» en la grilla y barra Promedio · Recuento · Suma · v92: cronograma › el divisor tabla/Gantt se lleva casi hasta el borde derecho (sin tope de 920 px) · v91: cronograma › línea base también en las barras de grupo (plegados), sin barra si la cant. ajustada es 0, columna Categoría · v90: compras de taller › cotizaciones con quién cotizó debajo del proveedor · v89: compras de taller › cotización sin Flete y con archivos adjuntos (PDF o foto) vinculados a la cotización · v88: «Otras apps» › Plantas (equipos/plantas.html, SQL 92) para quien tiene rol en alguna planta · v87: producción › editar una fila migrada de JotForm sin longitud ya no recalcula la cantidad a 0 · v86: producción › progresivas en formato 0+000 (carga con + o en metros, 1000 → 1+000) y columna Progresivas en el historial, editables · v85: situación de pista › exportar imagen para compartir (WhatsApp) y PDF A4 apaisado legible, pista en una sola línea · v84: Histórico Monday con un pedido por fila (SQL 86: copias de cada tablero juntas, ficha por tablero) · v83: Compras › Taller › «🕘 Histórico Monday» (solo lectura, SQL 85) · v82: módulo Compras › sección Taller (compras/taller.js, SQL 79: pedidos TAL, bodega central, cotización, autorización, compra, entregas parciales) · v81: transporte › «Acopio Intermedio» también como origen · v80: presentación › nombres largos cortados en una línea · v79: presentación semanal en PowerPoint (Avance / Informes y ☰ Funciones) · v78: rol Administrador de obra (SQL 76: ve todo, edita producción, transporte y compras) · v77: módulo Compras con Necesidad por recurso y Maestro (eligiendo obra); bandeja de todas las obras con requerido, ítem/CC, UM, cotización elegida, P.U. presupuesto y monto · v76: módulo Compras aparte (compras/: pedidos de todas las obras y KPIs, sin tarjetas de contrato/avance; «Otras apps» › Compras; el rol Compras entra directo) · v75: cronograma › filtros numéricos por columna (>0, <100, rangos) y chips de filtros activos · v74: certificación › el tope avisa en vez de bloquear (SQL 90) · v73: situación de pista › derivar desde liberaciones (vista previa + confirmar) · v72: PDF de situación de pista con una sola tabla de tramos · v71: situación de pista › estados nuevos del catálogo con id propio (no se pisan ni se borran entre sí) · v70: Gantt sin barras encimadas al cambiar de obra desde otra pestaña · v69: Recursos humanos (rrhh/, SQL 72) en el menú de apps y rol rrhh en Administración · v68: letras 20 % más grandes en el celular (--fs) · v67: flechas ‹ › en las pestañas, historial de producción a pantalla completa · v66: producción › historial con filtros (fecha, ítem, estado, texto) y orden por fecha · v65: licitaciones › antecedentes de obra (SQL 51) · v64: tablas de saldos y avance ordenables · v63: avance › saldos de obra (ítems y recursos pendientes) · v62: costos › hoja Gastos Generales por obra (SQL 50), APU formato MOPC, ítems por número · v61: compras › necesidad sin doble conteo de in situ + tabla dinámica · v60: vuelve el botón ✨ de la IA (el tractor queda solo en equipos) · v58: cronograma por semana + foto del plan semanal (SQL 44) · v57: compras sin pisar a otros · v56: rendimiento (obras grandes, compras) · v55: KPIs de gestión de compras · v54: compras sin aprobación + KPIs · v53b: flete rápido (SQL 35c) · v53: tarifas de flete en Transporte · v52: licitaciones privadas · v51: pestaña Licitaciones (radar/) · v50: app unificada (equipos/ tiene su propio SW y su caché equipos-*)

// Núcleo mínimo que se precachea en la instalación (sin ?v=, son estables).
// Los .js versionados se cachean solos al primer uso (stale-while-revalidate).
var CORE = [
  './',
  './index.html',
  './manifest.json',
  // Licitaciones (radar/): mismas URL ?v= que usan index.html y radar/index.html
  './radar/index.html?v=20261020a', './radar/app.js?v=20261020a', './radar/app.css?v=20261012b',
  './radar/antecedentes.js?v=20261020a', './radar/antecedentes.css?v=20261020a', './visor.js?v=20261109b', './usuarios.js?v=20261113d', './permisos_app.js?v=20261113d',
  './radar/domain.js?v=20261012b', './radar/participations.js?v=20261012b', './radar/config.js?v=20261012b',
  './radar/theme.css?v=20261012b', './radar-bridge.js?v=20261012b',
  './icon192.png',
  './icon512.png',
  './icon-maskable-512.png',
  './supabase.min.js?v=2.45.4'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (c) {
        // addAll falla entero si un recurso 404ea; lo hacemos tolerante.
        return Promise.all(CORE.map(function (u) {
          return c.add(u).catch(function () { /* ignora faltantes */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE_VERSION && k.indexOf('obra-shell-') === 0) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// permite forzar la activación del SW nuevo desde la app (botón "actualizar")
self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // 1) Sólo GET pasa por caché. POST (API) → red directa, sin tocar.
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  // 2) Cross-origin (Apps Script, Power BI, fuentes externas) → red directa.
  if (url.origin !== self.location.origin) return;

  // 3) Navegación / HTML → red primero, caché de respaldo (offline abre igual).
  var accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(req)
        .then(function (r) {
          var copy = r.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          return r;
        })
        .catch(function () {
          return caches.match(req).then(function (r) {
            return r || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 4) Resto same-origin (js/css/img) → stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req)
        .then(function (r) {
          if (r && r.status === 200 && r.type !== 'opaque') {
            var copy = r.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return r;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
