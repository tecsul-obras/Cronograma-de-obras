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

var CACHE_VERSION = 'obra-shell-v56-rendimiento';   // v56: rendimiento (obras grandes, compras) · v55: KPIs de gestión de compras · v54: compras sin aprobación + KPIs · v53b: flete rápido (SQL 35c) · v53: tarifas de flete en Transporte · v52: licitaciones privadas · v51: pestaña Licitaciones (radar/) · v50: app unificada (equipos/ tiene su propio SW y su caché equipos-*)

// Núcleo mínimo que se precachea en la instalación (sin ?v=, son estables).
// Los .js versionados se cachean solos al primer uso (stale-while-revalidate).
var CORE = [
  './',
  './index.html',
  './manifest.json',
  // Licitaciones (radar/): mismas URL ?v= que usan index.html y radar/index.html
  './radar/index.html?v=20261012b', './radar/app.js?v=20261012b', './radar/app.css?v=20261012b',
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
