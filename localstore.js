/* =========================================================================
 * localstore.js — Bloque 5: IndexedDB como store primario (Local-First)
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * Apps Script tiene un piso fijo de ~750 ms por llamada, medido: `whoami`, que
 * casi no hace nada, tarda eso. `boot()` encadena whoami + listObras + getObra,
 * y getObra promedia 9,2 s. Son ~11 s de pantalla en blanco cada vez que se
 * abre la app, y contra ese piso no se optimiza: no depende de cuántas filas
 * haya, sino de cuántas veces se cruza la red.
 *
 * La salida no es hacer las llamadas más rápidas. Es no esperarlas.
 *
 * CÓMO FUNCIONA
 * -------------
 *  · LECTURA (stale-while-revalidate): al abrir, la app pinta al instante el
 *    último snapshot guardado en IndexedDB. En paralelo pide al servidor; si
 *    hay algo nuevo, refresca. El usuario ve sus datos en ~50 ms.
 *
 *  · ESCRITURA (local-first): al guardar, primero se escribe el snapshot local
 *    (~5 ms) y el envío al servidor se encola. La UI dice "Guardado" enseguida
 *    porque el dato YA está a salvo en el dispositivo. Si el envío falla, es un
 *    reintento silencioso, no un cartel de error.
 *
 * QUÉ NO HACE
 * -----------
 * No resuelve conflictos entre dos personas editando la misma obra. La fuente
 * de verdad sigue siendo la planilla; esto es una caché con cola de salida.
 * Para conflictos de verdad hace falta versionado por ítem, y eso es otra
 * conversación.
 *
 * Sin dependencias externas: IndexedDB directo. Dexie agregaría un CDN más que
 * puede fallar justo cuando el usuario no tiene señal, que es cuando esto tiene
 * que funcionar.
 *
 * Expone window.LocalStore.
 * ========================================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'obra_local_v1';
  var DB_VER = 1;
  var ST_OBRAS = 'obras';     // snapshot de OBRA_DATA por obra_id
  var ST_META = 'meta';       // whoami, listObras, marcas varias
  var ST_COLA = 'cola';       // cola de sincronización saliente

  var _db = null;
  var _abierto = null;

  /* -------------------- apertura -------------------- */
  function abrir() {
    if (_abierto) return _abierto;
    _abierto = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(ST_OBRAS)) db.createObjectStore(ST_OBRAS, { keyPath: 'obra_id' });
        if (!db.objectStoreNames.contains(ST_META))  db.createObjectStore(ST_META,  { keyPath: 'k' });
        if (!db.objectStoreNames.contains(ST_COLA))  db.createObjectStore(ST_COLA,  { keyPath: 'id' });
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error || new Error('No se pudo abrir IndexedDB')); };
    });
    return _abierto;
  }

  function tx(store, modo, fn) {
    return abrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, modo);
        var s = t.objectStore(store);
        var out;
        try { out = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && out.__req ? out.__req.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('transacción abortada')); };
      });
    });
  }
  function pedido(req) { return { __req: req }; }

  /* Sin persist(), el navegador puede desalojar IndexedDB cuando le falta
     espacio — justo lo que no queremos si ahí vive trabajo sin sincronizar. */
  function pedirPersistencia() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then(function (ya) {
          return ya ? true : navigator.storage.persist();
        }).catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }

  /* -------------------- snapshots de obra -------------------- */
  function guardarObra(obraId, data) {
    if (!obraId || !data) return Promise.resolve(false);
    return tx(ST_OBRAS, 'readwrite', function (s) {
      s.put({ obra_id: String(obraId), data: data, ts: Date.now() });
    }).then(function () { return true; })
      .catch(function () { return false; });   // la caché nunca rompe la app
  }

  function leerObra(obraId) {
    if (!obraId) return Promise.resolve(null);
    return tx(ST_OBRAS, 'readonly', function (s) {
      return pedido(s.get(String(obraId)));
    }).then(function (r) { return r || null; })
      .catch(function () { return null; });
  }

  function borrarObra(obraId) {
    return tx(ST_OBRAS, 'readwrite', function (s) { s.delete(String(obraId)); })
      .catch(function () { return false; });
  }

  /* -------------------- metadatos -------------------- */
  function setMeta(k, v) {
    return tx(ST_META, 'readwrite', function (s) { s.put({ k: k, v: v, ts: Date.now() }); })
      .catch(function () { return false; });
  }
  function getMeta(k) {
    return tx(ST_META, 'readonly', function (s) { return pedido(s.get(k)); })
      .then(function (r) { return r ? r.v : null; })
      .catch(function () { return null; });
  }

  /* -------------------- cola de sincronización --------------------
     Un trabajo = { id, tipo, obraId, payload, ts, intentos, error }
     `tipo` mapea a un método de ObraAPI (ver enviarUno).
     La cola vive en IndexedDB, así que sobrevive a cerrar el navegador. */
  var listeners = [];
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function avisar() {
    contar().then(function (n) {
      listeners.forEach(function (fn) { try { fn(n); } catch (e) {} });
    });
  }

  function encolar(tipo, obraId, payload, claveDedup) {
    var job = {
      id: 'j_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      tipo: tipo, obraId: String(obraId || ''), payload: payload,
      ts: Date.now(), intentos: 0,
      // dedup: si ya hay un trabajo pendiente del mismo tipo para la misma
      // obra, el nuevo lo REEMPLAZA. Guardar 10 veces en un minuto no debe
      // generar 10 envíos del mismo estado completo.
      dedup: claveDedup || (tipo + '|' + obraId)
    };
    return listar().then(function (jobs) {
      var viejos = jobs.filter(function (j) { return j.dedup === job.dedup && !j.error; });
      return tx(ST_COLA, 'readwrite', function (s) {
        viejos.forEach(function (j) { s.delete(j.id); });
        s.put(job);
      });
    }).then(function () { avisar(); return job; })
      .catch(function () { return null; });
  }

  function listar() {
    return tx(ST_COLA, 'readonly', function (s) { return pedido(s.getAll()); })
      .then(function (r) {
        return (r || []).sort(function (a, b) { return a.ts - b.ts; });
      })
      .catch(function () { return []; });
  }
  function contar() { return listar().then(function (l) { return l.length; }); }
  function pendientes() {
    return listar().then(function (l) { return l.filter(function (j) { return !j.error; }); });
  }
  function quitar(id) {
    return tx(ST_COLA, 'readwrite', function (s) { s.delete(id); })
      .then(function () { avisar(); })
      .catch(function () {});
  }
  function marcarError(id, msg) {
    return tx(ST_COLA, 'readwrite', function (s) { return pedido(s.get(id)); })
      .then(function (j) {
        if (!j) return;
        j.error = String(msg || 'error').slice(0, 300);
        j.intentos = (j.intentos || 0) + 1;
        return tx(ST_COLA, 'readwrite', function (s2) { s2.put(j); });
      })
      .then(function () { avisar(); })
      .catch(function () {});
  }
  function reintentar(id) {
    return listar().then(function (jobs) {
      var tocar = jobs.filter(function (j) { return (id == null || j.id === id) && j.error; });
      if (!tocar.length) return;
      return tx(ST_COLA, 'readwrite', function (s) {
        tocar.forEach(function (j) { delete j.error; j.intentos = 0; s.put(j); });
      });
    }).then(function () { avisar(); return sincronizar(); });
  }
  function vaciar() {
    return tx(ST_COLA, 'readwrite', function (s) { s.clear(); })
      .then(function () { avisar(); })
      .catch(function () {});
  }

  /* -------------------- envío -------------------- */
  function esErrorDeRed(err) {
    if (global.navigator && global.navigator.onLine === false) return true;
    var m = (err && err.message) || '';
    return /fetch|network|failed to fetch|load failed|networkerror|timeout/i.test(m);
  }

  function enviarUno(job) {
    var API = global.ObraAPI;
    if (!API) return Promise.reject(new Error('API no lista'));
    var p = job.payload || {};
    switch (job.tipo) {
      case 'saveItems':      return API.saveItemsParcial(p);
      case 'saveWeekly':     return API.saveWeekly(p.rows, p.deleted);
      case 'saveCategorias': return API.saveCategorias(p.categorias);
      case 'saveConfig':     return API.saveConfig(p.config);
      default: return Promise.reject(new Error('tipo desconocido: ' + job.tipo));
    }
  }

  /* Vacía la cola en orden. Un error de RED corta y deja todo para después
     (reintento silencioso). Un error de NEGOCIO marca ese trabajo y sigue con
     el resto: ese sí hay que mostrárselo al usuario, porque no se arregla
     esperando. */
  var sincronizando = false;
  function sincronizar() {
    if (sincronizando) return Promise.resolve({ enviados: 0, ocupado: true });
    if (global.navigator && global.navigator.onLine === false)
      return Promise.resolve({ enviados: 0, sinRed: true });
    if (!global.ObraAPI) return Promise.resolve({ enviados: 0 });

    sincronizando = true;
    var enviados = 0, fallados = 0;

    function paso() {
      return pendientes().then(function (l) {
        if (!l.length) return { enviados: enviados, fallados: fallados };
        var job = l[0];
        return enviarUno(job)
          .then(function () {
            enviados++;
            return quitar(job.id).then(paso);
          })
          .catch(function (err) {
            if (esErrorDeRed(err)) {
              // sin red: se queda en la cola, se reintenta solo más tarde
              return { enviados: enviados, fallados: fallados, sinRed: true };
            }
            fallados++;
            return marcarError(job.id, err && err.message).then(paso);
          });
      });
    }

    return paso().then(function (r) {
      sincronizando = false; avisar(); return r;
    }).catch(function (e) {
      sincronizando = false; avisar();
      return { enviados: enviados, fallados: fallados, error: String(e) };
    });
  }

  /* -------------------- arranque -------------------- */
  pedirPersistencia();
  global.addEventListener('online', function () { sincronizar(); });
  // red de seguridad: cada 30 s por si un envío quedó colgado
  setInterval(function () {
    if (global.navigator && global.navigator.onLine) {
      contar().then(function (n) { if (n) sincronizar(); });
    }
  }, 30000);
  // último intento al cerrar la pestaña (best-effort, puede no llegar)
  global.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sincronizar();
  });

  global.LocalStore = {
    listo: abrir,
    guardarObra: guardarObra,
    leerObra: leerObra,
    borrarObra: borrarObra,
    setMeta: setMeta,
    getMeta: getMeta,
    encolar: encolar,
    listar: listar,
    contar: contar,
    pendientes: pendientes,
    quitar: quitar,
    reintentar: reintentar,
    vaciar: vaciar,
    sincronizar: sincronizar,
    onChange: onChange,
    _esErrorDeRed: esErrorDeRed
  };

})(window);
