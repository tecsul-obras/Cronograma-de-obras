/* =========================================================================
 * photos.js — Fotos del libro diario
 *
 * Dos responsabilidades:
 *  1) compressImage(file): redimensiona/comprime una foto a JPEG liviano
 *     (respeta la orientación EXIF cuando el navegador lo permite).
 *  2) PhotoStore: cola de fotos PENDIENTES en IndexedDB. Las fotos pesan MB y
 *     no entran en localStorage; por eso cuando se guarda una jornada SIN
 *     conexión, las fotos se guardan acá y en la cola de texto solo van sus IDs.
 *     Al reconectar, offline.js las recupera, las manda al Apps Script (que las
 *     sube a Drive) y las borra de acá.
 *
 * Expone window.PhotoStore. Sin dependencias externas.
 * ========================================================================= */
(function (global) {
  'use strict';

  /* -------------------- compresión de imágenes -------------------- */
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.72;

    function draw(src, w, h) {
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d').drawImage(src, 0, 0, cw, ch);
      var dataUrl = canvas.toDataURL('image/jpeg', quality);
      return {
        name: file.name || 'foto.jpg',
        mime: 'image/jpeg',
        dataUrl: dataUrl,
        dataBase64: dataUrl.split(',')[1]
      };
    }

    function viaImg() {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try { var r = draw(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); resolve(r); }
          catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
        img.src = url;
      });
    }

    // createImageBitmap respeta la orientación EXIF (fotos verticales del celular)
    if (global.createImageBitmap) {
      try {
        return createImageBitmap(file, { imageOrientation: 'from-image' })
          .then(function (bm) { var r = draw(bm, bm.width, bm.height); if (bm.close) bm.close(); return r; })
          .catch(function () { return viaImg(); });
      } catch (e) { return viaImg(); }
    }
    return viaImg();
  }

  /* -------------------- IndexedDB (fotos pendientes) -------------------- */
  var DB_NAME = 'obra_media', STORE = 'fotos', DB_VER = 1;

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function stash(fotos) {
    // guarda [{name,mime,dataBase64}] y devuelve sus ids
    var ids = [];
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, 'readwrite');
        var store = t.objectStore(STORE);
        (fotos || []).forEach(function (f) {
          var id = 'ph_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          ids.push(id);
          store.put({ id: id, name: f.name, mime: f.mime || 'image/jpeg', dataBase64: f.dataBase64, ts: Date.now() });
        });
        t.oncomplete = function () { resolve(ids); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function load(ids) {
    if (!ids || !ids.length) return Promise.resolve([]);
    return openDB().then(function (db) {
      return Promise.all(ids.map(function (id) {
        return new Promise(function (resolve) {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          req.onsuccess = function () {
            var r = req.result;
            resolve(r ? { name: r.name, mime: r.mime, dataBase64: r.dataBase64 } : null);
          };
          req.onerror = function () { resolve(null); };
        });
      })).then(function (arr) { return arr.filter(Boolean); });
    });
  }

  function remove(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, 'readwrite');
        var store = t.objectStore(STORE);
        ids.forEach(function (id) { store.delete(id); });
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { resolve(); };
      });
    });
  }

  function count() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
        req.onsuccess = function () { resolve(req.result || 0); };
        req.onerror = function () { resolve(0); };
      });
    }).catch(function () { return 0; });
  }

  global.PhotoStore = {
    compressImage: compressImage,
    stash: stash, load: load, remove: remove, count: count
  };

})(window);
