/* ══════════════════════════════════════════════════════════════════
 * FOTOS A DRIVE — Apps Script (Tecsul S.A.E.) · SQL 112 · v20261113
 *
 * Copia las fotos de JotForm y de la app (Storage de Supabase) a la
 * unidad compartida «Fotos Tecsul», achicadas a 1600 px, y cambia el
 * link en la base. Trabaja de a lotes, cada 5 minutos, hasta vaciar la
 * cola (tabla fotos_drive). Se puede cortar y volver a arrancar: lo que
 * quedó a medias vuelve a la cola solo.
 *
 * Cómo se achica: Apps Script no sabe redimensionar imágenes. Se sube el
 * original a la carpeta «_temporal», Drive arma su miniatura, se baja la
 * miniatura de 1600 px y esa es la que queda; el original se borra.
 * Fotos chicas (menos de 400 KB) y las firmas (PNG) quedan como están.
 *
 * Retención: las fotos de registros con más de un año se borran de Drive
 * y de Supabase, y en la base queda «vencida» (la app muestra «Foto
 * vencida»). Las de JotForm que ya no existen las marca la base sola.
 *
 * Instalar (una sola vez):
 *   1. script.google.com › Nuevo proyecto «Fotos a Drive» (con tu cuenta
 *      @tecsul.com.py, miembro Administrador de la unidad compartida).
 *   2. Pegar este archivo. En ⚙ Configuración del proyecto tildar
 *      «Mostrar el archivo de manifiesto» y pegar appsscript.json.
 *   3. ⚙ Propiedades del script:
 *        SUPABASE_URL          https://sququxlqcrbsoqvmycfa.supabase.co
 *        SUPABASE_SERVICE_KEY  (Supabase › Project Settings › API › service_role)
 *        DRIVE_ID              ID de la unidad compartida «Fotos Tecsul»
 *        JOTFORM_API_KEY       (opcional) si JotForm pide login para ver archivos
 *   4. Ejecutar «probar» (autorizar los permisos). Copia 5 fotos y muestra
 *      el resultado en el registro.
 *   5. Ejecutar «instalar»: arma el disparador cada 5 minutos.
 *   «avance» muestra cuánto falta. «detener» saca el disparador.
 * ══════════════════════════════════════════════════════════════════ */

var LOTE = 10;                       // fotos nuevas por tanda (30 × 3 MB de JotForm era demasiado para una tanda)
var TIEMPO_MAX = 4.6 * 60 * 1000;    // Apps Script corta a los 6 min
var ACHICAR_DESDE = 400 * 1024;      // JPEG más grandes que esto se achican
var LADO = 1600;                     // lado mayor de la foto final
var ESPERA_MINIATURA = 30 * 60 * 1000;   // si Drive no armó la miniatura en 30 min, queda el original

var P = PropertiesService.getScriptProperties();
var DRIVE = 'https://www.googleapis.com/drive/v3/files';
var SUBIR = 'https://www.googleapis.com/upload/drive/v3/files';

function cfg_(k, oblig) {
  var v = (P.getProperty(k) || '').trim();
  if (!v && oblig) throw new Error('Falta la propiedad del script ' + k);
  return v;
}
function tokenG_() { return ScriptApp.getOAuthToken(); }
function hG_() { return { Authorization: 'Bearer ' + tokenG_() }; }
function hS_() { var k = cfg_('SUPABASE_SERVICE_KEY', true); return { apikey: k, Authorization: 'Bearer ' + k }; }

// ── Supabase ─────────────────────────────────────────────────────────
function rpc_(fn, args) {
  var r = UrlFetchApp.fetch(cfg_('SUPABASE_URL', true) + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', headers: hS_(),
    payload: JSON.stringify(args || {}), muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error(fn + ': ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
  var t = r.getContentText();
  return t ? JSON.parse(t) : null;
}

// ── Carpetas de la unidad compartida (se recuerdan) ──────────────────
function carpeta_(ruta) {
  var k = 'carpeta:' + ruta, id = P.getProperty(k);
  if (id) return id;
  var padre = cfg_('DRIVE_ID', true), partes = ruta.split('/'), acum = '';
  for (var i = 0; i < partes.length; i++) {
    acum = acum ? acum + '/' + partes[i] : partes[i];
    var ya = P.getProperty('carpeta:' + acum);
    if (ya) { padre = ya; continue; }
    padre = buscarOCrear_(partes[i], padre);
    P.setProperty('carpeta:' + acum, padre);
  }
  return padre;
}
function buscarOCrear_(nombre, padre) {
  var q = "name = '" + nombre.replace(/'/g, "\\'") + "' and '" + padre + "' in parents and " +
          "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  var u = DRIVE + '?q=' + encodeURIComponent(q) + '&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true' +
          '&corpora=drive&driveId=' + cfg_('DRIVE_ID', true);
  var r = JSON.parse(UrlFetchApp.fetch(u, { headers: hG_() }).getContentText());
  if (r.files && r.files.length) return r.files[0].id;
  var c = UrlFetchApp.fetch(DRIVE + '?supportsAllDrives=true&fields=id', {
    method: 'post', contentType: 'application/json', headers: hG_(),
    payload: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [padre] })
  });
  return JSON.parse(c.getContentText()).id;
}

// ── Subida a Drive en paralelo (subida «resumable»: sin armar bytes a mano) ─
// items: [{nombre, carpeta(id), blob}] → [{id, size} | {error}]
function subir_(items) {
  if (!items.length) return [];
  var sesiones = UrlFetchApp.fetchAll(items.map(function (x) {
    return {
      url: SUBIR + '?uploadType=resumable&supportsAllDrives=true', method: 'post',
      contentType: 'application/json; charset=UTF-8', headers: hG_(), muteHttpExceptions: true,
      payload: JSON.stringify({ name: x.nombre, parents: [x.carpeta], mimeType: x.blob.getContentType() })
    };
  }));
  var pedidos = [], idx = [];
  sesiones.forEach(function (s, i) {
    var loc = s.getHeaders().Location || s.getHeaders().location;
    if (s.getResponseCode() < 300 && loc) {
      pedidos.push({ url: loc + '&fields=id,size', method: 'put', contentType: items[i].blob.getContentType(),
                     payload: items[i].blob.getBytes(), muteHttpExceptions: true });
      idx.push(i);
    }
  });
  var out = items.map(function (x, i) { return { error: 'No se pudo abrir la subida (' + sesiones[i].getResponseCode() + ')' }; });
  UrlFetchApp.fetchAll(pedidos).forEach(function (r, j) {
    var i = idx[j];
    if (r.getResponseCode() < 300) { var d = JSON.parse(r.getContentText()); out[i] = { id: d.id, size: Number(d.size || 0) || pedidos[j].payload.length }; }
    else out[i] = { error: 'Drive ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 150) };
  });
  return out;
}

// A la papelera de la unidad (Drive la vacía sola a los 30 días)
function borrarDrive_(ids) {
  if (!ids.length) return;
  UrlFetchApp.fetchAll(ids.map(function (id) {
    return { url: DRIVE + '/' + id + '?supportsAllDrives=true&fields=id', method: 'patch', contentType: 'application/json',
             payload: JSON.stringify({ trashed: true }), headers: hG_(), muteHttpExceptions: true };
  }));
}

// ── Bajar del origen ─────────────────────────────────────────────────
function pedidoOrigen_(f, conClave) {
  if (f.fuente === 'jotform') {
    var u = f.origen, k = cfg_('JOTFORM_API_KEY');
    if (conClave && k) u += (u.indexOf('?') < 0 ? '?' : '&') + 'apiKey=' + encodeURIComponent(k);
    return { url: u, muteHttpExceptions: true, followRedirects: true };
  }
  if (f.fuente === 'storage') {
    return { url: cfg_('SUPABASE_URL', true) + '/storage/v1/object/' + f.bucket + '/' + f.ruta.split('/').map(encodeURIComponent).join('/'),
             headers: hS_(), muteHttpExceptions: true };
  }
  var m = /\/d\/([\w-]+)/.exec(f.origen) || /[?&]id=([\w-]+)/.exec(f.origen);   // Drive viejo (privado)
  return { url: DRIVE + '/' + (m ? m[1] : 'x') + '?alt=media&supportsAllDrives=true', headers: hG_(), muteHttpExceptions: true };
}
function esImagen_(r) {
  var t = String(r.getHeaders()['Content-Type'] || r.getHeaders()['content-type'] || '');
  return r.getResponseCode() < 300 && !/text\/html|application\/json/i.test(t);
}
// El tipo por los primeros bytes: JotForm manda las fotos como
// «application/octet-stream» y así no se achicaban.
function tipoReal_(bs, dicho) {
  var h = function (i) { return (bs[i] + 256) % 256; };
  if (bs.length > 3 && h(0) === 0xFF && h(1) === 0xD8) return 'image/jpeg';
  if (bs.length > 3 && h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4E && h(3) === 0x47) return 'image/png';
  if (bs.length > 4 && h(0) === 0x25 && h(1) === 0x50 && h(2) === 0x44 && h(3) === 0x46) return 'application/pdf';
  if (bs.length > 12 && h(8) === 0x57 && h(9) === 0x45 && h(10) === 0x42 && h(11) === 0x50) return 'image/webp';
  if (bs.length > 12 && String.fromCharCode(h(4), h(5), h(6), h(7)) === 'ftyp' &&
      /hei|mif|hev/.test(String.fromCharCode(h(8), h(9), h(10), h(11)))) return 'image/heic';
  return dicho && !/octet-stream/i.test(dicho) ? dicho : 'image/jpeg';
}
function bajar_(lote) {
  var rs = UrlFetchApp.fetchAll(lote.map(function (f) { return pedidoOrigen_(f, false); }));
  // JotForm con «pedir login para ver archivos»: se reintenta con la clave
  var re = [];
  rs.forEach(function (r, i) { if (lote[i].fuente === 'jotform' && !esImagen_(r) && cfg_('JOTFORM_API_KEY')) re.push(i); });
  if (re.length) {
    UrlFetchApp.fetchAll(re.map(function (i) { return pedidoOrigen_(lote[i], true); }))
      .forEach(function (r, j) { rs[re[j]] = r; });
  }
  return rs;
}

// ── Una vuelta ───────────────────────────────────────────────────────
function procesar() {
  var cand = LockService.getScriptLock();
  if (!cand.tryLock(2000)) return;          // otra vuelta sigue corriendo
  var t0 = Date.now(), tot = { nuevas: 0, achicadas: 0, listas: 0, errores: 0, vencidas: 0 };
  try {
    while (Date.now() - t0 < TIEMPO_MAX / 3 && vencer_(tot)) {}
    var tanda = 60 * 1000;                  // cuánto tardó la última tanda (arranca suponiendo 1 min)
    while (Date.now() - t0 < TIEMPO_MAX) {
      var a = terminarSubidas_(tot);
      // no empezar una tanda que no alcance a terminar: si Apps Script corta
      // a los 6 min, las fotos tomadas quedan trabadas 20 min y lo subido se pierde
      if (Date.now() - t0 + 1.5 * tanda > TIEMPO_MAX) break;
      var t1 = Date.now(), b = loteSeguro_(tot);
      tanda = Math.max(20 * 1000, Date.now() - t1);
      if (!a && !b) break;                  // no queda nada
    }
  } catch (e) {
    console.error('Vuelta cortada: ' + (e && e.message || e));
    throw e;
  } finally {
    cand.releaseLock();
    console.log(JSON.stringify(tot) + ' en ' + Math.round((Date.now() - t0) / 1000) + ' s');
  }
  return tot;
}

// Si una tanda falla (cupo de Google, JotForm que no responde…), las
// fotos vuelven a la cola enseguida en vez de quedar trabadas 20 min.
function loteSeguro_(tot) {
  var tomadas = [];
  try { return loteNuevo_(tot, tomadas); }
  catch (e) {
    var msg = String(e && e.message || e).slice(0, 300);
    console.error('Tanda con error: ' + msg);
    if (tomadas.length) {
      try { rpc_('fotos_drive_error', { p: tomadas.map(function (f) { return { id: f.id, error: 'Tanda: ' + msg }; }) }); } catch (e2) {}
      tot.errores += tomadas.length;
    }
    if (/cuota|quota|too many times|demasiadas veces|Bandwidth|ancho de banda/i.test(msg)) throw e;   // cupo del día: parar
    return tomadas.length;
  }
}

// Fotos nuevas: bajar, subir (directo o a _temporal para achicar)
function loteNuevo_(tot, tomadas) {
  var lote = rpc_('fotos_drive_tomar', { p_limite: LOTE }) || [];
  if (!lote.length) return 0;
  if (tomadas) Array.prototype.push.apply(tomadas, lote);
  var rs = bajar_(lote), errores = [], directas = [], grandes = [];
  lote.forEach(function (f, i) {
    var r = rs[i], cod = r.getResponseCode();
    if (!esImagen_(r)) {
      var txt = r.getContentText().slice(0, 120);
      errores.push({ id: f.id, descartar: cod === 404 || cod === 410 || (cod === 400 && /not found|no existe/i.test(txt)),
                     error: (f.fuente === 'jotform' && cod < 300 ? 'JotForm pide login (cargá JOTFORM_API_KEY) · ' : '') + cod + ' ' + txt });
      return;
    }
    var blob = r.getBlob(), bs = blob.getBytes(), bytes = bs.length, tipo = tipoReal_(bs, blob.getContentType());
    blob.setContentType(tipo);
    var ext = /png/i.test(tipo) ? '.png' : /pdf/i.test(tipo) ? '.pdf' : /heic|heif/i.test(tipo) ? '.heic' : '.jpg';
    var x = { f: f, bytes: bytes, blob: blob.setName(f.nombre + ext) };
    if (/jpe?g|heic|heif|webp/i.test(tipo) && bytes > ACHICAR_DESDE) grandes.push(x); else directas.push(x);
  });
  tot.errores += errores.length;
  if (errores.length) rpc_('fotos_drive_error', { p: errores });

  // chicas: quedan como están
  var subD = subir_(directas.map(function (x) { return { nombre: x.blob.getName(), carpeta: carpeta_(x.f.carpeta), blob: x.blob }; }));
  var listas = [], err2 = [];
  subD.forEach(function (s, i) {
    var x = directas[i];
    if (s.id) listas.push({ id: x.f.id, drive_id: s.id, bytes: s.size || x.bytes, bytes_origen: x.bytes });
    else err2.push({ id: x.f.id, error: s.error });
  });
  // grandes: a _temporal hasta que Drive arme la miniatura
  var tmp = carpeta_('_temporal');
  var subG = subir_(grandes.map(function (x) { return { nombre: x.blob.getName(), carpeta: tmp, blob: x.blob }; }));
  var subidas = [];
  subG.forEach(function (s, i) {
    var x = grandes[i];
    if (s.id) subidas.push({ id: x.f.id, tmp_id: s.id, bytes: x.bytes });
    else err2.push({ id: x.f.id, error: s.error });
  });
  if (subidas.length) rpc_('fotos_drive_subida', { p: subidas });
  if (err2.length) { rpc_('fotos_drive_error', { p: err2 }); tot.errores += err2.length; }
  marcarListas_(listas, tot);
  tot.nuevas += lote.length;
  return lote.length;
}

// Originales en _temporal: bajar la miniatura de 1600 px y dejar esa
function terminarSubidas_(tot) {
  var l = rpc_('fotos_drive_subidas', { p_limite: 60 }) || [];
  if (!l.length) return 0;
  var metas = UrlFetchApp.fetchAll(l.map(function (f) {
    return { url: DRIVE + '/' + f.drive_tmp_id + '?fields=thumbnailLink,name,createdTime&supportsAllDrives=true',
             headers: hG_(), muteHttpExceptions: true };
  }));
  var conMini = [], sinMini = [], perdidas = [];
  metas.forEach(function (m, i) {
    if (m.getResponseCode() === 404) { perdidas.push({ id: l[i].id, error: 'el original de _temporal no está' }); return; }
    var j = m.getResponseCode() < 300 ? JSON.parse(m.getContentText()) : {};
    if (j.thumbnailLink) conMini.push({ f: l[i], link: j.thumbnailLink.replace(/=s\d+[^/]*$/, '=s' + LADO), nombre: j.name });
    else if (j.createdTime && Date.now() - new Date(j.createdTime).getTime() > ESPERA_MINIATURA) sinMini.push({ f: l[i], nombre: j.name });
  });
  if (perdidas.length) { rpc_('fotos_drive_error', { p: perdidas }); tot.errores += perdidas.length; }   // vuelve a la cola

  var minis = UrlFetchApp.fetchAll(conMini.map(function (x) { return { url: x.link, headers: hG_(), muteHttpExceptions: true }; }));
  // por las dudas: si con el token no la da, se pide el link solo (es un link temporal)
  var re = [];
  minis.forEach(function (r, i) { if (!esImagen_(r)) re.push(i); });
  if (re.length) UrlFetchApp.fetchAll(re.map(function (i) { return { url: conMini[i].link, muteHttpExceptions: true }; }))
    .forEach(function (r, j) { minis[re[j]] = r; });
  var aSubir = [];
  minis.forEach(function (r, i) {
    var x = conMini[i];
    if (esImagen_(r)) aSubir.push({ x: x, blob: r.getBlob().setName(x.nombre.replace(/\.[^.]+$/, '') + '.jpg') });
    // si no, se reintenta en la próxima vuelta
  });
  var subidas = subir_(aSubir.map(function (s) { return { nombre: s.blob.getName(), carpeta: carpeta_(s.x.f.carpeta), blob: s.blob }; }));
  var listas = [], borrar = [];
  subidas.forEach(function (s, i) {
    var f = aSubir[i].x.f;
    if (s.id) { listas.push({ id: f.id, drive_id: s.id, bytes: s.size, bytes_origen: f.bytes_origen }); borrar.push(f.drive_tmp_id); }
  });
  // Drive no armó la miniatura (formato raro): se mueve el original a su carpeta
  sinMini.forEach(function (x) {
    var r = UrlFetchApp.fetch(DRIVE + '/' + x.f.drive_tmp_id + '?supportsAllDrives=true&fields=id&addParents=' +
                              carpeta_(x.f.carpeta) + '&removeParents=' + carpeta_('_temporal'),
                              { method: 'patch', contentType: 'application/json', payload: '{}', headers: hG_(), muteHttpExceptions: true });
    if (r.getResponseCode() < 300) listas.push({ id: x.f.id, drive_id: x.f.drive_tmp_id, bytes: x.f.bytes_origen, bytes_origen: x.f.bytes_origen });
  });
  marcarListas_(listas, tot);
  borrarDrive_(borrar);
  tot.achicadas += borrar.length;
  return listas.length + perdidas.length;   // 0 = todas esperando la miniatura de Drive
}

// Más de un año: borrar de Drive y de Supabase; en la base queda «vencida»
function vencer_(tot) {
  var l = rpc_('fotos_drive_a_vencer', { p_limite: 100 }) || [];
  if (!l.length) return false;
  var ids = [];
  l.forEach(function (f) { if (f.drive_id) ids.push(f.drive_id); if (f.drive_tmp_id) ids.push(f.drive_tmp_id); });
  borrarDrive_(ids);                       // si ya no estaba (404), igual sigue
  borrarStorage_(l.filter(function (f) { return f.bucket && f.ruta; }));
  tot.vencidas += rpc_('fotos_drive_vencida', { p: l.map(function (f) { return f.id; }) }) || 0;
  return true;
}

function borrarStorage_(filas) {
  var porBucket = {};
  filas.forEach(function (r) { (porBucket[r.bucket] = porBucket[r.bucket] || []).push(r.ruta); });
  Object.keys(porBucket).forEach(function (b) {
    UrlFetchApp.fetch(cfg_('SUPABASE_URL', true) + '/storage/v1/object/' + b, {
      method: 'delete', contentType: 'application/json', headers: hS_(),
      payload: JSON.stringify({ prefixes: porBucket[b] }), muteHttpExceptions: true
    });
  });
}

// Avisar a la base (cambia los links) y borrar de Storage lo que ya pasó
function marcarListas_(listas, tot) {
  if (!listas.length) return;
  var res = rpc_('fotos_drive_lista', { p: listas }) || [];
  tot.listas += listas.length;
  borrarStorage_(res.filter(function (r) { return r.bucket && r.ruta; }));
}

// ── Para usar a mano ─────────────────────────────────────────────────
function probar() {
  var antes = LOTE; LOTE = 5;
  try {
    var tot = procesar();
    console.log('Prueba: ' + JSON.stringify(tot) + '. Las grandes quedan en _temporal hasta la próxima vuelta (miniatura de Drive).');
    avance();
  } finally { LOTE = antes; }
}

function instalar() {
  detener();
  ScriptApp.newTrigger('procesar').timeBased().everyMinutes(5).create();
  console.log('Listo: corre cada 5 minutos hasta vaciar la cola. Mirá «avance» cuando quieras.');
}

function detener() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procesar') ScriptApp.deleteTrigger(t);
  });
}

function encolarAhora() {
  console.log(JSON.stringify(rpc_('fotos_drive_encolar', {})));
}

function avance() {
  var r = UrlFetchApp.fetch(cfg_('SUPABASE_URL', true) + '/rest/v1/fotos_drive_avance?select=*', { headers: hS_(), muteHttpExceptions: true });
  var filas = JSON.parse(r.getContentText() || '[]');
  if (!Array.isArray(filas)) { console.log(r.getContentText()); return; }
  var t = { copiar: 0, listas: 0, en_cola: 0, con_error: 0, a_borrar: 0, vencidas: 0 };
  filas.forEach(function (f) {
    var copiar = f.total - f.vencidas - f.a_borrar;
    console.log(f.fuente + ' · ' + f.modulo + ': ' + f.listas + ' de ' + copiar + ' en Drive · cola ' + f.en_cola +
                ' · errores ' + f.con_error + ' · vencidas ' + f.vencidas + ' · por vencer ' + f.a_borrar +
                ' · ' + (f.gb_drive || 0) + ' GB en Drive (eran ' + (f.gb_origen || 0) + ' GB)');
    t.copiar += copiar; t.listas += f.listas; t.en_cola += f.en_cola; t.con_error += f.con_error;
    t.a_borrar += f.a_borrar; t.vencidas += f.vencidas;
  });
  console.log('TOTAL: ' + t.listas + ' de ' + t.copiar + ' en Drive (' + Math.round(100 * t.listas / Math.max(1, t.copiar)) + ' %) · cola ' + t.en_cola +
              ' · errores ' + t.con_error + ' · vencidas ' + t.vencidas + ' · por vencer ' + t.a_borrar);
}
