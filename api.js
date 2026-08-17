/* =========================================================================
 * api.js — cliente de la PWA hacia el Apps Script gatekeeper
 * Configurado con tu Web App real.
 * ========================================================================= */
(function (global) {

  // ---- CONFIGURACIÓN ----
  var API_URL = 'https://script.google.com/macros/s/AKfycbxi0NEunsEIBHx4WWrOPwiG8dhcYmEWpYqBkAXNDPladJLSyqCOnk_lWLfjnf9oTq1Z/exec';
  var OBRA_ID = '1012500000';   // obra por defecto (se puede cambiar en runtime)
  // recordar la última obra elegida: clave para que un arranque SIN conexión
  // busque en el caché la obra correcta (no siempre la de por defecto).
  try { var _lastObra = localStorage.getItem('obra_current'); if (_lastObra) OBRA_ID = _lastObra; } catch (e) {}
  var API_KEY = '';             // opcional: si en Config ponés param:api_key, pegá el mismo valor acá

  /* Saca el tramo /u/N/ que Google mete cuando copiás la URL desde un navegador
     con varias cuentas abiertas. Esa forma de la URL ata la llamada a una
     cuenta concreta y rompe el acceso anónimo. */
  function limpiarUrl_(u) {
    return String(u || '').replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');
  }
  API_URL = limpiarUrl_(API_URL);

  function config(url, obraId, apiKey) {
    if (url) API_URL = limpiarUrl_(url);
    if (obraId) OBRA_ID = obraId;
    if (apiKey !== undefined) API_KEY = apiKey;
  }
  function getObraId() { return OBRA_ID; }
  function setObraId(id) { OBRA_ID = id; try { localStorage.setItem('obra_current', id); } catch (e) {} }

  /* ---- sesión: token guardado en el navegador, viaja en cada request ---- */
  var TOKEN = '';
  try { TOKEN = localStorage.getItem('obra_token') || ''; } catch (e) {}
  function setToken(t) {
    TOKEN = t || '';
    try { t ? localStorage.setItem('obra_token', t) : localStorage.removeItem('obra_token'); } catch (e) {}
  }

  /* Apps Script no responde bien al preflight CORS.
     Usamos text/plain (request "simple") para evitarlo.

     credentials:'omit' — NO mandar cookies de sesión de Google en la llamada.
     Sin esto, cuando el navegador tiene varias cuentas de Google abiertas,
     Google enruta el 302 de /exec hacia .../u/N/... según la cuenta ACTIVA;
     si esa cuenta no es la dueña del script, el destino final
     (script.googleusercontent.com/macros/echo?user_content_key=...) responde
     404 y la app cae en "Sin conexión" sin causa visible. Con 'omit' la
     llamada es siempre anónima, que es justo lo que la implementación espera
     ("Ejecutar como: Yo" + "Quién tiene acceso: Cualquier usuario"), y el
     enrutamiento por cuenta deja de existir. La seguridad real no cambia:
     vive en el token de sesión y en la validación server-side de Code.gs,
     no en el login de Google del navegador. */
  function post(action, payload, obraId) {
    return fetch(API_URL, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: action,
        obra_id: obraId !== undefined ? obraId : OBRA_ID,
        api_key: API_KEY,
        token: TOKEN,
        payload: payload || {}
      })
    })
    .then(function (r) { return r.text(); })
    .then(function (t) {
      var j;
      try { j = JSON.parse(t); }
      catch (e) { throw new Error('Respuesta no-JSON del script (¿está publicado como "Cualquiera con el enlace"?)'); }
      if (!j.ok) {
        if (j.error === 'auth_required') {
          setToken('');                                   // sesión vencida o inexistente
          if (global.__showLogin) global.__showLogin();   // mostrar pantalla de ingreso
        }
        throw new Error(j.error || 'Error del API');
      }
      return j;
    });
  }

  var API = {
    config: config,
    getObraId: getObraId,
    setObraId: setObraId,
    get url() { return API_URL; },

    login: function (usuario, pass) {
      return post('login', { usuario: usuario, pass: pass })
        .then(function (j) { setToken(j.token); return { usuario: j.usuario, rol: j.rol }; });
    },
    logout: function () { setToken(''); },
    hasToken: function () { return !!TOKEN; },

    whoami: function () { return post('whoami').then(function (j) { return { user: j.user, role: j.role }; }); },
    listObras: function () { return post('listObras').then(function (j) { return j.obras; }); },
    getObra: function (obraId) { return post('getObra', {}, obraId).then(function (j) { return j.data; }); },

    crearObra: function (obra) { return post('crearObra', { obra: obra }).then(function (j) { return j.obra; }); },

    duplicarObra: function (origenId, nueva) {
      return post('duplicarObra', { nueva: nueva }, origenId).then(function (j) { return j.obra; });
    },
    eliminarObra: function (obraId, confirmNombre) {
      return post('eliminarObra', { confirm: confirmNombre }, obraId).then(function (j) { return j.obra; });
    },

    saveItems: function (items, dist, deps) {
      return post('saveItems', { items: items, dist: dist, deps: deps }).then(function (j) { return j.saved; });
    },
    /* Guardado PARCIAL: manda solo las tablas que cambiaron.
       El backend escribe únicamente las claves presentes en el payload, así que
       { items: [...] } no toca DistribucionMensual ni Dependencias.
       Mover una fecha del Gantt dejaba de reescribir ítems × meses de la obra
       entera; ahora reescribe la tabla que corresponde y nada más. */
    saveItemsParcial: function (parcial) {
      var p = {};
      if (parcial.items) p.items = parcial.items;
      if (parcial.dist)  p.dist  = parcial.dist;
      if (parcial.deps)  p.deps  = parcial.deps;
      if (!p.items && !p.dist && !p.deps) return Promise.resolve(0);
      return post('saveItems', p).then(function (j) { return j.saved; });
    },
    /* firma de contenido barata (djb2). Sirve para saber si una tabla cambió
       respecto del último guardado exitoso, sin comparar objeto por objeto. */
    firma: function (obj) {
      var str = JSON.stringify(obj), h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      return h.toString(36) + ':' + str.length;
    },
    deleteItems: function (ids) { return post('deleteItems', { ids: ids }).then(function (j) { return j.deleted; }); },
    saveWeekly: function (rows, deleted) {
      return post('saveWeekly', { rows: rows, deleted: deleted || [] }).then(function (j) { return j.saved; });
    },
    /* tipoLb: 'inicial' | 'convenio' | 'replanificacion'; convenioId opcional.
       Cargar el convenio y crear la línea base son DOS acciones separadas: el
       convenio se etiqueta acá a mano, días después de cargarlo. */
    saveBaseline: function (name, items, tipoLb, convenioId) {
      return post('saveBaseline', { name: name, items: items,
        tipo_lb: tipoLb || '', convenio_id: convenioId || '' })
        .then(function (j) { return j.baseline; });
    },
    borrarBaseline: function (baselineId, confirmNro) {
      return post('borrarBaseline', { baseline_id: baselineId, confirm: confirmNro || '' })
        .then(function (j) { return j.borrada; });
    },
    saveConfig: function (config) {
      return post('saveConfig', { config: config }).then(function (j) { return j.saved; });
    },
    /* calendario laboral de la obra: feriados y excepciones puntuales.
       El panel manda la lista COMPLETA; el backend reemplaza las filas de esta
       obra en la pestaña Calendario y no toca las de las demás. */
    saveCalendario: function (calendario, obraId) {
      return post('saveCalendario', { calendario: calendario || [] }, obraId)
        .then(function (j) { return j.saved; });
    },
    saveCategorias: function (cats) { return post('saveCategorias', { categorias: cats }).then(function (j) { return j.saved; }); },
    refreshProduccion: function () { return post('refreshProduccion').then(function (j) { return j.updated; }); },

    /* ---- PRODUCCIÓN (hoja nueva, formato Power BI) ---- */
    prodListas: function (obraId) {
      return post('prodListas', {}, obraId).then(function (j) {
        return { obras: j.obras, items: j.items, estados: j.estados, lados: j.lados };
      });
    },
    // envío directo al servidor (lo usa la cola offline para reenviar sin re-encolar)
    _rawProdGuardar: function (jornada, obraId) {
      return post('prodGuardar', jornada, obraId).then(function (j) {
        return { guardados: j.guardados, submission_id: j.submission_id, fotos_urls: j.fotos_urls || [] };
      });
    },
    // guardado con red de seguridad: si no hay conexión, encola y sigue trabajando
    prodGuardar: function (jornada, obraId) {
      var oid = obraId !== undefined ? obraId : OBRA_ID;
      return this._rawProdGuardar(jornada, oid).catch(function (err) {
        var sinRed = (global.navigator && global.navigator.onLine === false) ||
                     /fetch|network|failed to fetch|load failed|networkerror/i.test((err && err.message) || '');
        if (!sinRed || !global.Outbox) throw err;   // error real de negocio → que lo vea la vista
        var nFotos = (jornada.fotos || []).length;
        // offline: las fotos (pesadas) van a IndexedDB; en la cola de texto solo sus IDs
        if (nFotos && global.PhotoStore) {
          return global.PhotoStore.stash(jornada.fotos).then(function (ids) {
            var light = {}; for (var k in jornada) if (k !== 'fotos') light[k] = jornada[k];
            light.fotos_ids = ids;
            global.Outbox.add({ action: 'prodGuardar', payload: light, obraId: oid });
            return { queued: true, guardados: (jornada.filas || []).length, submission_id: null, fotos: nFotos };
          });
        }
        global.Outbox.add({ action: 'prodGuardar', payload: jornada, obraId: oid });
        return { queued: true, guardados: (jornada.filas || []).length, submission_id: null, fotos: 0 };
      });
    },
    prodHistorial: function (limite, obraId) {
      return post('prodHistorial', { limite: limite || 300 }, obraId).then(function (j) { return j.registros; });
    },
    prodEditar: function (submissionId, cambios, obraId) {
      return post('prodEditar', { submission_id: submissionId, cambios: cambios }, obraId)
        .then(function (j) { return { editado: j.editado, cantFinal: j.cantFinal }; });
    },
    prodBorrar: function (submissionId, obraId) {
      return post('prodBorrar', { submission_id: submissionId }, obraId).then(function (j) { return j.borrado; });
    },

    /* ---- CERTIFICACIÓN (item × mes) ---- */
    certListar: function (obraId) {
      return post('certListar', {}, obraId).then(function (j) { return { registros: j.registros, meses: j.meses }; });
    },
    certGuardar: function (mes, filas, nroCert, obraId) {
      return post('certGuardar', { mes: mes, filas: filas, nro_certificado: nroCert || '' }, obraId)
        .then(function (j) { return { guardados: j.guardados, mes: j.mes }; });
    },

    /* ---------- convenios modificatorios y plazo ----------
       El sistema PROPONE y el usuario CONFIRMA: nada se escribe sin que el
       preview haya sido aceptado. El convenio tiene peso legal.              */
    saveObra: function (obra, obraId) {
      return post('saveObra', { obra: obra }, obraId).then(function (j) { return j.obra; });
    },
    convListar: function (obraId) {
      return post('convListar', {}, obraId)
        .then(function (j) { return { plazo: j.plazo, detalle: j.detalle }; });
    },
    convSugerir: function (obraId) {
      return post('convSugerir', {}, obraId).then(function (j) { return j.items; });
    },
    convPreview: function (payload, obraId) {
      return post('convPreview', payload, obraId);
    },
    convGuardar: function (payload, obraId) {
      return post('convGuardar', payload, obraId);
    },
    convEstado: function (convenioId, estado, obraId) {
      return post('convEstado', { convenio_id: convenioId, estado: estado }, obraId);
    },
    convBorrar: function (convenioId, confirmNro, obraId) {
      return post('convBorrar', { convenio_id: convenioId, confirm: confirmNro || '' }, obraId);
    },
    convVersion: function (convenioId, obraId) {
      return post('convVersion', { convenio_id: convenioId || '' }, obraId)
        .then(function (j) { return j.cantidades; });
    },
    plazoCalc: function (obraId) {
      return post('plazoCalc', {}, obraId).then(function (j) { return j.plazo; });
    },

    /* ---- serialización del modelo de app.js al formato del backend ---- */
    serializeItems: function (ITEMS) {
      var items = [], dist = [], deps = [];
      ITEMS.forEach(function (i, k) {
        items.push({
          id: i.id, desc: i.desc, id_nivel3: i.id_nivel3 || '', desc_nivel3: i.desc_nivel3 || '',
          codigo_cc: i.codigo_cc || '', um: i.um || '', cant: i.cant || 0,
          // OJO: cant_convenio NO se serializa a propósito. Es un caché derivado
          // de ConvenioDetalle y lo mantiene el backend; si lo mandáramos desde
          // acá, una pantalla desactualizada podría pisar el valor contractual.
          cant_ajustada: (i.cant_ajustada == null ? '' : i.cant_ajustada), pu: i.pu || 0,
          incidencia: (i.incidencia == null ? '' : i.incidencia),
          cat: i.cat || '', estado: i.estado || '',
          ini: i.ini || '', fin: i.fin || '', avance_esperado: (i.avE == null ? '' : i.avE),
          avance_manual: (i.avance_manual == null ? '' : i.avance_manual),
          nivel: i.nivel || 1, es_grupo: i.es_grupo ? 1 : '',
          tipo: i.tipo || '', padre_id: (i.padre_id != null && i.padre_id !== '' ? i.padre_id : ''),
          orden: k, _rev: i._rev || 0
        });
        Object.keys(i.dist_mensual || {}).forEach(function (m) {
          dist.push({ item_id: i.id, mes: m, cant: i.dist_mensual[m],
                      manual: !!(i._manualMonths && i._manualMonths[m]) });
        });
        (i.deps || []).forEach(function (dp) {
          deps.push({ item_id: i.id, pred_id: dp.id, tipo: dp.type || 'FS', lag_dias: dp.lag || 0 });
        });
      });
      return { items: items, dist: dist, deps: deps };
    },
    serializeWeekly: function (WEEKLY) {
      return WEEKLY.map(function (w) {
        return {
          plan_id: w.plan_id || '', item_id: w.item_id, actividad: w.actividad || '',
          frente: w.frente || '', um: w.um || '', week: w.week, month: w.month || '',
          cant_prevista: w.cant_prevista || 0, causa: w.causa || '',
          split_json: JSON.stringify(w.mesSplit || {}),
          manual: !!w._man, _rev: w._rev || 0
        };
      });
    }
  };

  global.ObraAPI = API;
})(window);
