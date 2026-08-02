/* =========================================================================
 * offline.js — Cola de sincronización ("outbox") para trabajar sin conexión
 *
 * Si el usuario guarda una jornada de producción sin señal, en vez de fallar
 * se guarda LOCAL (localStorage) en una cola. Cuando vuelve la conexión, la
 * cola se vacía sola enviando cada jornada al Apps Script, en orden.
 *
 * Guarda en localStorage (payloads chicos, se vacían seguido). A futuro, para
 * el producto SaaS, esto puede migrar a IndexedDB/Dexie sin cambiar la API.
 *
 * Depende de: ObraAPI (api.js) — usa ObraAPI._rawProdGuardar para reenviar sin
 * volver a encolar. Expone window.Outbox.
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'obra_outbox_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  function add(rec) {
    var l = load();
    rec.id = rec.id || ('ob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    rec.ts = rec.ts || Date.now();
    l.push(rec);
    save(l);
    notify();
    return rec;
  }
  function all() { return load(); }
  function count() { return load().length; }
  function forObra(obraId) {
    return load().filter(function (x) { return String(x.obraId) === String(obraId); });
  }
  function remove(id) {
    save(load().filter(function (x) { return x.id !== id; }));
    notify();
  }
  function clear() { save([]); notify(); }
  // limpia la marca de error de un registro (o de todos) y reintenta el envío
  function retry(id) {
    var l = load(), found = false;
    for (var k = 0; k < l.length; k++) {
      if (id == null || l[k].id === id) { delete l[k].error; found = true; }
    }
    if (found) { save(l); notify(); }
    return flush();
  }

  /* ---- suscriptores (para refrescar el chip de "pendientes") ---- */
  var listeners = [];
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function notify() {
    var n = count();
    listeners.forEach(function (fn) { try { fn(n); } catch (e) {} });
  }

  function isNetErr(err) {
    if (!global.navigator || global.navigator.onLine === false) return true;
    var m = (err && err.message) || '';
    return /fetch|network|failed to fetch|load failed|networkerror/i.test(m);
  }

  /* ---- envío de un registro según su acción ---- */
  function sendOne(rec) {
    if (!global.ObraAPI || !global.ObraAPI._rawProdGuardar) return Promise.reject(new Error('API no lista'));
    if (rec.action !== 'prodGuardar') return Promise.reject(new Error('acción desconocida: ' + rec.action));
    var payload = rec.payload || {};
    var ids = payload.fotos_ids;
    // rehidratar fotos desde IndexedDB antes de mandarlas al Apps Script (que las sube a Drive)
    if (ids && ids.length && global.PhotoStore) {
      return global.PhotoStore.load(ids).then(function (fotos) {
        var full = {}; for (var k in payload) if (k !== 'fotos_ids') full[k] = payload[k];
        full.fotos = fotos;
        return global.ObraAPI._rawProdGuardar(full, rec.obraId).then(function (res) {
          global.PhotoStore.remove(ids);   // ya subidas → limpiar IndexedDB
          return res;
        });
      });
    }
    return global.ObraAPI._rawProdGuardar(payload, rec.obraId);
  }

  /* ---- vaciar la cola: envía una por una, en orden ---- */
  var flushing = false;
  function flush() {
    if (flushing) return Promise.resolve({ sent: 0, failed: 0, busy: true });
    if (!global.navigator || global.navigator.onLine === false)
      return Promise.resolve({ sent: 0, failed: 0, offline: true });
    // sin sesión no intentamos (evita ráfaga de auth_required)
    if (!global.ObraAPI || !global.ObraAPI.hasToken || !global.ObraAPI.hasToken())
      return Promise.resolve({ sent: 0, failed: 0, noauth: true });

    var list = load();
    if (!list.length) return Promise.resolve({ sent: 0, failed: 0 });

    flushing = true;
    var sent = 0, failed = 0;

    function step(i) {
      var cur = load();
      if (i >= cur.length) { flushing = false; notify(); return { sent: sent, failed: failed }; }
      var rec = cur[i];
      // si ya fue marcado como error de negocio, saltarlo (se muestra al usuario)
      if (rec.error) return step(i + 1);

      return sendOne(rec)
        .then(function () {
          sent++;
          remove(rec.id);
          notify();
          return step(i); // no incrementamos i: la lista se acortó
        })
        .catch(function (err) {
          if (isNetErr(err)) {
            // volvió a caerse la red: paramos y reintentamos después
            flushing = false; notify();
            return { sent: sent, failed: failed, offline: true };
          }
          // error de negocio (validación del servidor): marcar y continuar
          failed++;
          var l2 = load();
          for (var k = 0; k < l2.length; k++) {
            if (l2[k].id === rec.id) { l2[k].error = (err && err.message) || 'error'; break; }
          }
          save(l2); notify();
          return step(i + 1);
        });
    }

    return Promise.resolve(step(0)).then(function (res) {
      flushing = false;
      return res;
    });
  }

  global.Outbox = {
    add: add, all: all, count: count, forObra: forObra,
    remove: remove, clear: clear, retry: retry, flush: flush, onChange: onChange
  };

  /* ---- auto-flush: al reconectar y cada 45s como red de seguridad ---- */
  global.addEventListener('online', function () { flush(); });
  setInterval(function () {
    if (global.navigator && global.navigator.onLine && count()) flush();
  }, 45000);

})(window);
